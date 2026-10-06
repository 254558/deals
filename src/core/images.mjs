/**
 * 商品图片本地缓存（两家共用一套）。
 *
 * 为什么要下载而不是直接引用外链：
 *  - 优衣库的图片 CDN 返回的 `Content-Type` 是 `application/octet-stream`，
 *    Chrome 的 ORB（Opaque Response Blocking）会因此拦掉这些跨域图片请求，
 *    报告里的图全是空白。这条是硬性的。
 *  - 迪卡侬的 CDN 返回正常的 `image/jpeg`，不存在 ORB 问题，但仍然要抓下来：
 *    报告要能离线看，而且迪卡侬尾货卖完就下架，下架后图片 404/410，榜上会留一排破图。
 *
 * ── 合并时把两边的差异抽成了两件事 ──────────────────────────────────────
 *
 * 1. **档位怎么写**（`sizeVariant`，由站点适配器提供）。这是个纯字符串游戏，
 *    两家的规则完全不同：优衣库是 `/first/80/1.jpg` 这种路径里的档位目录，且
 *    官方只有 80 / 561 两档能用（中间档一律 404）；迪卡侬有两个图床，一个
 *    `/800x800/content.jpg` 插路径、另一个阿里云 OSS 得走 `?x-oss-process=`。
 *    所以这条规则必须留在站点那一侧，核心只负责「把 URL 交出去、把字节收回来」。
 *
 * 2. **一张图还是一串候选**（`images` 链）。迪卡侬一件商品有 3 张图，而且
 *    实测有 130 件的**首图**在 CDN 上已经永久消失（HTTP 410 Gone），副图却还在，
 *    所以它需要一个候选链：一张一张试，第一张下下来了就停。优衣库只需要一张。
 *    核心统一按「候选链」处理 —— 优衣库那条链长度是 1，逻辑完全一样。
 *
 * 4xx 与 5xx 区别对待：4xx 是「这张图不存在」，重试没意义，直接换候选；
 * 5xx 或超时是网络抖动，同一张图再试一次。
 */

import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 图片统一转成 WebP（实测同样清晰度下比官网给的 JPEG 小一半：6 张样本 488KB → 247KB）。
 *
 * 为什么值得：报告首屏那十来张图是**整页最大的一笔流量**（优衣库实测 1.26MB），
 * 手机上 4G 要等一两秒；而且这份报告是每天在手机上翻的。
 *
 * sharp 是 devDependency（只在生成报告时用，报告本身是静态文件）。没装（比如
 * `npm ci --omit=dev`）就退回 JPEG——扩展名跟着变，上游拿到的路径永远是对的。
 */
const WEBP_QUALITY = 82;

/**
 * 卡片用的小图宽度。
 *
 * 2026-10-06 加：手机上卡片才 180 来 px 宽，却在下 1200px 的源图 ——
 * 首屏十几张图就是 ~700 KB，比整页 HTML（93 KB）大一个量级。
 * 官方只有 80（120×160，太小、糊）和 561（1200×1600）两档，中间档一律 404，
 * 所以自己缩一档。宽度取 **400**：卡片约 175 CSS px，2x 屏需要 350 ——
 * 先试过 280，结果浏览器**正确地跳过它**去拿 561（因为它不够 350），白缩了；
 * 400 才真的会被用上，而体积只有 561 的四分之一左右。
 */
const SMALL_WIDTH = 400;
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  sharp = null;
}
const OUT_EXT = sharp ? 'webp' : 'jpg';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error('返回内容为空');
  return buf;
}

/** 转成 WebP；没有 sharp（或本来就不是图片）就原样返回 */
async function encode(buf) {
  if (!sharp) return buf;
  try {
    return await sharp(buf).webp({ quality: WEBP_QUALITY }).toBuffer();
  } catch {
    return buf; // 转不动就别转，宁可大一点也不能丢图
  }
}

/**
 * 把老缓存里的 JPEG 就地升级成 WebP（本机、以及 GitHub Actions 那份缓存里都是 JPEG）。
 * 转完删掉 JPEG——两份都留着只会让部署多传一遍。
 */
async function upgradeLegacy(jpgPath, webpPath) {
  const buf = await encode(readFileSync(jpgPath));
  writeFileSync(webpPath, buf);
  try { unlinkSync(jpgPath); } catch {}
}

/** 逐个候选试，第一个成功的就是它。410/404 都算「这张没了」，换下一张。 */
async function download(urls, dest) {
  let lastError = '';
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(dest, await encode(await fetchImage(url)));
        return { ok: true };
      } catch (err) {
        lastError = err.message;
        if (/HTTP 4/.test(err.message)) break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  return { ok: false, lastError };
}

