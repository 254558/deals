/**
 * 迪卡侬中国（decathlon.com.cn）—— 站点适配器。
 *
 * ── 两个域名，各管一半 ────────────────────────────────────────────────
 *   api-cn.decathlon.com.cn     发匿名令牌（identification）
 *   mpm-store.decathlon.com.cn  商品数据（wcc_bff）
 *
 * 商品接口要 `Authorization: Bearer <token>`，而这个 token 是**匿名**的，
 * 由前端自己现取现用（`window.__NUXT__.state.token`，TTL 两小时）。所以这里
 * 也自己取一枚，而不是去借浏览器的：
 *
 *   POST /facade_identification/connection/api/v1/dcn_cn/anonymous_token
 *   headers: x-api-key: <前端包里写死的那把>
 *   body:    { client_name: "DCN", social_id: <任意 uuid> }
 *   → { data: { user_token } }
 *
 * 两点实测结论，决定了这里的写法：
 *  1. `x-api-key` 是必需品。少了它令牌接口回 401 Unauthorized；而商品接口
 *     单独给 apiKey 也不行（它明确报 "Required request header 'Authorization'"）。
 *  2. 令牌里带 exp，两小时。这里按 exp 缓存，过期或真被打回 401 再换一枚。
 *
 * ── 站点前面的 WAF 拦不到这里 ─────────────────────────────────────────
 * www.decathlon.com.cn 挂了 FEC 的 JS 挑战，curl 直接 406。但上面两个域名
 * 不在那层后面，Node 直接 fetch 就是 200 —— 所以这个工具完全不用起浏览器。
 *
 * ── 价格字段怎么读 ────────────────────────────────────────────────────
 *   list_price    官方原价（迪卡侬自己的划线价）
 *   active_price  现价
 *   discount_rate **「折」，不是降幅**：2.5 就是 2.5 折（= 降 75%）。
 *                 `display_discount_rate` 决定官网页面上显不显示这个角标。
 * 单个商品有多个 model（不同颜色/款式各算一个），每个 model 自己一套价格，
 * 价格不一致时以最深的那个作为这件商品的价格 —— 捡漏榜要的是最划算的那档。
 */

const API_KEY = 'f3b79960-bb00-45b9-a205-6e14cddcbf9c';
const AUTH_HOST = 'https://api-cn.decathlon.com.cn';
const BFF_HOST = 'https://mpm-store.decathlon.com.cn';
const TOKEN_PATH = '/facade_identification/connection/api/v1/dcn_cn/anonymous_token';
const PLP_PATH = '/wcc_bff/api/v1/easymerch/plp/product_lists';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 「特惠专区」分类 —— 站点自己的折扣区，也是这个工具抓的商品池。
 * 全站按折扣率筛出来的量（约 1572）和它（1391）基本重合，但那条路要走
 * `filter={"discount_range":[...]}`，实测后端会串页（见 README），
 * 而这里一个分类翻 14 页就完事，稳定得多。
 */
const DISCOUNT_ZONE = '644a1c540c5c730001d1e6c1';

/** 「所有运动」根分类，`findByCode` 给还没进折扣区的商品兜底搜索用 */
const ALL_SPORTS = '644a1c540c5c730001d1dda2';

/** 标签。尾货＝清仓，会一路降到底；新品＝刚上架就打折。 */
const TAGS = {
  endlife: '尾货',
  new_arrival: '新品',
  discount_zone: '特惠专区',
};

/** 页面里出现过的角标文案 → 我们的标签码 */
const STICKER_TAGS = {
  尾货: 'endlife',
  清仓: 'endlife',
  新品: 'new_arrival',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

async function request(url, { method = 'GET', headers = {}, body, retries = 3, tag = '' } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
        err.status = res.status;
        throw err;
      }
      const json = JSON.parse(text);
      // 商品接口用 code=0 表示成功，令牌接口用 code="I05-1001"
      if (json.code !== 0 && json.code !== 'I05-1001') throw new Error(`接口返回失败: ${json.code} ${json.msg || json.title || ''}`);
      return json;
    } catch (err) {
      lastErr = err;
      // 401 是令牌过期，不是网络抖动 —— 交给调用方换令牌，重试没意义
      if (err.status === 401) throw err;
      if (i < retries - 1) await sleep(800 * (i + 1));
    }
  }
  throw new Error(`请求迪卡侬${tag ? ` ${tag}` : ''}接口失败: ${lastErr.message}`);
}

