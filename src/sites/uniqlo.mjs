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
    name: (p.name4zhCN || p.name || '').trim(),
    fullName: (p.productName4zhCN || p.productName || '').trim(),
    season: p.season4zhCN || p.season || '',
    sex: p.sex4zhCN || '',
    material: p.material4zhCN || '',
    image: p.mainPic ? IMAGE_BASE + p.mainPic : '',
    colors: (p.styleText4zhCN || []).map((s) => s.trim()),
    sizeRange: [p.minSize4zhCN, p.maxSize4zhCN].filter(Boolean).join(' ~ '),
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

export default {
  id: 'uniqlo',
  label: '优衣库',
  aliases: ['uniqlo', 'uniql', 'u'],
  vercelProject: 'uniql',
  imageSize: 561,
  sizeVariant,
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
    return { fetched: all.length, products: dedupe(all).filter((p) => p.minPrice > 0).map(toCanonical) };
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
    sortHint: 'rate|saving|newest',
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
    source: 'uniqlo.cn 公开搜索接口',
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

    columns: [
      { key: 'name', label: '商品', align: 'l', kind: 'name' },
      { key: 'launchPrice', label: '上市价', align: 'r', kind: 'was' },
      { key: 'price', label: '现价', align: 'r', kind: 'now' },
      { key: 'rate', label: '降幅', align: 'l', kind: 'scale' },
    ],
    textKeys: ['name'],

    features: {
      rankBoard: true, // 页顶「本期降得最狠的五件」（优衣库独有）
      stickerTags: false,
      brandMark: false,
      priceOffBadge: false,
      dealBarNumber: true, // 卡片横条尾部的红色降幅数字
      cardChips: false,
      trackChip: false,
      rowMetaLine: false,
      rowChips: false,
      flatWasDash: false,
      scaleLayout: 'inline', // 降幅数字贴在标尺条尾
    },

    tagLabels: TAGS,
    chipTags: [], // 促销类型靠页签筛，卡片上不再一件一件挂标签

    foot: {
      terms: [
        {
          t: '上市价',
          d: '优衣库官方原价只降不涨，所以工具取历次抓取中最高的原价作为上市价。首次抓取时它等于当前原价；若之后官方永久降价，这里会保留更高的历史值——那才是真正的上市价。',
        },
        {
          t: '限时特优',
          d: '每周轮换的活动价，下周会涨回原价。尺码齐、价格合适就该下手。这一类不再一件一件标在卡片上，工具条上有同名页签，点一下只看这一类。',
        },
        {
          t: '超值精选',
          d: '换季清仓，会一路降到底，但降到最后往往开始断码。可以多等几轮再出手；要看这一类同样走工具条页签。',
        },
        {
          t: '收藏 / 不再出现',
          d: '点图直接去官网商品页。两个图标都顶在行尾右端——大图视图里在价格行，列表视图里在名称下面那一行：爱心收进「待拔草」，闭眼让这件不再出现，工具栏右端的「已隐藏 N 件 · 放回」能一次全放回来。两本账都存在这台电脑的浏览器里，报告重新生成也还在，但换浏览器或清缓存就没了。',
        },
        {
          t: '标尺怎么读',
          d: '横轴是价格轴，左端上市价、右端 ¥0，墨条从上市价铺到现价——墨条越长，降得越狠。整屏扫一遍就知道该看哪几件。',
        },
      ],
      source: '数据源 uniqlo.cn 公开搜索接口 · 价格以结账页为准 · 本工具与迅销集团及优衣库官方无关',
      notes: [
        '版面尺寸（缩略图 3:4、列宽、卡片网格、字号）量自 uniqlo.cn；配色与价格排版跟迪卡侬那份报告统一（墨 #000f17、品牌蓝 #3643ba、降幅红字 #e20c18、上市价划线）。',
        '中文用 Source Han Sans CN（思源黑体）子集内嵌 —— Copyright © 2014 Adobe Systems Incorporated，Apache License 2.0；西文退到 Helvetica Neue，因为官网的 Uniqlo Pro 是品牌字体、不能内嵌。',
      ],
    },

    fontNotice: FONTS.notice,
  },
};