/**
 * 一个商品的候选图 URL（已按档位改写），去重、去空。
 *
 * 只认 `remoteImages`（整条链）和 `remoteImage`（首图）：传进来的对象来自
 * `buildPayload(db, site, null, { remote: true })`，那里的 `image` 还是 null 占位。
 * **不能**把 `image` 也当候选 —— 渲染用的那份数据里它是本地相对路径
 * （`img/120367@800.jpg`），拿它去拼档位目录只会得到一个不存在的地址。
 */
function candidatesOf(p, size, sizeVariant) {
  const list = p.remoteImages?.length ? p.remoteImages : [p.remoteImage];
  return [...new Set(list.filter(Boolean).map((u) => sizeVariant(u, size)))];
}

/**
 * 保证每件商品都有本地图，已存在的跳过。
 *
 * 文件名带档位与格式（`120367@800.webp`），换档位/换格式时不会把旧的当缓存命中，
 * 也不会把两种分辨率混在一起。老缓存里的 `.jpg` 会被就地转成 WebP 再删掉，
 * 所以本机和 CI 缓存都能平滑升级。
 *
 * @param {object[]} products 每项要有 id/code 与候选图（`remoteImages` / `remoteImage`）
 * @param {string} imgDir
 * @param {object} opts
 * @param {(url:string,size:number)=>string} opts.sizeVariant 站点自己的档位改写规则
 * @param {boolean} [opts.offline] 只认已经缓存好的图，缺的不去下载（开发预览用这个）
 * @returns {Promise<{images:Map<string,string>, downloaded:number, converted:number, failed:number, cached:number, dead:object[]}>}
 *   缺图的不在 images 里；`dead` 是候选链全挂的商品，留个记录好排查。
 *   `converted` 是「由老 JPEG 就地转成 WebP」的——它不走网络，所以不算进 `downloaded`。
 */
export async function ensureImages(products, imgDir, { size = 800, concurrency = 8, offline = false, onProgress, sizeVariant } = {}) {
  if (typeof sizeVariant !== 'function') throw new Error('ensureImages 需要站点提供 sizeVariant(url, size)');
  mkdirSync(imgDir, { recursive: true });
  const result = new Map();

  const todo = [];
  for (const p of products) {
    const code = p.id || p.product_code || p.productCode;
    if (!code) continue;
    const file = `${code}@${size}.${OUT_EXT}`;
    if (existsSync(join(imgDir, file))) {
      result.set(code, `img/${file}`);
      continue;
    }
    // 老缓存：有 JPEG 没 WebP → 就地转（不重新下载）
    const legacy = `${code}@${size}.jpg`;
    if (OUT_EXT === 'webp' && existsSync(join(imgDir, legacy))) {
      todo.push({ code, file, legacy, name: p.name });
      continue;
    }
    const urls = candidatesOf(p, size, sizeVariant);
    if (urls.length && !offline) todo.push({ code, file, urls, name: p.name });
  }

  const total = todo.length;
  const dead = [];
  let done = 0;
  let failed = 0;
  let converted = 0; // 由老 JPEG 就地转出来的（不是下载）

  async function worker() {
    while (todo.length) {
      const job = todo.shift();
      let ok = false;
      let lastError = '';
      if (job.legacy) {
        // 老 JPEG → WebP（本地转换，不走网络）
        try {
          await upgradeLegacy(join(imgDir, job.legacy), join(imgDir, job.file));
          ok = true;
          converted++;
        } catch (err) {
          lastError = err.message;
        }
      } else {
        ({ ok, lastError } = await download(job.urls, join(imgDir, job.file)));
      }
      if (ok) result.set(job.code, `img/${job.file}`);
      else {
        failed++;
        dead.push({ code: job.code, name: job.name, tried: job.urls?.length ?? 0, error: lastError });
      }
      done++;
      // 每 20 张回一次进度：两家都是上千件商品，太密的回调只是白刷屏
      if (onProgress && (done % 20 === 0 || done === total)) onProgress({ done, total, failed });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total || 1) }, worker));

  // 小图那一档：从刚落盘的大图缩出来（已经有的跳过）。
  // 放在主循环**之后**，是为了不跟下载的并发抢资源，也不让「命中缓存」那条快路
  // （上面 existsSync 直接 continue）漏掉小图 —— 老缓存里的图也要补一张。
  let small = 0;
  if (sharp) {
    for (const [code, rel] of result) {
      const smallPath = join(imgDir, `${code}@${SMALL_WIDTH}.webp`);
      if (existsSync(smallPath)) continue;
      try {
        await sharp(join(imgDir, rel.replace(/^img\//, '')))
          .resize({ width: SMALL_WIDTH })
          .webp({ quality: WEBP_QUALITY })
          .toFile(smallPath);
        small++;
      } catch {
        // 缩不出来也不算失败：srcset 少一档，浏览器回落到大图
      }
    }
  }

  return { images: result, downloaded: total - failed - converted, converted, failed, cached: products.length - total, dead, small };
}
