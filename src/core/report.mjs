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

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listDeals, listTracked, listBlocked, loadSizeVocab, stats, discountRate } from './db.mjs';

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
function toDeal(row, images, remote, site, vocab) {
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
    // 「还剩什么尺码」。这是**站点自己的知识**（内部码怎么翻译成 S / 110cm），
    // 所以问适配器；它答不出来（袜子/内衣那些推不出显示名的家族）就是 null，
    // 卡片回退显示商品名。
    // ⚠️ 没在**当轮**见到的（missed >= 1）就不报尺码。它的尺码是上一轮抓的，而尺码变化很快，
    // 我们又核实不了它（没进当轮核实名单）。用户 2026-10-05 报的 Bra短背心（482201 /
    // u0000000074334）正是这个空档：掉榜一轮、留着上一轮搜索给的错误尺码「S」，
    // 勾 S 还能把它筛出来，点进去却一个码都没有。核实不了的就别声称。
    sizes: row.missed >= 1 ? null : (site?.sizeInfo?.(row, vocab) ?? null),
    url: row.url,
    // `image` 是本地缓存好的相对路径。理论上不会为 null —— 没图的商品在 buildPayload
    // 里就被剔掉了（见那里的注释），页面那个灰占位框只是兜底
    image: images?.get(row.product_code) ?? null,
    tags: row.tags || [],
    launchPrice,
    price,
    saving: Math.max(0, launchPrice - price),
    rate: rateOf(launchPrice, price),
    tracked: row.tracked === 1,
    // 连续两轮成功抓取都没见到它 = 已不在特价（下架 / 退出活动池）。
    // 榜单本身已经不收它们了（db 里 missed >= 2 被排除），所以进 payload 的
    // 只可能是**手动 track 盯着的**那些 —— 那正是要留着并标出来的。
    gone: row.missed >= 2,
    // 只有 gone 的才带这个日期（其他商品带了纯属浪费：878 件 × 30 字节）。
    // 用来显示「最后见到 9/25」，免得把最后一次抓到的旧价当成现价看
    lastSeenAt: row.missed >= 2 ? row.last_seen_at : null,
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
 * @param {string|null} [opts.crossLinkHref] 覆盖报头那个「另一家的报告」的链接。
 *   Cloudflare 上两份在同一个域名的兄弟目录，改成相对路径 `../<站点>/` ——
 *   相对路径换域名、换本地双击都对。
 */
/**
 * Cloudflare Web Analytics 的 beacon。
 *
 * **只注入部署产物**：这份报告是单文件、能双击离线打开的（`file://`），本地和 CI 生成的
 * reports/*.html 里不该出现任何外部请求，所以 beacon 由部署那条路径显式传进来
 * （见 cli.mjs 的 cmdDeployCloudflare）。市集页是手写的，由 writeDeployRoot 拷贝时插入；
 * 管理页不加——那是私人的。
 *
 * 用的是 Cloudflare 的 beacon（不用 cookie、不跟踪个人、也不用改 DNS），只需在面板里
 * 打开 Web Analytics 并拿到这个 token。
 */
const BEACON_TOKEN = 'ce871d155ea74738a3e57cd8cd037837';
export const BEACON =
  '<!-- Cloudflare Web Analytics：只统计访问量，不用 cookie，也不跟踪个人 -->\n' +
  `<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${BEACON_TOKEN}"}'></script>`;

export function buildPayload(db, site, images, { remote = false, crossLinkHref = null } = {}) {
  const deals = listDeals(db, site.id, { limit: 5000, minRate: 0.15 });
  const tracked = listTracked(db, site.id);

  // 盯着的商品即使还没降价也要出现在榜上，否则没法盯着它等降价
  const seen = new Set(deals.map((d) => d.product_code));
  const rows = [...deals, ...tracked.filter((t) => !seen.has(t.product_code))];

  /**
   * 没图的商品不上榜。
   *
   * 有的站点自己就没图（迪卡侬的冷门备件常见，实测 32 件），有的是图在 CDN 上挂了。
   * 两种情况对用户是同一件事：卡片上只剩一个灰框，不知道是什么东西，也就没法决定买不买。
   * 所以在生成阶段就剔掉，根本不进 payload。
   *
   * **只在 images 传进来时过滤。** 传 null 的那一趟（`remote: true`，见 cli.mjs 的
   * cmdReport）是给 ensureImages 用的候选清单，过滤了就没图可下 —— 所以这里不能用
   * `remote` 当开关。
   *
   * 这不是「下架」：商品仍留在库里、终端 `list` 里仍然看得到，只是不进报告。
   * ensureImages 只补缺的图，所以哪天图下到了，它下一轮自动回到榜上。
   */
  /**
   * 两道过滤：
   *   ① 谢绝名单里的不上榜（按吊牌号，同款所有颜色一起）——**这一道两趟都过**：
   *      第一趟（remote，给 ensureImages 用）也没必要再去下它的图；
   *   ② 没图的不上榜（只在 images 传进来那一趟判断，理由见上）。
   */
  // 尺码词表读一次，整趟共用（「还剩什么尺码」靠它把内部码翻成人话）
  const sizeVocab = loadSizeVocab(db, site.id);
  const blocked = new Set(listBlocked(db, site.id).map((b) => b.code));
  const shown = rows.filter((r) => !blocked.has(r.code) && (!images || images.get(r.product_code)));

  const meta = { ...site.report };
  if (crossLinkHref && meta.crossLink) meta.crossLink = { ...meta.crossLink, href: crossLinkHref };

  /**
   * 报头行尾的入口摆「另一家的报告」（有兄弟站点时才有）。
   * 市集那个链接是**全站共用的**（不属于哪一家），所以由核心补进来，适配器不用管。
   */
  meta.links = [
    ...(meta.crossLink ? [meta.crossLink] : []),
  ];

  return {
    site: site.id,
    generatedAt: new Date().toISOString(),
    recorded: stats(db, site.id).total,
    meta,
    deals: shown.map((r) => toDeal(r, images, remote, site, sizeVocab)),
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
/**
 * React 挂载之前那块加载指示的标记（样式在 styles.css 的 `#boot`）。
 *
 * 为什么非要在 HTML 里手写一块、而不是用 React 组件：白屏就是 React 还没跑起来的
 * 那段时间，用 React 做加载动画逻辑上盖不住。这块必须纯 CSS、并且**排在 #root
 * 后面、两段大脚本前面**——排后面是因为 CSS 那条 `#root:not(:empty) ~ #boot`
 * 用的是「后面的兄弟」选择器。
 *
 * 25 个点的相位写在 `--i` 上，值取 (行 + 列)：同一条对角线一起亮，看起来就是
 * 一道斜着扫过去的波。
 */
/** 开机动画那一屏的关键 CSS。
 *
 * 为什么单独拎一小份放在最前面：整块 CSS（含内嵌字体）有 300KB、占 HTML 的三分之一还多，
 * 而 <style> 是**阻塞渲染**的——放在 head 里，浏览器得先啃完它才肯画第一帧，于是
 * 「开机动画」根本没机会在等 HTML 的时候出现（实测首绘 ≈ HTML 全部到齐之后）。
 * 把这一小份（1KB）前置、整块 CSS 挪到 body 末尾，首绘就能在解析到开机动画时立刻发生。
 * 开机动画是 React 挂载前**唯一**可见的东西，所以不会有「无样式内容闪一下」的问题。
 *
 * ⚠️ 这几条与 web/src/styles.css 里 #boot / .boot__dots 那几段是同一件事的两份，
 * 改那边记得改这边（数量很少，且只在首绘那一瞬生效）。
 */
function criticalCss(site) {
  const ink = site === 'uniqlo' ? '#000f17' : '#000f17';
  const blue = '#3643ba';
  return [
    ':root{--bg:#fff;--blue:' + blue + ';--ink:' + ink + '}',
    'html,body{margin:0;padding:0;background:var(--bg);color:var(--ink)}',
    'body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}',
    '#boot{position:fixed;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--bg);opacity:0;animation:boot-in 120ms linear forwards}',
    '@keyframes boot-in{to{opacity:1}}',
    '#root:not(:empty)~#boot{display:none}',
    '.boot__dots{display:grid;grid-template-columns:repeat(5,7px);gap:6px}',
    '.boot__dots i{width:7px;height:7px;background:var(--blue);opacity:.14;animation:boot-wave 1.5s linear infinite;animation-delay:calc(var(--i,0)*55ms)}',
    '@keyframes boot-wave{0%,100%{opacity:.14}40%{opacity:1}}',
    '.boot__note{font-size:12px;color:#616161}',
    '@media (prefers-reduced-motion:reduce){.boot__dots i{animation:none;opacity:.55}}',
  ].join('');
}

function renderBoot() {
  const dots = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) dots.push(`<i style="--i:${row + col}"></i>`);
  }
  return (
    `<div id="boot">` +
    `<div class="boot__dots" aria-hidden="true">${dots.join('')}</div>` +
    `<div class="boot__note">正在加载榜单</div>` +
    `</div>\n`
  );
}

export function renderHtml({ js, css, fontCss, payload, beacon = null, origin = null }) {
  const when = new Date(payload.generatedAt ?? Date.now()).toLocaleString('zh-CN');
  const top = payload.top || payload.deals || [];

  /**
   * 首屏那几张图的 preload。
   *
   * 卡片是 React 渲染出来的，所以 <img> 在 JS 跑完之前根本不在文档里——浏览器**没有机会**
   * 像普通页面那样在解析 HTML 时就把图片扫出来下载。这里替它把前几张点名：
   * 初始那批（INITIAL=10）里排在最前的几张，正好是榜单前几名。
   * 用同一个相对路径，命中之后 <img> 直接吃缓存。
   */
  const preload = (payload.deals || [])
    .slice(0, 4)
    .filter((d) => d.image)
    .map((d) => `<link rel="preload" as="image" href="${d.image}">`)
    .join('\n');

  /**
   * SEO 那一小块。
   *
   * - `description`：报告是给搜索结果的，得有一句人话说明这是什么。
   * - `canonical` / OG：**只在知道站点绝对地址时输出**（部署那条路径传 origin）。
   *   本地双击打开的那份不该出现指向 goodprices.online 的 canonical——那会变成
   *   「本地文件声明线上页面是正本」，没有意义。
   * - `<h1>`：React 那套里没有 h1（报头是 span），但爬虫要一个。用一个视觉隐藏的
   *   h1 补上，不进版面。
   *
   * ⚠️ 最大的一条 SEO 短板**不在这里**：正文是 React 渲染的，静态 HTML 里
   * `<div id="root">` 是空的。Google 会执行 JS，百度基本不会——也就是说这两份报告
   * 对百度基本是隐形的。要真解决得在构建期预渲染一份首屏 HTML（见 README）。
   */
  const desc = `${payload.meta.pageTitle}：本期 ${top.length} 件降价商品，含上市价、现价与降幅。数据每天更新。`;
  const canonical = origin ? `${origin}/${payload.site}/` : null;
  const ogImage = origin && payload.deals?.[0]?.image ? `${origin}/${payload.site}/${payload.deals[0].image}` : null;
  const seo = [
    `<meta name="description" content="${desc.replace(/"/g, '&quot;')}">`,
    canonical ? `<link rel="canonical" href="${canonical}">` : '',
    canonical ? `<meta property="og:type" content="website">` : '',
    canonical ? `<meta property="og:url" content="${canonical}">` : '',
    canonical ? `<meta property="og:title" content="${payload.meta.pageTitle}">` : '',
    canonical ? `<meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">` : '',
    ogImage ? `<meta property="og:image" content="${ogImage}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
  ]
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-site="${payload.site}" style="--card-min:${payload.meta.cardMin ?? '258px'};--card-aspect:${payload.meta.imageAspect ?? '3/4'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>GoodPrices · ${payload.meta.pageTitle} · ${when}</title>
${seo}
<style>${criticalCss(payload.site)}</style>
${preload}
</head>
<body>
<h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0">${payload.meta.pageTitle}</h1>
<div id="root"></div>
${renderBoot()}
${fontCss ? `<style>\n${fontCss}\n</style>` : ''}
<style>${css}</style>
<script>window.__DEALS_DATA__ = ${safeJson(payload)};</script>
<script>${safeJs(js)}</script>
${beacon ? beacon + '\n' : ''}</body>
</html>
`;
}

/**
 * 部署根目录的落地页：把 `/` 送到默认站点。
 *
 * 为什么需要它：部署上去的是整个 `reports/`，两份报告各占一个子目录，
 * 所以根路径本来什么都没有、打开就是 404。
 *
 * 为什么用「meta refresh + 相对路径」而不是 302：
 *  - 相对路径（`uniqlo/`）在网页上解析成 `/uniqlo/`，在本地双击打开时解析成
 *    旁边的 `reports/uniqlo/`，两边都对，也不用知道自己在哪个域名下；
 *  - meta refresh 不依赖托管方的特性，将来真要搬到阿里云 OSS 也照样能用。
 * Cloudflare 那边另外还有一份 `_redirects`（真 302），两者不冲突：
 * 支持 `_redirects` 的主机会先给出 302，其余主机落到这个文件。
 *
 * core 这一层不认识站点列表（那在 src/sites/ 里），所以站点信息由调用方传进来。
 */
export function renderRootRedirect({ defaultSite, sites = [] }) {
  const labelOf = (id) => sites.find((s) => s.id === id)?.label ?? id;
  const other = sites.find((s) => s.id !== defaultSite);
  const href = `${defaultSite}/`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="refresh" content="0; url=${href}">
<title>GoodPrices · 正在打开${labelOf(defaultSite)}</title>
<style>body{margin:0;font:400 16px/1.7 -apple-system,'PingFang SC','Hiragino Sans GB',sans-serif;color:#000f17;background:#fff}
main{max-width:32rem;margin:18vh auto;padding:0 24px}a{color:#3643ba}</style>
</head>
<body>
<main>
<p><b>GoodPrices</b> 默认打开的是<b>${labelOf(defaultSite)}</b>那一份。</p>
<p>没有自动跳转就点这里：<a href="${href}">${labelOf(defaultSite)}捡漏榜</a></p>
${other ? `<p style="color:#616161;font-size:14px">另一份在 <a href="${other.id}/">${other.label}</a>。</p>` : ''}
</main>
</body>
</html>
`;
}

/**
 * 404 页。为什么非要有它：部署根上放了 `index.html`（落地页）之后，
 * **任何不存在的路径都会返回 200 + 那个落地页**（实测 `/zzz-不存在`、
 * `/uniqlo/nope`、`/favicon.ico` 全是 718 字节的落地页）。也就是说站点永远不会 404，
 * 打错一个地址会被悄悄送到优衣库，爬虫也能把任意垃圾路径都收成 200。
 * 放一个 `404.html` 进去，Pages 就会用它 + 404 状态码回。
 */
export function renderNotFound({ sites = [] } = {}) {
  const links = sites
    .map((s) => `<li><a href="${s.id}/">${s.label}捡漏榜</a></li>`)
    .join('\n      ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>这个地址不存在 · 捡漏榜</title>
<style>body{margin:0;font:400 16px/1.7 -apple-system,'PingFang SC','Hiragino Sans GB',sans-serif;color:#000f17;background:#fff}
main{max-width:32rem;margin:18vh auto;padding:0 24px}h1{font-size:20px;margin:0 0 12px}
p{color:#616161}ul{padding-left:1.2em}li{margin:6px 0}a{color:#3643ba}</style>
</head>
<body>
<main>
<h1>这个地址不存在</h1>
<p>报告只有这几份：</p>
<ul>
      ${links}
</ul>
</main>
</body>
</html>
`;
}

/**
 * 写部署根目录里的三个小文件：`index.html`（落地页）、`_redirects`（Cloudflare 的
 * 302）、`404.html`（不存在的路径别悄悄返回 200）。生成器从不清 `reports/`，
 * 所以写完就一直在，不会被下次生成冲掉。
 *
 * @returns {string[]} 写出去的文件路径
 */

export function writeDeployRoot(root, { defaultSite, sites }) {
  const dir = join(root, 'reports');
  mkdirSync(dir, { recursive: true });


  // 只有 /api/* 需要走 Functions——其余（两份报告、图片、落地页）让 Pages 直接发静态文件，
  // 不为了市集给整站加一层函数调用。
  writeFileSync(
    join(dir, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }) + '\n',
    'utf8'
  );

  /**
   * 缓存头。Pages 的默认策略是 `max-age=0, must-revalidate`——**连那两千多张商品图也是**，
   * 于是每次打开报告，浏览器都要为每一张图跑一趟 304 校验：手机上 10 张图就是 10 个来回，
   * 光等 RTT 就一两秒（图片字节一个没省，白等）。实测见 docs/DESIGN-UNIQLO.md。
   *
   * 分档：
   *   图片   —— 文件名里带 id 和档位，内容极少变 → 30 天 + 后台慢慢刷
   *   报告页 —— 每小时更新一次，但同一个人可能连着开好几次 → 5 分钟新鲜 + 其余时间先给旧的（最多 1 小时）
   *   API    —— 市集是活的，一律不缓存（Functions 自己也会带 no-store）
   */
  // ⚠️ 别用 `/*` 兜底：_headers 的规则是**叠加**的——图片会同时命中 `/uniqlo/img/*` 和 `/*`，
  // 响应里就出现两条 Cache-Control（实测 `max-age=2592000…, max-age=300…`），浏览器按哪条
  // 算不确定。所以逐条写清楚，不留重叠。
  // 报告页现在**每小时更新一次**（2026-10-05 把 cron 从 3 小时提到每小时），
  // 所以「旧的就给旧的」这段最多只该容忍 1 小时，不能还按 24 小时兜——否则用户
  // 刷新后看到的还是几小时前（甚至一天前）的尺码，会以为筛选是坏的。
  const html = '  Cache-Control: public, max-age=300, stale-while-revalidate=3600\n';
  const headers = [
    ...sites.map((x) => `/${x.id}/img/*\n  Cache-Control: public, max-age=2592000, stale-while-revalidate=86400\n`),
    ...sites.map((x) => `/${x.id}/\n${html}`),
    '/\n' + html,
    '/*.html\n' + html,
  ].join('\n');
  writeFileSync(join(dir, '_headers'), headers, 'utf8');

  const index = join(dir, 'index.html');
  writeFileSync(index, renderRootRedirect({ defaultSite, sites }), 'utf8');

  // `_redirects` 给 `/` 一个真 302（比 meta refresh 干净）。
  // 用 302 不用 301：以后万一想换默认站点，别让浏览器把永久跳转缓存住。
  const redirects = join(dir, '_redirects');
  writeFileSync(redirects, `/  /${defaultSite}/  302\n`, 'utf8');

  // robots.txt 与 sitemap.xml。
  // 注意：线上那份 robots.txt 里 Cloudflare 会自己**前置**一段 content-signals 声明，
  // 这里只写我们自己的部分（允许抓、别抓后台和接口、给出 sitemap）。
  writeFileSync(
    join(dir, 'robots.txt'),
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      '',
      'Sitemap: https://goodprices.online/sitemap.xml',
      '',
    ].join('\n'),
    'utf8'
  );

  const today = new Date().toISOString().slice(0, 10);
  const urls = [...sites.map((x) => `https://goodprices.online/${x.id}/`)];
  writeFileSync(
    join(dir, 'sitemap.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`),
      '</urlset>',
      '',
    ].join('\n'),
    'utf8'
  );

  const notFound = join(dir, '404.html');
  writeFileSync(notFound, renderNotFound({ sites }), 'utf8');

  return [index, redirects, notFound, join(dir, '_routes.json'), join(dir, '_headers'), join(dir, 'robots.txt'), join(dir, 'sitemap.xml')];
}

/**
 * web/ 下最新的源文件时间，用来判断构建产物是不是过期了。
 *
 * **软链要跳过**：`web/public/img` 是 `deals <站点> dev` 建的软链，指向
 * `reports/<站点>/img`。dirent 对软链来说 `isDirectory()` 是 false，于是会走到
 * `statSync` —— 而 statSync 是**跟随**软链的，目标不存在就抛 ENOENT。仓库一搬家，
 * 那条软链就指向旧路径成了断链，报告从此生成不了（实测踩过：
 * `ENOENT: no such file or directory, stat '/…/web/public/img'`）。
 * 它只是开发服务器的暂存物、不是源码，跳过即可；顺带把 stat 失败也兜住，
 * 别让一个读不到的文件把整份报告拦下。
 */
function latestSourceMtime(root) {
  let newest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else newest = Math.max(newest, statSync(p).mtimeMs);
      } catch {
        // 读不到就当它不存在：这个时间只是个「要不要重新构建」的优化
      }
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
