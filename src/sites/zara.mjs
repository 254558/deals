/**
 * ZARA 中国（zara.cn）—— 站点适配器。
 *
 * ── 数据从哪来 ────────────────────────────────────────────────────────────
 * Zara 中国站是**服务端渲染**的：特价分类页把整页商品直接写进 HTML，首屏不发
 * XHR（我用无头浏览器挂 Network 监听过，0 条请求）。所以不用摸私有接口，**解析
 * HTML** 就是最稳的路子。
 *
 *   https://www.zara.cn/cn/zh/man-special-prices-l806.html     ← 「男装 特价精选」
 *   https://www.zara.cn/cn/zh/woman-special-prices-l1314.html  ← 「女装 特价精选」
 *   …… 共 7 个（见下面 CATEGORIES），一页 50~60 件，不用翻页。
 *
 * 每张卡片长这样（已简化）：
 *   <li class="product-grid-product …" data-productid="545454399"
 *       data-productkey="545454399-02949800800-e1">
 *     …
 *     <a class="product-link" href="https://www.zara.cn/cn/zh/…-p02949800.html">
 *       <h3>皮革效果短款夹克外套</h3>
 *     </a>
 *     <del class="price__amount--old-price-wrapper">
 *       <span class="price-amount-old" …><data value="549.00">
 *     <ins class="price-current … price__amount--on-sale">
 *       <span class="price-discount-percentage">-40%</span>
 *       <span class="price-amount-current" …><data value="329.00">
 *
 * ── 图片这个坑 ────────────────────────────────────────────────────────────
 * 卡片里的 <img> 全都是**懒加载占位图**（transparent-background.png），真图 URL
 * 不在卡片里 —— 它们散在页面别处（实测一页 174 个）。好在命名有规律：
 *
 *   data-productkey = 545454399-02949800800-e1
 *   真图 URL        = …/02949800800-e1/02949800800-e1.jpg      ← 后缀对得上
 *
 * 所以先把全页图片按「文件名」建索引，再用 productkey 去掉第一段去查。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HOST = 'https://www.zara.cn';
const BASE = `${HOST}/cn/zh`;

/** 7 个「特价精选」分类（首页导航里挂着的就是这些） */
const CATEGORIES = [
  { id: 'woman-special-prices-l1314', label: '女装' },
  { id: 'man-special-prices-l806', label: '男装' },
  { id: 'kids-girl-special-prices-l427', label: '女童' },
  { id: 'kids-boy-special-prices-l263', label: '男童' },
  { id: 'kids-babygirl-special-prices-l152', label: '女婴' },
  { id: 'kids-babyboy-special-prices-l69', label: '男婴' },
  { id: 'kids-babygirl-shoes-special-prices-l2994', label: '童鞋' },
];

const TAGS = {
  sale: '特价',
};

const unescapeHtml = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

