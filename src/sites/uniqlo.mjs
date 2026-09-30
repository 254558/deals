/**
 * 优衣库中国（uniqlo.cn）—— 站点适配器。
 *
 * 合并前的 `uniql` 仓库就是这个站点：抓取、字段映射、文案、图片档位规则、
 * 内嵌字体、报告开关，全都散在 src/api.mjs + src/cli.mjs + src/images.mjs +
 * src/fonts.mjs + web/ 里。合并后**只有抓取与站点口味**留在这一层，
 * 其余（历史库、图片缓存、单文件报告、终端表格）都归 src/core/。
 *
 * 站点适配器要提供什么，见 docs/REPORT-CONTRACT.md 与 src/sites/index.mjs 的说明。
 */

const SEARCH_ENDPOINT =
  'https://d.uniqlo.cn/p/hmall-sc-service/search/searchWithDescriptionAndConditions/zh_CN';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 站点本身是前端渲染的 SPA，HTML 里拿不到价格，但它的搜索接口是公开的 JSON POST，
 * 无需登录、无需 token，直接调用即可拿到「原价 / 现价 / 标签 / 限时窗口」。
 * 注意：站点前面挂了腾讯云 EdgeOne 的 WAF，会拦截明显的爬虫 UA，所以这里固定发
 * 一个真实浏览器的 UA，并带上 Origin / Referer。
 */
async function post(body, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          Origin: 'https://www.uniqlo.cn',
          Referer: 'https://www.uniqlo.cn/',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      if (!json.success) throw new Error(`接口返回失败: ${json.msg || json.msgCode}`);
      return json;
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await sleep(800 * (i + 1));
    }
  }
  throw new Error(`请求优衣库接口失败: ${lastErr.message}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const IMAGE_BASE = 'https://www.uniqlo.cn';

/** 降价标签。限时特优是短期活动价，超值精选是清仓价（会一路降到底）。 */
const TAGS = {
  time_doptimal: '限时特优',
  concessional_rate: '超值精选',
  new_product: '新作商品',
  pickUp: '门店自提',
  revision: '修改裤长',
};

/** 抓取哪些标签下的商品（sync 的商品池） */
const SALE_TAGS = ['time_doptimal', 'concessional_rate'];

/** 把接口返回的商品对象整理成我们自己的结构 */
function normalize(p) {
  return {
    productCode: p.productCode,
    code: p.code,
    // 官网的名字是「主名/一堆形容词」拼的，例如
    // 「高性能修身防皱衬衫/长袖衬衣商务通勤」——斜线后面那截是给搜索/分类用的，
    // 卡片上没人看（图片比字清楚）。只留斜线前面那一段，实测这样读起来正好。
    // 完整名字没丢：它照旧进 extra.fullName。
    name: shortName(p.name4zhCN || p.name || ''),
    fullName: (p.productName4zhCN || p.productName || '').trim(),
    season: p.season4zhCN || p.season || '',
    sex: p.sex4zhCN || '',
    material: p.material4zhCN || '',
    image: p.mainPic ? IMAGE_BASE + p.mainPic : '',
    colors: (p.styleText4zhCN || []).map((s) => s.trim()),
    sizeRange: [p.minSize4zhCN, p.maxSize4zhCN].filter(Boolean).join(' ~ '),
    // 在售尺码的**内部码**（SMA003 这种）。接口给的 `size` 数组是「有货的码」，
    // 已核对：在售[XS] 全部[XS,S,M,L] 这类样本确实是有货的子集。
    // 显示名（S / 110cm）在这里不翻译，原样存进库，翻译放在 sizeInfo 里——
    // 这样以后映射表改了不用重新抓一遍。
    sizeCodes: (p.size || []).slice(),
    identities: p.identity || [],
    originPrice: num(p.originPrice), // 官方原价。优衣库原价不会上调，所以历史最高原价 ≈ 上市价
    minPrice: num(p.minPrice), // 现价（多色/多码中的最低价）
    maxPrice: num(p.maxPrice),
    monthlySales: num(p.monthlySales),
    totalSales: num(p.sales),
    inStock: p.stock === 'Y',
    storeStock: p.productStoreStockFlag === 'Y',
    limitedEnd: p.timeLimitedEnd?.[0] ?? null,
    url: `https://www.uniqlo.cn/product-detail.html?productCode=${p.productCode}`,
  };
}

/**
 * 搜索商品。
 * @param {object} opts
 * @param {string} [opts.description] 关键词或商品吊牌编号
 * @param {string[]} [opts.identity]  标签过滤，如 ['concessional_rate']
 */
