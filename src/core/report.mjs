/**
 * 组装报告数据，并把页面渲染成一个自包含的 HTML（两家共用）。
 *
 * 页面本身是 React 应用（web/），Vite 打成 IIFE 放在 .build/。
 * 这里负责：把数据库的行转成前端要的结构，再把 CSS、JS、数据、字体一起内联进
 * `reports/<站点>/index.html` —— 必须是单文件，因为报告要能双击直接打开（file://），
 * 而 file:// 下取不到外部资源：ES module 会被 CORS 拦、fetch 也拿不到数据。
 *
 * 输出的 payload 结构是 `docs/REPORT-CONTRACT.md` 里那份契约，改这里必须同时改那份文档。
 */

import { writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listDeals, listTracked, stats, discountRate } from './db.mjs';

const rateOf = discountRate;

/**
 * 数据库的一行 → 前端要的一件商品。
 *
 * 这里**只放前端真的会读的字段**。榜单是上千件商品，这份结构会被原样 JSON
 * 内联进报告，多一个字段就是一千多份：实测迪卡侬的 `catchLine` 单项就占 80KB，
 * 所以 `extra` 那袋站点私有字段到这里为止，一个都不往 payload 里带。
 *
 * 两家的字段名在合并时统一了：`id`（优衣库的 productCode / 迪卡侬的 dsmCode）
 * 和 `code`（给人看的编号）。**`id` 沿用旧值是有意的** —— 报告里的收藏/隐藏
 * 存在 localStorage 里、键就是它，换成新编号等于把用户点过的账全清空。
 *
 * @param {object} row listDeals / listTracked 出来的一行（snake_case，来自 SQLite）
 * @param {Map<string,string>|null} images id → 本地图相对路径
 * @param {boolean} remote 是否带上 CDN 候选图地址。**只有下图那一趟需要**：
 *   报告里显示的是本地缓存的 `image`，`remoteImages` 那条链（主图 410 了退副图）
 *   是给 `ensureImages` 用的。
 */
function toDeal(row, images, remote) {
  const launchPrice = row.launch_price || row.origin_price || 0;
  const price = row.last_price ?? row.min_price_ever ?? 0;
  const deal = {
    id: row.product_code,
    code: row.code || row.product_code,
    name: row.name,
    brand: row.brand || '',
    sports: row.sports || '',
    season: row.season || '',
    sizeRange: row.size_range || '',
    url: row.url,
    // `image` 是本地缓存好的相对路径；没下到图的商品为 null，页面留灰占位框
    image: images?.get(row.product_code) ?? null,
    tags: row.tags || [],
    monthlySales: row.monthly_sales || 0,
    launchPrice,
    price,
    saving: Math.max(0, launchPrice - price),
    rate: rateOf(launchPrice, price),
    tracked: row.tracked === 1,
  };
  if (remote) {
    deal.remoteImage = row.image || null;
    deal.remoteImages = row.images?.length ? row.images : row.image ? [row.image] : [];
  }
  return deal;
}

/**
 * @param {object} db
 * @param {object} site 站点描述符（src/sites/*.mjs）
 * @param {Map<string,string>|null} images 传 null 表示「还没下图」，配合 remote 用
 * @param {object} [opts]
 * @param {boolean} [opts.remote] 带上 CDN 候选图地址（只有下图那一趟需要）
 * @param {string|null} [opts.fontNotice] 实际内嵌了字体才写版权声明，否则 null
 * @param {string|null} [opts.crossLinkHref] 覆盖报头那个「另一家的报告」的链接。
 *   Vercel 上两份报告在两个域名，各写绝对地址（站点描述符里的默认值）；
 *   Cloudflare 上两份在同一个域名的兄弟目录，改成相对路径 `../<站点>/` ——
 *   相对路径换域名、换本地双击都对。
 */
export function buildPayload(db, site, images, { remote = false, fontNotice = site.report.fontNotice, crossLinkHref = null } = {}) {
  const deals = listDeals(db, site.id, { limit: 5000, minRate: 0.15 });
  const tracked = listTracked(db, site.id);

  // 盯着的商品即使还没降价也要出现在榜上，否则没法盯着它等降价
  const seen = new Set(deals.map((d) => d.product_code));
  const rows = [...deals, ...tracked.filter((t) => !seen.has(t.product_code))];

  const meta = { ...site.report, fontNotice };
  if (crossLinkHref && meta.crossLink) meta.crossLink = { ...meta.crossLink, href: crossLinkHref };

  return {
    site: site.id,
    generatedAt: new Date().toISOString(),
    recorded: stats(db, site.id).total,
    meta,
    deals: rows.map((r) => toDeal(r, images, remote)),
  };
}

/** dev 页面读的暂存数据（`deals <站点> dev` 用） */
export function writeData(payload, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `window.__DEALS_DATA__ = ${safeJson(payload)};\n`, 'utf8');
  return outPath;
}

/** 内联进 <script> 时必须挡住 </script> 和 <!-- 这类能提前结束脚本的序列 */
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
const safeJs = (code) => code.replace(/<\/script/gi, '<\\/script');

/**
 * 把构建好的 js/css、内嵌字体和本次数据一起塞进一个自包含的 HTML。
 * 这样报告不依赖 ES module、不依赖任何外部请求，file:// 双击就能看。
 *
 * `data-site` 是两家共用一个 bundle 的唯一开关：版面差异全挂在
 * `[data-site="…"]` 选择器下（见 docs/REPORT-CONTRACT.md）。
 */
export function renderHtml({ js, css, fontCss, payload }) {
  const when = new Date(payload.generatedAt ?? Date.now()).toLocaleString('zh-CN');
  return `<!DOCTYPE html>
<html lang="zh-CN" data-site="${payload.site}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${payload.meta.pageTitle} · ${when}</title>
${fontCss ? `<style>\n${fontCss}\n</style>` : ''}
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__DEALS_DATA__ = ${safeJson(payload)};</script>
<script>${safeJs(js)}</script>
</body>
</html>
`;
}

/** web/ 下最新的源文件时间，用来判断构建产物是不是过期了 */
function latestSourceMtime(root) {
  let newest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(join(root, 'web'));
  newest = Math.max(newest, statSync(join(root, 'vite.config.js')).mtimeMs);
  return newest;
}

const buildPaths = (root) => ({
  js: join(root, '.build', 'app.js'),
  css: join(root, '.build', 'app.css'),
});

/**
 * 构建产物不存在、或 React 源码比它新时，重新构建一次。
 * **两个站点共用这一份产物**：样式与组件是同一套，站点差异靠 data-site 选择，
 * 所以抓完优衣库再生成迪卡侬报告不会触发第二次构建。
 */
export function ensureBuild(root, { force = false } = {}) {
  const { js, css } = buildPaths(root);
  const vite = join(root, 'node_modules', '.bin', 'vite');

  if (!existsSync(vite)) return { ok: false, reason: 'missing-deps' };
  if (!force && existsSync(js) && existsSync(css) && statSync(js).mtimeMs >= latestSourceMtime(root)) {
    return { ok: true, built: false, ...buildPaths(root) };
  }

  const res = spawnSync(vite, ['build'], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) return { ok: false, reason: 'build-failed' };
  return { ok: true, built: true, ...buildPaths(root) };
}