async function fetchPage(path) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Zara ${path} 返回 ${res.status}`);
  return res.text();
}

/**
 * 从一页 HTML 里抠出商品。两条路都走，合起来去重 —— 因为**两种版式不一样**：
 *
 *   ① JSON-LD（schema.org ItemList）：**每一页都有**，但只给前 10 件（给搜索引擎看的）。
 *      字段最全：name / image / offers.price / offers.url。
 *   ② 卡片内联：只有**男装「特价精选」那一页**把整页 50+ 件连名带价写进 HTML；
 *      其余 6 页的卡片是「动态块」版式，HTML 里只有 id 和图，名和价都不在（实测
 *      80 张卡里只有 20 张能蹭到名字、0 张有价）。所以那几页只能靠 ① 兜着。
 *
 * 这个差异是实测出来的：先用卡片切分写，结果只有男装页出得来东西（0/58/0/0/0/0/0）。
 */
function parseListPage(html, categoryId) {
  const out = [];
  const push = (p) => { if (p && p.name && p.price > 0) out.push(p); };

  // ① JSON-LD
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const el of j.itemListElement ?? []) {
      const it = el.item ?? {};
      const o = it.offers ?? {};
      const url = o.url ?? '';
      push({
        productCode: it.sku ?? url.match(/-p(\d+)\.html/)?.[1] ?? url,
        code: url.match(/-p(\d+)\.html/)?.[1] ?? '',
        name: unescapeHtml(it.name ?? '').trim(),
        brand: 'ZARA',
        sports: null,
        season: null,
        sizeRange: '',
        url,
        image: it.image ?? null,
        images: it.image ? [it.image] : [],
        tags: ['sale'],
        extra: { category: categoryId },
        originPrice: null, // JSON-LD 只给现价，不给划线价
        price: Number(o.price),
        monthlySales: null,
        inStock: true,
      });
    }
  }

  // ② 卡片内联（男装页那种版式才有）
  const imgByKey = new Map();
  for (const m of html.matchAll(/https:\/\/static\.zara\.cn\/assets\/public\/[^"'\s>)]+\.jpg/g)) {
    const name = m[0].split('/').pop().replace(/\.jpg$/, '');
    if (!imgByKey.has(name)) imgByKey.set(name, m[0]);
  }
  const re = /data-productid="(\d+)"\s+data-productkey="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const win = html.slice(m.index, m.index + 2600);
    const name = unescapeHtml(win.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] ?? '').trim();
    if (!name) continue;
    const url = win.match(/href="(https:\/\/www\.zara\.cn\/[^"]+\.html)"/)?.[1] ?? '';
    const numAfter = (marker) => {
      const i = win.indexOf(marker);
      if (i < 0) return null;
      const v = win.slice(i).match(/value="([\d.]+)"/)?.[1];
      return v == null ? null : Number(v);
    };
    const image = imgByKey.get(m[2].split('-').slice(1).join('-')) ?? null;
    push({
      productCode: m[1],
      code: url.match(/-p(\d+)\.html/)?.[1] ?? m[1],
      name,
      brand: 'ZARA',
      sports: null,
      season: null,
      sizeRange: '',
      url,
      image,
      images: image ? [image] : [],
      tags: ['sale'],
      extra: { category: categoryId, productKey: m[2] },
      originPrice: numAfter('price-amount-old'),
      price: numAfter('price-amount-current'),
      monthlySales: null,
      inStock: true,
    });
  }
  return out;
}

/** 图片档位：Zara 的图 URL 带 `?ts=…&w=352`，把 w 换掉即可 */
function sizeVariant(url, size) {
  if (!url) return url;
  if (/[?&]w=\d+/.test(url)) return url.replace(/([?&]w=)\d+/, `$1${size}`);
  return `${url}${url.includes('?') ? '&' : '?'}w=${size}`;
}

const tableColumns = [
  { head: '编号', w: 10, align: 'l', get: (r) => r.code },
  { head: '商品', w: 34, align: 'l', trunc: 32, get: (r) => r.name },
  { head: '原价', w: 9, align: 'r', get: (r) => `¥${r.originPrice}` },
  { head: '现价', w: 9, align: 'r', get: (r) => `¥${r.price}` },
  {
    head: '降幅',
    w: 7,
    align: 'r',
    get: (r) => (r.originPrice > r.price ? `-${Math.round((1 - r.price / r.originPrice) * 100)}%` : '—'),
  },
  { head: '分类', w: 8, align: 'l', get: (r) => CATEGORIES.find((c) => c.id === r.extra?.category)?.label ?? '' },
];

export default {
  id: 'zara',
  label: 'ZARA',
  aliases: ['zara', 'z', 'sa'],
  imageSize: 800,
  sizeVariant,
  fonts: null,
  tags: TAGS,
  tableColumns,
  statsExtra: [],

  async sync({ onPage } = {}) {
    const all = [];
    for (const cat of CATEGORIES) {
      const html = await fetchPage(`${cat.id}.html`);
      const list = parseListPage(html, cat.id);
      onPage?.({ label: cat.label, page: 1, have: all.length + list.length, total: null });
      all.push(...list);
    }
    // 同一件商品可能同时挂在两个分类下（比如童鞋也属于女童），按 productCode 去重
    const seen = new Set();
    const products = [];
    for (const p of all) {
      if (seen.has(p.productCode)) continue;
      seen.add(p.productCode);
      products.push(p);
    }
    return { fetched: all.length, products };
  },

  /** 编号 = 商品页地址里的 `-p` 后面那串数字（也可以直接贴完整地址） */
  async findByCode(code) {
    const target = String(code).trim();
    for (const cat of CATEGORIES) {
      const html = await fetchPage(`${cat.id}.html`);
      const hit = parseListPage(html, cat.id).find((p) => p.code === target || p.productCode === target);
      if (hit) return hit;
    }
    return null;
  },

  parseCode: (input) => String(input ?? '').match(/-p(\d+)\.html/)?.[1] ?? String(input ?? '').match(/(\d{6,9})/)?.[1] ?? String(input ?? ''),

  copy: {
    syncTitle: '抓取 ZARA 特价精选…',
    sortHint: 'rate|saving|price|newest',
    dropped: '这次又降价的商品',
    permanent: '官方下调划线价',
    added: '本次新出现的商品',
    addedLimit: 30,
    addedWord: '新出现',
    permanentWord: '官方下调原价',
    raisedWord: '涨回去了',
    trackUsage: '编号是 ZARA 商品页地址里 -p 后面那串数字（例如 …-p02949800.html → 02949800）',
    trackTags: [{ tag: 'sale', text: '特价精选' }],
    tagHint: 'sale',
    sourceNote: '数据源：zara.cn 特价精选分类页（公开页面）。价格以结账页为准。',
  },

  report: {
    label: 'ZARA',
    pageTitle: 'ZARA 捡漏榜',
    currency: { sym: '¥', zero: '¥0' },
    imageAspect: '2/3', // 官网图是竖版（卡片里 padding-bottom:150%）
    cardMin: '300px',
    searchPlaceholder: '搜商品名、编号或分类',
    searchLabel: '名称、编号或分类',
    storagePrefix: 'zara',
    showRecorded: false,
    crossLink: {
      href: 'https://goodprices.online/uniqlo/',
      label: '优衣库',
      title: '优衣库比价报告（新标签打开）',
    },
    features: {
      stickerTags: false,
      brandMark: false,
      priceOffBadge: false,
      dealBarNumber: true,
      cardChips: false,
      trackChip: false,
    },
    tagLabels: TAGS,
    chipTags: [],
  },
};