async function search({ description = '', identity = [], page = 1, pageSize = 100, rank = 'overall' } = {}) {
  const qs = new URLSearchParams();
  if (description) qs.set('description', description);
  qs.set('searchType', '1');
  const json = await post({
    url: `/search.html?${qs}`,
    pageInfo: { page, pageSize, withSideBar: 'N' },
    belongTo: 'pc',
    rank,
    priceRange: { low: 0, high: 0 },
    color: [],
    size: [],
    season: [],
    material: [],
    sex: [],
    categoryFilter: {},
    identity,
    insiteDescription: '',
    exist: [],
    searchFlag: true,
    description,
  });
  const products = (json.resp?.[1] || []).map(normalize);
  const total = json.resp?.[2]?.productSum ?? products.length;
  return { products, total };
}

/** 抓取某个标签下的全部商品，自动翻页 */
async function fetchAllByTag(tag, { pageSize = 100, onPage } = {}) {
  const all = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const { products, total: t } = await search({ identity: [tag], page, pageSize, rank: 'overall' });
    total = t;
    if (products.length === 0) break;
    all.push(...products);
    onPage?.({ tag, page, got: products.length, have: all.length, total });
    if (page * pageSize >= total) break;
    page++;
    await sleep(250); // 别把人家接口打太狠
  }
  return all;
}

/** 按 productCode 去重，同一件商品在结果里可能因分类不同出现多次 */
function dedupe(products) {
  const map = new Map();
  for (const p of products) {
    const prev = map.get(p.productCode);
    if (!prev) {
      map.set(p.productCode, p);
      continue;
    }
    // 保留价格更低的那个记录，并合并标签
    const better = p.minPrice < prev.minPrice ? p : prev;
    better.identities = [...new Set([...prev.identities, ...p.identities])];
    map.set(p.productCode, better);
  }
  return [...map.values()];
}

/** 接口形状 → 核心认的规范形状（见 docs/REPORT-CONTRACT.md 第四节） */
function toCanonical(p) {
  return {
    productCode: p.productCode,
    code: p.code,
    name: p.name,
    brand: '',
    sports: '',
    season: p.season,
    sizeRange: p.sizeRange,
    sizeCodes: p.sizeCodes,
    url: p.url,
    image: p.image,
    images: p.image ? [p.image] : [],
    tags: p.identities || [],
    // 报告不渲染、但值得留档的字段进 extra：不进 payload，不会撑大单文件报告
    extra: {
      fullName: p.fullName,
      sex: p.sex,
      material: p.material,
      colors: p.colors,
      maxPrice: p.maxPrice,
      totalSales: p.totalSales,
      storeStock: p.storeStock,
      limitedEnd: p.limitedEnd,
    },
    originPrice: p.originPrice,
    price: p.minPrice,
    monthlySales: p.monthlySales,
    inStock: p.inStock,
  };
}

/**
 * 图片档位：官方只提供 80（120x160）和 561（1200x1600）两个能用的档，
 * 中间档实测 404。80 档在大图视图里根本不够看（卡片在 1440 宽是 318px、
 * 单列窄屏能到 513px，Retina 下要 600~1000px 的源图），所以用 561。
 * 档位写在路径里：`.../main/first/561/1.jpg`。
 */
