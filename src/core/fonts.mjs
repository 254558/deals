/**
 * 把站点在用的中文字体子集化后嵌进报告。
 *
 * 只有优衣库这一站需要它，迪卡侬那站走系统字体栈 —— 但代码留在这里、由
 * 站点描述符的 `fonts` 字段驱动：`fonts: null` 就是不内嵌。合并前这份逻辑
 * 写死在 uniql 的 src/fonts.mjs 里，字重表、字体名、版权声明全是常量；
 * 现在它们都变成站点可以声明的东西，因为「用哪个字体、挂到哪个字重槽位上」
 * 本来就是站点自己的观感问题，不是核心的事。
 *
 * ── 优衣库为什么非嵌不可 ──────────────────────────────────────────────
 * 官网的字栈是 `UniqloProRegular, syht_Regular` —— 西文用 Uniqlo Pro（品牌字体），
 * 中文用思源黑体。Uniqlo Pro 是迅销的品牌资产，不能内嵌；西文退到 Helvetica Neue
 * 已经相当接近，字形结构是同一路的。但中文这一侧不能将就：macOS 上如果没有
 * PingFang，字体栈会掉到 Hiragino Sans GB（冬青黑体），和思源黑体的观感差别
 * 肉眼可见 —— 整页会呈现出一种老 macOS 应用的味道，而不是现代中文网页。
 *
 * 思源黑体是 Apache-2.0 开源的（这个版本是 Adobe 2014 年的 1.000，License 写在
 * 字体 name 表里），可以合法内嵌，保留版权与许可声明即可。
 *
 * 为什么不整包嵌：完整字重 8MB，而报告里出现的汉字只有一两千个。按实际用到的
 * 字符裁剪成 WOFF2 之后是几百 KB 量级，单文件报告还撑得住。
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function download(url, dest, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // 字体文件 8MB 起步，太小说明拿到的是错误页
      if (buf.length < 1_000_000) throw new Error(`返回内容异常（${buf.length} 字节）`);
      writeFileSync(dest, buf);
      return true;
    } catch (err) {
      if (i === retries) return false;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return false;
}

/**
 * 保证字体文件在本地。已下载的跳过。
 * @param {string} dir
 * @param {{faces:Array<{weight:number,file:string,url:string}>}} fonts 站点描述符里的字体配置
 * @returns {Promise<Array<{weight:number,path:string}>|null>} 拿不到就返回 null（报告退回系统字体栈）
 */
export async function ensureFontFiles(dir, fonts, { onStatus } = {}) {
  if (!fonts?.faces?.length) return null;
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of fonts.faces) {
    const path = join(dir, f.file);
    if (existsSync(path)) {
      out.push({ weight: f.weight, path });
      continue;
    }
    onStatus?.(`首次运行，下载中文字体（${f.file}，约 8MB）…`);
    if (!(await download(f.url, path))) return null;
    out.push({ weight: f.weight, path });
  }
  return out;
}

/**
 * 按 `text` 里实际出现的字符裁剪字体，输出 @font-face CSS。
 *
 * **两种模式**（2026-10-06 加的后一种）：
 *   · 不传 outDir → base64 内联。报告要能双击打开（file://），不能依赖外部文件。
 *   · 传 outDir   → 写成独立 .woff2 + 相对 url。**线上走这条。**
 *
 * 为什么要拆出来：字体子集 271 KB（brotli 后），占整页传输的 **79%**；
 * 而它内联在 <style> 里，浏览器必须把这段全解析完才能画第一个字 ——
 * 首屏要等 343 KB。拆出去之后 HTML 只剩 72 KB（立刻能渲染，文字先用系统字体，
 * `font-display:swap` 会让它随后换过来），字体本身并行下、而且能永久缓存。
 * 量出来的账见 git 记录：整页 964 KB → brotli 343 KB，其中字体 271 KB。
 *
 * @returns {Promise<{css:string, files:string[]}|null>} 失败返回 null，调用方退回系统字体栈
 */
export async function buildFontCss({ files, text, family, notice, outDir = null, urlBase = '' }) {
  if (!files?.length || !family) return null;
  let subsetFont;
  try {
    ({ default: subsetFont } = await import('subset-font'));
  } catch {
    return null; // 没装 subset-font，不阻塞报告生成
  }

  const chars = [...new Set([...text])].join('');
  if (!chars) return null;

  const blocks = [];
  const written = [];
  for (const f of files) {
    const buf = readFileSync(f.path);
    const woff2 = await subsetFont(buf, chars, { targetFormat: 'woff2', preserveNameIds: [0, 13, 14] });
    let src;
    if (outDir) {
      const name = `font-${f.weight}.woff2`;
      writeFileSync(join(outDir, name), woff2);
      written.push(name);
      src = `url(${urlBase}${name}) format('woff2')`;
    } else {
      src = `url(data:font/woff2;base64,${woff2.toString('base64')}) format('woff2')`;
    }
    blocks.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${f.weight};font-display:swap;` +
        `src:${src}}`
    );
  }
  if (notice) blocks.push(`/* ${notice} */`);
  return { css: blocks.join('\n'), files: written };
}