/** 令牌里带了 exp，解出来按真实过期时间缓存，不用自己猜 TTL */
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** 现取一枚匿名令牌。social_id 只是标识一个匿名访客，随便给个 uuid 即可。 */
async function fetchToken() {
  const json = await request(`${AUTH_HOST}${TOKEN_PATH}`, {
    method: 'POST',
    tag: '令牌',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      Origin: 'https://www.decathlon.com.cn',
      Referer: 'https://www.decathlon.com.cn/',
    },
    body: { client_name: 'DCN', social_id: crypto.randomUUID() },
  });
  const token = json.data?.user_token;
  if (!token) throw new Error('令牌接口没返回 user_token');
  return { token, exp: tokenExpiry(token) };
}

/** 令牌按 exp 缓存，过期前 5 分钟就换新的，免得翻页翻到一半失效 */
let cachedToken = null;

async function getToken({ force = false } = {}) {
  if (!force && cachedToken && Date.now() < cachedToken.exp - 5 * 60_000) return cachedToken.token;
  cachedToken = await fetchToken();
  return cachedToken.token;
}

async function bff(path, { tag, retries = 3 } = {}) {
  const call = (token) =>
    request(`${BFF_HOST}${path}`, {
      tag,
      retries,
      headers: { Authorization: `Bearer ${token}`, 'client-name': 'DCN' },
    });
  try {
    return await call(await getToken());
  } catch (err) {
    if (err.status !== 401) throw err;
    // 令牌过期（或服务端提前作废）：换一枚再打一次
    return await call(await getToken({ force: true }));
  }
}

/** 把一个 model 的价格压成 {listPrice, activePrice}；items 里价格不一致时取最低现价 */
function priceOf(model) {
  const listPrice = num(model.price?.list_price);
  let activePrice = num(model.price?.active_price);
  // uniform_price=false 时各 SKU 价格不同，榜上看最便宜的那档
  for (const item of model.items || []) {
    const p = num(item.price?.active_price);
    if (p > 0 && (activePrice <= 0 || p < activePrice)) activePrice = p;
  }
  return { listPrice, activePrice };
}

/** 降幅：¥129.90 → ¥29.90 得 0.7698 */
const discountRate = (listPrice, activePrice) => (listPrice > 0 ? Math.max(0, 1 - activePrice / listPrice) : 0);

/**
 * 把接口的商品对象整理成我们自己的结构。
 *
 * 一件商品（dsm_code）下挂若干 model，各是不同颜色/款式、各有各的价格。
 * 榜上按「这件商品最划算的那一档」呈现：先比降幅，降幅相同再比现价低。
 */