const sizeVariant = (imageUrl, size) => imageUrl.replace(/\/first\/\d+\//, `/first/${size}/`);

/**
 * 中文字体：官网在用的思源黑体（Apache-2.0，可以从优衣库自己的 CDN 拿到），
 * 按页面实际用字裁剪成 woff2 内嵌进报告。
 *
 * 取两档就够：正文 Regular，强调 Medium。优衣库中文的强调用的是 Medium，
 * 不是 Bold —— 标题规则是 `b,h1..h5,th{font-family:LTMedium;font-weight:400}`，
 * 汉字从不压重黑。所以这里把 Medium 挂到 700 这个槽位上，让 font-weight:700
 * 的汉字落在 Medium 上，正好是官网的观感。
 */
const FONTS = {
  family: 'Source Han Sans CN',
  faces: [
    { weight: 400, file: 'SourceHanSansCN-Regular.otf', url: 'https://www.uniqlo.cn/public/bin/Font-syht/SourceHanSansCN-Regular.otf' },
    { weight: 700, file: 'SourceHanSansCN-Medium.otf', url: 'https://www.uniqlo.cn/public/bin/Font-syht/SourceHanSansCN-Medium.otf' },
  ],
  notice:
    'Source Han Sans CN (思源黑体) — Copyright © 2014 Adobe Systems Incorporated, ' +
    'Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0.html). ' +
    '本报告内嵌的是按实际用字裁剪后的子集（subset）。',
};

/** 报告里那张表：优衣库那份没有品牌列（迪卡侬那一列是品牌，我们这一列是标签） */
const tableColumns = [
  { head: '编号', w: 8, align: 'l', get: (r) => r.code },
  { head: '商品', w: 30, align: 'l', get: (r) => r.name, trunc: true },
  { head: '上市价', w: 8, align: 'r', get: (r) => `¥${r.origin_price}` },
  { head: '现价', w: 8, align: 'r', get: (r) => `¥${r.last_price}` },
  { head: '降幅', w: 7, align: 'r', get: (r) => `-${Math.round(r.rate * 100)}%` },
  { head: '省', w: 7, align: 'r', get: (r) => `¥${r.origin_price - r.last_price}` },
  {
    head: '标签',
    w: 16,
    align: 'l',
    get: (r) => (r.tags || []).filter((t) => TAGS[t] && t !== 'pickUp').map((t) => TAGS[t]).join('/'),
  },
];

/**
 * 「还剩什么尺码」——把接口给的在售**内部码**翻译成人看得懂的尺码。
 *
 * 两件事分开：
 *   ① 词表从接口拿（`withSideBar: 'Y'` 时侧边栏的「尺码」分组，实测 69 档 12 个家族）：
 *      SMA002=XS、CMA080=80cm、CMD070=W28/28英寸/28码、SHC225=36/225mm/22.5cm、SIZ999=均码…
 *      不写死在代码里：这是接口给的数据，新家族出现时不用改代码。
 *   ② 「还剩哪些」看商品的 `size` 数组（接口给的是**有货的码**，已核对：在售 [XS] /
 *      该款全部 [XS,S,M,L] 这种样本确实是有货的子集），`minSize4zhCN ~ maxSize4zhCN`
 *      是这个款一共几档。
 *
 * **「是不是都有」用「连续」判**：同一家族里，在售的码如果是一段连续的档位（中途不缺），
 * 就写 all；缺了档就把剩下的列出来。不拿 min~max 去比——那个范围串的写法跟词表并不一致
 * （裤子写 `160/70A ~ 190/120C`，词表里却是 `W28/28英寸/28码`），比不出可靠结果；
 * 而「连续＝不缺码」不依赖那个串，且不会误报（真缺了档就一定不连续）。
 */

/** 站点的商品名：只留斜线前面那截 */
const shortName = (name) => String(name || '').split('/')[0].trim();

/**
 * 词表里的显示名取一段，**尽量给出厘米**——'W28' 这种美制腰围码没人读得出来
 * （2026-09-30 用户要求「换成 xl 这种、或者 150cm 这种」）。
 *
 * 词表里每档是一串，比如 'W28/28英寸/28码'、'73cm/W29/29英寸/29码'、
 * '36/225mm/22.5cm'、'XS'、'AA65/65AA/AA70/70AA'。按这个顺序取：
 *   ① 串里明写了厘米（'73cm'、'22.5cm'）→ 用它；
 *   ② CMD 家族：**码里的数字就是厘米**。实测词表里带 cm 的 7 档（CMD073→73cm、
 *      CMD088→88cm…）全部等于码里数字，所以没写 cm 的那 12 档照着补（CMD070 → 70cm）。
 *      注意不能拿英寸去乘 2.54：官网自己的腰围是 3cm 一档的梯子（73/76/79/82/85/88/91），
 *      不是英寸换算（W32 写成 82cm，而 32 英寸 = 81.3cm）；
 *   ③ 按英寸给的（INS：码里数字就是英寸，实测 INS021 的 label 是 'W21/21英寸/21码'）
 *      → 乘 2.54 换成厘米（INS023 → 58cm，正对得上同款商品尺码范围里的「150/58A」）；
 *   ④ 其余家族第一段本来就是对的：字母码 'XS'、厘米码 '80cm'、袜码 '25-27cm'、
 *      鞋码走 ①、内衣 'AA65'、'均码'。
 */
const shortLabel = (label, code = '') => {
  const parts = String(label || '').split('/').map((t) => t.trim());
  const cm = parts.find((t) => /^\d+(?:\.\d+)?cm$/.test(t));
  if (cm) return cm;
  if (/^CMD\d{3}$/.test(code)) return `${Number(code.slice(3))}cm`;
  const inch = parts.find((t) => /^\d+(?:\.\d+)?英寸$/.test(t));
  if (inch) return `${Math.round(parseFloat(inch) * 2.54)}cm`;
  return parts[0] || '';
};

/** 抓尺码词表。侧边栏跟搜索条件无关（是整站的尺码体系），随便带一个条件就行。 */
async function fetchSizeVocab() {
  const json = await post({
    url: '/search.html?searchType=1',
    pageInfo: { page: 1, pageSize: 1, withSideBar: 'Y' },
    belongTo: 'pc',
    rank: 'overall',
    priceRange: { low: 0, high: 0 },
    color: [], size: [], season: [], material: [], sex: [],
    categoryFilter: {}, identity: [], insiteDescription: '', exist: [],
    searchFlag: true, description: '',
  });
  const seg = (json.resp?.[0] || []).find((s) => s?.name === '尺码');
  const groups = (seg?.item || []).filter((g) => Array.isArray(g) && g.every((x) => x?.sizeCode));
  const out = [];
  groups.forEach((g, grp) => {
    g.forEach((x, ord) => out.push({ code: x.sizeCode, label: x.sizeValue, grp, ord }));
  });
  return out;
}

/** 取在售尺码码。库里存的是 JSON 文本，db.mjs 的 hydrate 会顺手解成数组（sizeCodes），
    两条路都认——适配器不该关心调用方有没有 hydrate 过 */
function codesOf(row) {
  if (Array.isArray(row.sizeCodes)) return row.sizeCodes;
  if (Array.isArray(row.size_codes)) return row.size_codes;
  try {
    const v = JSON.parse(row.size_codes || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 这件商品还剩哪些尺码。
 * @param {object} row    库里的一行（或已经 hydrate 过的）
 * @param {Map}    vocab  code → {label, grp, ord}
 * @returns {{full:boolean, labels:string[], count:number}|null} 翻译不出来就 null（卡片上不画这一行）
 */
function sizeInfo(row, vocab) {
  const codes = codesOf(row);
  if (!codes.length || !vocab?.size) return null;

  // 把码本身也挂在条目上：shortLabel 要靠它判 CMD（码里数字是厘米）/ INS（码里数字是英寸）
  const entries = codes.map((c) => {
    const e = vocab.get(c);
    return e ? { ...e, code: c } : null;
  });
  // 词表里查不到的码：不猜（新家族出现而词表还没刷新时会走到这儿）
  if (entries.some((e) => !e)) return null;

  const grp = entries[0].grp;
  const labels = entries
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((e) => shortLabel(e.label, e.code));

  // 「都有」＝同家族里在售的码连成一段（中途不缺档）。
  // 这是**保守判据**：只看在售的码彼此连不连续，不看该款到底有哪几档——
  // 因为范围串的写法和词表并不一致（裤子写 '160/70A ~ 190/120C'，词表里却是
  // 'W28/28英寸/28码'），拿它比会得出不可靠的结果。
  const ords = entries.map((e) => e.ord).sort((a, b) => a - b);
  const sameFamily = entries.every((e) => e.grp === grp);
  let full = sameFamily && ords[ords.length - 1] - ords[0] === ords.length - 1;

  // 但范围串**能用的时候**（两端都能在词表里认出来：字母码 'S ~ XL'、厘米码 '110cm ~ 160cm'），
  // 再校一道——**只降不升**：在售的码只要有一个落在范围之外，就不能说「都有」。
  // 补的是这个缺口：该款 S~XL、只剩 XS 时，光看连续性会说「都 有」（只有一档当然连续），
  // 而范围明明写着它还有 S/M/L。认不出来（CMD/INS 那种写法）就跳过，维持上面的判断。
  if (full) {
    const labelOf = (code) => shortLabel(vocab.get(code)?.label, code);
    const fam = [...vocab.entries()].filter(([, e]) => e.grp === grp).map(([code, e]) => ({ code, ord: e.ord }));
    const idx = (text) => fam.find(({ code }) => labelOf(code).toLowerCase() === String(text).trim().toLowerCase());
    const [lo, hi] = String(row.size_range || '').split('~').map((t) => t.trim());
    const a = idx(lo);
    const b = idx(hi);
    if (a && b) {
      const inRange = new Set(fam.filter(({ ord }) => ord >= Math.min(a.ord, b.ord) && ord <= Math.max(a.ord, b.ord)).map((x) => x.code));
      if (codes.some((c) => !inRange.has(c))) full = false;
    }
  }

  return { full, labels, count: codes.length };
}

export { sizeInfo, fetchSizeVocab };


export default {
  id: 'uniqlo',
  label: '优衣库',
  aliases: ['uniqlo', 'uniql', 'u'],
  vercelProject: 'uniql',
  imageSize: 561,
  sizeVariant,
  /** 这件商品还剩哪些尺码（见上面 sizeInfo 那段）。答不出来返回 null */
  sizeInfo,
  fonts: FONTS,
  tags: TAGS,
  tableColumns,
  statsExtra: [],

  /** 抓全站特价商品 → 规范形状的商品数组 */
  async sync({ onPage, onTagDone } = {}) {
    const all = [];
    for (const tag of SALE_TAGS) {
      const items = await fetchAllByTag(tag, {
        pageSize: 100,
        onPage: ({ page, have, total }) => onPage?.({ label: TAGS[tag], page, have, total }),
      });
      onTagDone?.({ label: TAGS[tag], count: items.length });
      all.push(...items);
    }
    // 顺带刷一次尺码词表（一次请求，与搜索条件无关）
    const sizeVocab = await fetchSizeVocab().catch(() => []);
    return {
      fetched: all.length,
      products: dedupe(all).filter((p) => p.minPrice > 0).map(toCanonical),
      sizeVocab,
    };
  },

  /** 按吊牌编号精确查一件商品（编号在优衣库吊牌/商品页价格下方） */
  async findByCode(code) {
    const { products } = await search({ description: String(code), pageSize: 5 });
    const hit = products.find((p) => p.code === String(code)) || products[0] || null;
    return hit ? toCanonical(hit) : null;
  },

  /** 从用户输入（可能是编号、也可能直接贴了商品页地址）里抠出编号 */
  parseCode: (input) => String(input ?? '').match(/(\d{6})/)?.[1] || String(input ?? ''),

  copy: {
    syncTitle: '抓取优衣库特价商品…',
    // CLI 的 --sort 提示文案（cmdList 与 help 都在读它）
    sortHint: 'rate|saving|newest',
    dropped: '这次又降价的商品',
    permanent: '官方永久降价（原价下调，比限时特优更值得出手）',
    added: '本次新出现的特价商品（可能是刚降价，也可能之前就没抓全）',
    addedLimit: 25,
    addedWord: '新上架',
    permanentWord: '官方永久降价',
    raisedWord: '涨回原价',
    trackUsage: '编号在优衣库商品页价格下方或吊牌上',
    // 手动 track 的商品会按第一个命中的标签解释「这是什么性质的降价」
    trackTags: [
      { tag: 'concessional_rate', text: '超值精选（清仓，会继续降，但容易断码）' },
      { tag: 'time_doptimal', text: '限时特优（下周可能涨回原价）' },
    ],
    tagHint: 'time_doptimal|concessional_rate',
    sourceNote: '数据源：uniqlo.cn 公开搜索接口。价格以结账页为准。',
  },

  /**
   * 报告的文案与开关（`docs/REPORT-CONTRACT.md` 第三节那份 meta）。
   * 这里出现的中文都是**会随站点变**的那些 —— 页面结构不变、字样和开关变。
   */
  report: {
    label: '优衣库',
    pageTitle: '优衣库捡漏榜',
    currency: { sym: '¥', zero: '¥ 0' },
    imageAspect: '3/4',
    searchPlaceholder: '搜商品名或吊牌编号',
    searchLabel: '名称或编号',
    // 两个旧报告里的收藏/隐藏存在这两个前缀下（uniql.picks 等），沿用即可原样保留
    storagePrefix: 'uniql',
    showRecorded: false,
    crossLink: {
      href: 'https://goodprices.online/decathlon/',
      label: '迪卡侬',
      title: '迪卡侬比价报告（新标签打开）',
    },

    filters: [
      { key: 'all', label: '全部' },
      { key: 'time_doptimal', label: '限时特优' },
      { key: 'concessional_rate', label: '超值精选' },
      { key: 'tracked', label: '待拔草' },
    ],

    features: {
      rankBoard: true, // 页顶「本期降得最狠的五件」（优衣库独有）
      stickerTags: false,
      brandMark: false,
      priceOffBadge: false,
      dealBarNumber: true, // 卡片横条尾部的红色降幅数字
      cardChips: false,
      trackChip: false,
    },

    tagLabels: TAGS,
    chipTags: [], // 促销类型靠页签筛，卡片上不再一件一件挂标签


  },
};