function normalize(p) {
  const models = (p.models || []).filter((m) => m.price);
  if (models.length === 0) return null;

  let best = null;
  for (const m of models) {
    const price = priceOf(m);
    if (price.activePrice <= 0 || price.listPrice <= 0) continue;
    const rate = discountRate(price.listPrice, price.activePrice);
    if (!best || rate > best.rate || (rate === best.rate && price.activePrice < best.activePrice)) {
      best = { model: m, ...price, rate };
    }
  }
  if (!best) return null;

  const m = best.model;
  const tags = new Set();
  for (const c of m.sticker_info?.contents || []) {
    const code = STICKER_TAGS[String(c.text || '').trim()];
    if (code) tags.add(code);
  }
  if (m.is_endlife) tags.add('endlife');
  for (const f of p.func_label_list || []) {
    if (f?.code === 'discount-zone') tags.add('discount_zone');
  }

  const dsmCode = String(p.dsm_code);
  const modelCode = String(m.model_code || '');
  // 一个 model 通常带 3 张图（主图 + 两张副图），而且**主图是会 410 的**：
  // 实测有 130 件的首图在 CDN 上已经 permanent gone（HTTP 410），副图却还在。
  // 所以整串都留着，下载时按顺序试，别只看第一张。
  const images = (m.media?.images || [])
    .map((i) => i.image_url)
    .filter((u) => typeof u === 'string' && u.startsWith('http'));
  return {
    dsmCode,
    modelCode,
    name: (m.web_label || p.family || '').trim(),
    brand: (p.brand_display_name || '').trim(),
    sports: (p.product_sports || '').trim(),
    nature: (p.product_nature || '').trim(),
    family: (p.family || '').trim(),
    catchLine: (p.catch_line || '').trim(),
    image: images[0] || '',
    images,
    modelCount: models.length,
    listPrice: best.listPrice, // 官方原价
    activePrice: best.activePrice, // 现价
    rate: best.rate, // 降幅 0~1
    onSale: m.price?.on_sale !== false,
    tags: [...tags],
    url: `https://www.decathlon.com.cn/product-detail?dsm_code=${dsmCode}${modelCode ? `&model_code=${modelCode}` : ''}`,
  };
}

/**
 * 抓一页商品（`fetchCategory` / `findByCode` 都走它）。
 * @param {string} opts.sort DEFAULT_SORT | NEW_PRODUCT | DISCOUNTS | PRICE | PRICE_DESC
 */
async function listProducts({ categoryId, page = 1, pageSize = 100, sort = 'DISCOUNTS' } = {}) {
  const qs = new URLSearchParams({
    category_id: categoryId,
    current_page: String(page),
    filter: '{}',
    page_size: String(pageSize),
    sort,
  });
  const json = await bff(`${PLP_PATH}?${qs}`, { tag: '商品列表' });
  const records = json.data?.records || {};
  const products = (records.products || []).map(normalize).filter(Boolean);
  return { products, total: records.total_num ?? products.length, totalPage: records.total_page ?? 1 };
}

/** 抓完一个分类 */
async function fetchCategory(categoryId, { pageSize = 100, sort = 'DISCOUNTS', onPage } = {}) {
  const all = [];
  const first = await listProducts({ categoryId, page: 1, pageSize, sort });
  all.push(...first.products);
  onPage?.({ page: 1, have: all.length, total: first.total });

  // total_page 是按总数算出来的，翻到底为止；中间某页空了也停
  for (let page = 2; page <= first.totalPage; page++) {
    await sleep(200); // 别把人家接口打太狠
    const { products } = await listProducts({ categoryId, page, pageSize, sort });
    if (products.length === 0) break;
    all.push(...products);
    onPage?.({ page, have: all.length, total: first.total });
  }
  return { products: all, total: first.total };
}

/** 按 dsm_code 去重，同一件商品在结果里可能因翻页重叠出现多次 */
function dedupe(products) {
  const map = new Map();
  for (const p of products) {
    const prev = map.get(p.dsmCode);
    if (!prev) {
      map.set(p.dsmCode, p);
      continue;
    }
    // 保留降得更狠的那个记录，并把标签合起来
    const better = p.rate > prev.rate ? p : prev;
    better.tags = [...new Set([...prev.tags, ...p.tags])];
    map.set(p.dsmCode, better);
  }
  return [...map.values()];
}

/** 接口形状 → 核心认的规范形状（见 docs/REPORT-CONTRACT.md 第四节） */
function toCanonical(p) {
  return {
    productCode: p.dsmCode,
    // 迪卡侬没有单独的吊牌号，dsm_code 自己就是给人看的编号
    code: p.dsmCode,
    name: p.name,
    brand: p.brand,
    sports: p.sports,
    season: '',
    sizeRange: '',
    url: p.url,
    image: p.image,
    images: p.images || (p.image ? [p.image] : []),
    tags: p.tags || [],
    extra: {
      modelCode: p.modelCode,
      nature: p.nature,
      family: p.family,
      catchLine: p.catchLine,
      modelCount: p.modelCount,
    },
    originPrice: p.listPrice,
    price: p.activePrice,
    monthlySales: 0,
    inStock: p.onSale !== false,
  };
}

/**
 * 图片档位：两个图床、两套缩放写法（这是踩过的坑）。
 *
 *  ① `pixl.decathlon.com.cn/p2678060/k$<hash>/content.jpg`
 *     缩放靠**路径**，把尺寸插在文件名前面：`/800x800/content.jpg`（25KB，原图 215KB）。
 *     query 参数（`?width=800`）完全无效，只会拿到原图。
 *     400/800/1000/1600 都正常，没有优衣库那种中间档全 404 的坑。
 *
 *  ② `easymerch-oss.object.decathlon.com.cn/emh-prd-tf/<日期>/<名>.jpg`
 *     阿里云 OSS 的对象地址，路径**不能**插尺寸（插了就是 404）；
 *     要用它自己的图片处理参数：`?x-oss-process=image/resize,w_800/quality,q_80`。
 *     实测 `resize,w_800` 单独用只从 502KB 降到 419KB，加上 `quality,q_80` 才降到 122KB。
 *
 * 认不出的形状原样返回 —— 宁可用原图，也不要拼出一个 404 的地址。
 */
const isOss = (url) => url.includes('object.decathlon.com.cn') || url.includes('aliyuncs.com');

function sizeVariant(imageUrl, size) {
  if (!imageUrl) return '';
  if (isOss(imageUrl)) {
    const [base] = imageUrl.split('?'); // 已经有处理参数的，先摘掉再拼
    return `${base}?x-oss-process=image/resize,w_${size}/quality,q_80`;
  }
  if (/\/\d+x\d+\//.test(imageUrl)) return imageUrl.replace(/\/\d+x\d+\//, `/${size}x${size}/`);
  const m = imageUrl.match(/^(.*\/)([^/]+)$/);
  if (!m) return imageUrl;
  return `${m[1]}${size}x${size}/${m[2]}`;
}

/** 报告里那张表：迪卡侬那份的第 7 列是品牌，没有月销/销量列 */
const tableColumns = [
  { head: '编号', w: 9, align: 'l', get: (r) => r.code },
  { head: '商品', w: 30, align: 'l', get: (r) => r.name, trunc: true },
  { head: '上市价', w: 9, align: 'r', get: (r) => `¥${r.origin_price}` },
  { head: '现价', w: 9, align: 'r', get: (r) => `¥${r.last_price}` },
  { head: '降幅', w: 7, align: 'r', get: (r) => `-${Math.round(r.rate * 100)}%` },
  { head: '省', w: 8, align: 'r', get: (r) => `¥${(r.origin_price - r.last_price).toFixed(0)}` },
  { head: '品牌', w: 13, align: 'l', get: (r) => r.brand || '-' },
  {
    head: '标签',
    w: 10,
    align: 'l',
    // 「特惠专区」人人都有，一个全都命中的标签等于没有标签，所以不当标签显示
    get: (r) => (r.tags || []).filter((t) => t !== 'discount_zone').map((t) => TAGS[t] || t).join('/'),
  },
];

export default {
  id: 'decathlon',
  label: '迪卡侬',
  aliases: ['decathlon', 'deca', 'd'],
  vercelProject: 'decathlon-deals',
  imageSize: 800,
  sizeVariant,
  fonts: null, // 迪卡侬这一站不内嵌字体，走系统字体栈
  tags: TAGS,
  tableColumns,
  statsExtra: [{ label: '其中尾货清仓', tag: 'endlife' }],

  /** 抓特惠专区 → 规范形状的商品数组 */
  async sync({ onPage } = {}) {
    const { products: raw, total } = await fetchCategory(DISCOUNT_ZONE, {
      pageSize: 100,
      sort: 'DISCOUNTS',
      onPage: ({ page, have, total: n }) => onPage?.({ label: null, page, have, total: n ?? total }),
    });
    return { fetched: raw.length, products: dedupe(raw).filter((p) => p.activePrice > 0).map(toCanonical) };
  },

  /** 按 dsm_code 精确查一件商品（编号是商品页地址里的 dsm_code） */
  async findByCode(code) {
    const target = String(code).trim();
    const { products } = await listProducts({ categoryId: DISCOUNT_ZONE, page: 1, pageSize: 100 });
    const exact = products.find((p) => p.dsmCode === target || p.modelCode === target);
    if (exact) return toCanonical(exact);
    // 折扣区里没有：说明这件还没降价（或不在折扣区），全站搜一遍
    const { products: all } = await listProducts({ categoryId: ALL_SPORTS, page: 1, pageSize: 100 });
    const hit = all.find((p) => p.dsmCode === target || p.modelCode === target) || null;
    return hit ? toCanonical(hit) : null;
  },

  /** 编号允许直接贴商品页地址，从中抽出 dsm_code 那一串数字 */
  parseCode: (input) => String(input ?? '').match(/(\d{5,9})/)?.[1] || String(input ?? ''),

  copy: {
    syncTitle: '抓取迪卡侬特惠专区…',
    // CLI 的 --sort 提示文案（cmdList 与 help 都在读它）
    sortHint: 'rate|saving|price|newest',
    dropped: '这次又降价的商品',
    permanent: '官方下调划线价（比打折更值得出手）',
    added: '本次新出现的商品（可能刚降价，也可能之前没抓全）',
    addedLimit: 30,
    addedWord: '新出现',
    permanentWord: '官方下调原价',
    raisedWord: '涨回去了',
    trackUsage: '编号是迪卡侬商品页地址里的 dsm_code',
    trackTags: [
      { tag: 'endlife', text: '尾货（清仓，会继续降，但容易断码）' },
      { tag: 'new_arrival', text: '新品（刚上架就在打折）' },
    ],
    tagHint: 'endlife|new_arrival',
    sourceNote: '数据源：decathlon.com.cn 公开接口。价格以结账页为准。',
  },

  /** 报告的文案与开关（`docs/REPORT-CONTRACT.md` 第三节那份 meta） */
  report: {
    // 报头只写「迪卡侬」：原来还带「· 中国官网」，又长又不带信息（数据源在页脚写着呢）
    label: '迪卡侬',
    pageTitle: '迪卡侬捡漏榜',
    currency: { sym: '￥', zero: '￥0' },
    imageAspect: '1/1',
    searchPlaceholder: '搜商品名、编号或品牌',
    searchLabel: '名称、编号或品牌',
    // 两个旧报告里的收藏/隐藏存在这两个前缀下（deca.picks 等），沿用即可原样保留
    storagePrefix: 'deca',
    // 报头不显示「共记录 N 件」了（2026-09-30 应要求去掉）。开关留着：它是 payload
    // 里的按站点配置，跟 rankBoard: false 一个性质，想显示回来改这一行即可
    showRecorded: false,
    crossLink: {
      href: 'https://goodprices.online/uniqlo/',
      label: '优衣库',
      title: '优衣库比价报告（新标签打开）',
    },

    filters: [
      { key: 'all', label: '全部' },
      { key: 'endlife', label: '尾货' },
      { key: 'new_arrival', label: '新品' },
      { key: 'tracked', label: '待拔草' },
    ],

    features: {
      rankBoard: false, // 页顶榜单是优衣库那站的东西，迪卡侬报告不摆
      stickerTags: true, // 商品图上的角标：红＝尾货清仓、灰＝新品
      brandMark: true, // 名称前那块品牌小字
      priceOffBadge: true, // 价格行里的黄底「-xx%」角标
      dealBarNumber: false,
      cardChips: true, // 卡片底部的 chips 行（托住卡片底边，整排对齐）
      trackChip: true, // ★ 待拔草 chip
    },

    tagLabels: TAGS,
    chipTags: ['endlife', 'new_arrival'],


  },
};
