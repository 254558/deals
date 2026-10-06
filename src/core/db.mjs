/**
 * 本地历史库（SQLite，用 Node 内置的 `node:sqlite`，零依赖）。
 *
 * 为什么非要存历史：接口只告诉你「现在标着多少钱」。「上市价」是自己攒出来的
 * ——官方原价（或划线价）只降不涨，所以历次快照里见过的最高的那个原价，就是
 * 这件东西的上市价。同理「历史最低现价」也要靠攒。攒得越久越准，所以升级时
 * **绝不能因为表少了一列就崩**，也绝不重建表。
 *
 * ── 合并两个仓库时做的三件事 ────────────────────────────────────────────
 *
 * 1. **一张库装两个站点**，靠 `site` 列分区，主键是 `(site, product_code)`。
 *    两个旧库（deca.db 的 `dsm_code` / uniql.db 的 `product_code`）说的是同
 *    一件事：站点内唯一的商品号，所以统一成 `product_code`；`code` 那列留给
 *    「给人看的编号」（优衣库是吊牌上那 6 位数，迪卡侬就是 dsm_code 本身）。
 *    表头分别叫「编号」的那一列，读的就是 `code`。
 *
 * 2. **字段取并集，站点私有的塞进 `extra`（JSON）**。两个旧库的
 *    `origin_price` / `last_price` / `launch_price` / `min_price_ever` /
 *    `max_discount` 语义本来一致，直接留；差异在商品属性上：
 *    优衣库要 season / sex / size_range / colors，迪卡侬要 brand / sports /
 *    nature / family / catch_line / model_code。都进独立列，其余的进 `extra`
 *    —— 报告的数据是从列里组的，`extra` 不会流进 payload。
 *
 *    ⚠️ 2026-10-06 清理：这段话原来写着「报告真正会渲染的（brand / sports /
 *    season / size_range）给独立列」，把「存哪儿」和「报不报」混成了一句。
 *    实际上 payload 只报 **brand**（站点描述符驱动，优衣库为空串）；
 *    sports / season / size_range 只留在库里给适配器用（比如 size_range 是
 *    尺码推断的输入），**不再往报告里塞** —— 878 件 × 三个字段 ≈ 43 KB 原始，
 *    而 UI 一次都没读过。
 *
 * 3. **`in_stock` 成了两站共用的「还在售」开关**。优衣库那边是 `stock === 'Y'`，
 *    迪卡侬那边是 `price.on_sale !== false`，语义都是「这件现在能买」，
 *    榜上都只放能买的。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  site              TEXT NOT NULL,      -- 'uniqlo' | 'decathlon'
  product_code      TEXT NOT NULL,      -- 站点内唯一的商品号（优衣库 productCode / ZARA 商品号）
  code              TEXT,               -- 给人看的编号（优衣库吊牌 6 位数 / ZARA 商品页 -p 后面那串）
  name              TEXT,
  brand             TEXT,               -- ZARA 有；优衣库空
  sports            TEXT,               -- ZARA 的商品分类；优衣库空
  season            TEXT,               -- 优衣库有；ZARA 空
  size_range        TEXT,
  size_codes        TEXT,   -- 在售尺码的内部码（JSON 数组）——「还剩什么尺码」靠它
  image             TEXT,               -- 主图（远程 CDN 地址）
  images            TEXT,               -- JSON 数组：候选图链（主图挂了退副图）
  url               TEXT,
  tags              TEXT,               -- JSON 数组：站点自己的标签码
  extra             TEXT,               -- JSON：站点私有字段，只进库不进报告
  launch_price      REAL,               -- 上市价：见过的最高的官方原价
  origin_price      REAL,               -- 当前官方原价
  min_price_ever    REAL,               -- 历史最低现价
  min_price_at      TEXT,
  last_price        REAL,               -- 上次抓到的现价（用来判断"又降了"）
  prev_price        REAL,               -- 上上次的现价
  max_discount      REAL,               -- 见过的最深降幅（0.6 = 降过 60%）
  monthly_sales     INTEGER,            -- 优衣库的月销；ZARA 没有，存 0
  in_stock          INTEGER,
  first_seen_at     TEXT,
  last_seen_at      TEXT,
  tracked           INTEGER DEFAULT 0,  -- 1 = 手动 track 盯着的，不是抓特价抓来的
  missed            INTEGER DEFAULT 0,  -- 连续几次成功抓取没再见到它（>=2 视为已不在特价）
  PRIMARY KEY (site, product_code)
);

CREATE TABLE IF NOT EXISTS price_history (
  site          TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  observed_on   TEXT NOT NULL,          -- YYYY-MM-DD
  observed_at   TEXT NOT NULL,
  origin_price  REAL,
  price         REAL,
  tags          TEXT,
  PRIMARY KEY (site, product_code, observed_on)
);

CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site         TEXT,
  started_at   TEXT,
  finished_at  TEXT,
  fetched      INTEGER,
  discounted   INTEGER,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_discount ON products(site, max_discount);

-- 谢绝名单：按**吊牌号**屏蔽一个款（同款所有颜色一起消失）。
-- 为什么放在库里而不是只放浏览器：报告里的闭眼只能写那台浏览器的 localStorage，
-- 换设备 / 换域名（goodprices.online 与 deals-pinouts.pages.dev 是两个 origin）/
-- 清缓存就都不作数；名单进了库，生成报告时就直接不发出去。
-- 为什么是吊牌号而不是 product_code：优衣库一个款有多个颜色（各一个 productCode），
-- 实测 84 组吊牌号下挂着 2~3 件、名字一模一样——按颜色屏蔽时用户分不清
-- 「怎么删了还在」。
-- 优衣库的尺码词表：内部码（SMA004）→ 显示名（M）。
-- 来源是搜索接口带着 withSideBar: 'Y' 时返回的那一段（「尺码」分组，实测 69 档 12 个家族：
-- SMA 字母码、CMA/CMB/CMC 厘米码、CMD 腰围、INS 脚长、SHC 鞋码、SIZ999 均码…）。
-- 存进库而不是写死在代码里：这是接口给的数据，新家族出现时不用改代码；
-- grp/ord 保留它自己的分组与顺序，「是不是所有码都有货」靠这两个判（见适配器的 sizeInfo）。
CREATE TABLE IF NOT EXISTS size_vocab (
  site   TEXT NOT NULL,
  code   TEXT NOT NULL,          -- 内部码，如 SMA004
  label  TEXT,                   -- 接口给的显示名，如 'M' 或 'W28/28英寸/28码'
  grp    INTEGER,                -- 第几个尺码家族（同一家族的码排一队）
  ord    INTEGER,                -- 家族内的次序
  PRIMARY KEY (site, code)
);

CREATE TABLE IF NOT EXISTS blocked (
  site        TEXT NOT NULL,
  code        TEXT NOT NULL,          -- 吊牌号
  name        TEXT,                   -- 记下名字，列名单时看得懂
  blocked_at  TEXT,
  PRIMARY KEY (site, code)
);
CREATE INDEX IF NOT EXISTS idx_history_code ON price_history(site, product_code, observed_on);
`;

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * 给旧库补上后加的列。
 *
 * 这个工具的价值全在「攒了很久的历史」上，所以升级时**绝不能因为表少了一列就崩**，
 * 也绝不重建表。`CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，加列得自己来。
 * （合并前的迪卡侬那份有这个机制，合并时因为新库是空的就先省了；现在加 `missed`
 * 就必须把它补回来——用户的库里已经有一整天的数据了。）
 */
function migrate(db) {
  const have = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  const added = [
    // 连续几次成功抓取没再见到它。老库补齐时一律给 0：历史数据无从判断，
    // 从下一次 sync 开始正常累计。
    ['missed', 'ALTER TABLE products ADD COLUMN missed INTEGER DEFAULT 0'],
    // 在售尺码的内部码。老库补齐时为空——下一次 sync 就有值了（映射表将来改了
    // 也不用重抓：存的是码，翻译在适配器里做）。
    ['size_codes', 'ALTER TABLE products ADD COLUMN size_codes TEXT'],
  ];
  for (const [col, sql] of added) if (!have.has(col)) db.exec(sql);
}

const today = () => new Date().toISOString().slice(0, 10);

/** JSON 字段在库里是文本，读出来要还原成数组 */
function jsonArray(v) {
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(v) {
  if (v && typeof v === 'object') return v;
  try {
    const parsed = JSON.parse(v || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    tags: jsonArray(row.tags),
    images: jsonArray(row.images),
    sizeCodes: jsonArray(row.size_codes),
    extra: jsonObject(row.extra),
    is_lowest: row.min_price_ever != null && row.last_price <= row.min_price_ever,
  };
}

/** 一件商品的降幅（0~1）。用精确值，不四舍五入 —— 排序靠它。 */
export const discountRate = (originPrice, price) =>
  originPrice > 0 ? Math.max(0, 1 - price / originPrice) : 0;

/**
 * 写入一次抓取结果，顺便算出跟上次相比发生了什么。
 *
 * ── `missed`：这次没见到谁（用于「下架就跟着下架」）────────────────────
 *
 * 抓取池里消失的商品，以前是**永远留在榜上**的：`in_stock` 只在商品被抓到时才写，
 * 所以一件下架的商品会带着「在售」这个旧标记一直挂着，用户点进去才发现官网早没了。
 *
 * 现在每轮成功抓取都会给「没见到的」累加 `missed`、给「见到的」清零，
 * 榜单与报告默认排除 `missed >= 2`（连续两轮没见到）。
 *
 * 三个必须守住的边界（都是想清楚才写的，不是拍的）：
 *
 *  1. **只有整站抓取才算数**（`full: true`）。`deals <站点> track <编号>` 也是走
 *     saveSnapshot 的，它只写一件商品——要是也参与计数，其余几百件每 track 一次
 *     就被判「没见到」，几次下来全站都被误判成下架。
 *  2. **基准是最后一次「成功的」抓取**，不是最后一次抓取。失败的运行（接口挂了、
 *     翻页断在中途）如果参与对比，会把整站商品都算成没见到。
 *  3. **安全阀**：这一轮抓到的件数比上一轮成功抓取暴跌（不到 60%）时，本轮**一件
 *     都不标记**，只把 `bulkDrop` 报出去。一次半截的抓取不该让全站下架。
 *
 * @param {object} db
 * @param {string} site 站点 id
 * @param {object[]} products 站点适配器归一化后的商品（见 sites/*.mjs 的 toCanonical）
 * @param {object} [opts]
 * @param {boolean} [opts.tracked] 手动 track 的单件写入
 * @param {boolean} [opts.full] 整站抓取（只有它会更新 missed 计数）
 * @returns {{added, dropped, raised, permanent, missedOne, gone, bulkDrop}}
 *   missedOne 本轮第一次没见到（还没到下架判定）
 *   gone      本轮刚跨过 2 次、正式判为「已不在特价」的
 *   bulkDrop  件数暴跌、本轮跳过下架判定（true 表示跳过了）
 */
export function saveSnapshot(db, site, products, { tracked = false, full = false } = {}) {
  const now = new Date().toISOString();
  const on = today();

  const prev = new Map(
    db
      .prepare('SELECT product_code, last_price, origin_price, max_discount FROM products WHERE site = ?')
      .all(site)
      .map((r) => [r.product_code, r])
  );

  const added = [];
  const dropped = [];
  const raised = [];
  const permanent = [];

  const upsert = db.prepare(`
    INSERT INTO products (
      site, product_code, code, name, brand, sports, season, size_range, size_codes,
      image, images, url, tags, extra,
      launch_price, origin_price, min_price_ever, min_price_at, last_price, prev_price,
      max_discount, monthly_sales, in_stock, first_seen_at, last_seen_at, tracked
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(site, product_code) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      brand = excluded.brand,
      sports = excluded.sports,
      season = excluded.season,
      size_range = excluded.size_range,
      size_codes = excluded.size_codes,
      image = excluded.image,
      images = excluded.images,
      url = excluded.url,
      tags = excluded.tags,
      extra = excluded.extra,
      launch_price = MAX(COALESCE(products.launch_price, 0), excluded.launch_price),
      origin_price = excluded.origin_price,
      prev_price = products.last_price,
      last_price = excluded.last_price,
      min_price_ever = MIN(COALESCE(products.min_price_ever, 9e9), excluded.min_price_ever),
      min_price_at = CASE
        WHEN excluded.min_price_ever < COALESCE(products.min_price_ever, 9e9) THEN excluded.min_price_at
        ELSE products.min_price_at END,
      max_discount = MAX(COALESCE(products.max_discount, 0), excluded.max_discount),
      monthly_sales = excluded.monthly_sales,
      in_stock = excluded.in_stock,
      last_seen_at = excluded.last_seen_at,
      tracked = MAX(products.tracked, excluded.tracked)
  `);

  const hist = db.prepare(`
    INSERT INTO price_history (site, product_code, observed_on, observed_at, origin_price, price, tags)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(site, product_code, observed_on) DO UPDATE SET
      observed_at = excluded.observed_at,
      origin_price = excluded.origin_price,
      price = MIN(price_history.price, excluded.price),
      tags = excluded.tags
  `);

  db.exec('BEGIN');
  try {
    for (const p of products) {
      const before = prev.get(p.productCode);
      const rate = discountRate(p.originPrice, p.price);

      if (!before) added.push(p);
      else {
        if (p.price < before.last_price) dropped.push({ ...p, from: before.last_price });
        else if (p.price > before.last_price && before.last_price > 0) raised.push({ ...p, from: before.last_price });
        // 官方原价下调 = 永久降价，比限时活动更值得出手
        if (p.originPrice > 0 && before.origin_price > 0 && p.originPrice < before.origin_price)
          permanent.push({ ...p, from: before.origin_price });
      }

      upsert.run(
        site, p.productCode, p.code, p.name, p.brand || '', p.sports || '', p.season || '', p.sizeRange || '',
        JSON.stringify(p.sizeCodes || []),
        p.image || '', JSON.stringify(p.images || (p.image ? [p.image] : [])), p.url || '',
        JSON.stringify(p.tags || []), JSON.stringify(p.extra || {}),
        p.originPrice, p.originPrice, p.price, on, p.price, null,
        rate, p.monthlySales || 0, p.inStock ? 1 : 0, now, now, tracked ? 1 : 0
      );
      hist.run(site, p.productCode, on, now, p.originPrice, p.price, JSON.stringify(p.tags || []));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // 谁这次没见到 —— 和「写今天这批」是两件事，抽到下面那个函数里
  const missing = full ? markMissing(db, site, products, now) : { missedOne: 0, gone: 0, bulkDrop: false };

  return { added, dropped, raised, permanent, ...missing };
}

/**
 * 「这一轮谁没见到」的记账。**只有整站抓取才更新**（边界见 saveSnapshot 函数头那三条）。
 *
 * 2026-10-06 整理从 saveSnapshot 里抽出来的：那边是「把今天抓到的一批写进去」，
 * 这边是「给没抓到的那批记账」，两件事共用一个事务之外的东西只有 `db / site / now`。
 * 抽开之后 saveSnapshot 回到 ~80 行，这一段也终于有了自己的名字。
 *
 * @returns {{missedOne:number, gone:number, bulkDrop:boolean}}
 */
function markMissing(db, site, products, now) {
  // 安全阀：跟「上一次成功抓取」的件数比，暴跌就整轮跳过判定。
  // 一次半截的抓取（翻页断在中途）不该让全站下架 —— 这是这个函数存在的理由。
  const prevRun = db
    .prepare('SELECT discounted FROM runs WHERE site = ? AND finished_at IS NOT NULL AND discounted > 0 ORDER BY id DESC LIMIT 1')
    .get(site);
  if (prevRun && products.length < prevRun.discounted * 0.6) {
    return { missedOne: 0, gone: 0, bulkDrop: true };
  }

  const count = (where, ...args) => db.prepare(`SELECT COUNT(*) AS n FROM products WHERE site = ? AND ${where}`).get(site, ...args).n;
  // 先数再改：missed = 0 的这轮第一次没见到，missed = 1 的这轮跨过 2 次、正式判为「已不在特价」
  const missedOne = count('last_seen_at < ? AND missed = 0', now);
  const gone = count('last_seen_at < ? AND missed = 1', now);
  db.prepare('UPDATE products SET missed = 0 WHERE site = ? AND last_seen_at >= ?').run(site, now);
  db.prepare('UPDATE products SET missed = missed + 1 WHERE site = ? AND last_seen_at < ? AND missed < 99').run(site, now);
  return { missedOne, gone, bulkDrop: false };
}

/** 覆盖写一站点的尺码词表（每次 sync 刷新一遍） */
export function saveSizeVocab(db, site, entries) {
  const ins = db.prepare('INSERT OR REPLACE INTO size_vocab (site, code, label, grp, ord) VALUES (?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM size_vocab WHERE site = ?').run(site);
    for (const e of entries) ins.run(site, e.code, e.label, e.grp, e.ord);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return entries.length;
}

/** 读一站的尺码词表 → Map(code → {label, grp, ord}) */
export function loadSizeVocab(db, site) {
  const rows = db.prepare('SELECT code, label, grp, ord FROM size_vocab WHERE site = ?').all(site);
  return new Map(rows.map((r) => [r.code, r]));
}

/** 把一个款加进谢绝名单（幂等） */
export function blockCode(db, site, code, name = '') {
  db.prepare(
    `INSERT INTO blocked (site, code, name, blocked_at) VALUES (?,?,?,?)
     ON CONFLICT(site, code) DO UPDATE SET name = excluded.name`
  ).run(site, String(code), name, new Date().toISOString());
}

/** 从谢绝名单里去掉一个款 */
export function unblockCode(db, site, code) {
  return db.prepare('DELETE FROM blocked WHERE site = ? AND code = ?').run(site, String(code)).changes;
}

/** 谢绝名单（按加入时间倒序） */
export function listBlocked(db, site) {
  return db.prepare('SELECT code, name, blocked_at FROM blocked WHERE site = ? ORDER BY blocked_at DESC').all(site);
}

/**
 * 把用户敲的一个参数解析成「要屏蔽的吊牌号」。三种都收：
 *   吊牌号        488089
 *   product_code  u0000000072656（优衣库）
 *   商品名        抽褶裙（只在**唯一命中一个款**时才认，歧义就让你挑）
 *
 * @returns {{ok:true, code:string, name:string, ids:string[]}
 *          |{ok:false, reason:'notfound'}
 *          |{ok:false, reason:'ambiguous', candidates:{code:string,name:string,n:number}[]}}
 */
export function resolveBlockTarget(db, site, query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'notfound' };

  const idsOf = (code) =>
    db.prepare('SELECT product_code FROM products WHERE site = ? AND code = ?').all(site, code).map((r) => r.product_code);
  const nameOf = (code) =>
    db.prepare('SELECT name FROM products WHERE site = ? AND code = ? LIMIT 1').get(site, code)?.name || '';

  // 1) 直接是 product_code
  const byProduct = db.prepare('SELECT code FROM products WHERE site = ? AND product_code = ?').get(site, q);
  if (byProduct) return { ok: true, code: byProduct.code, name: nameOf(byProduct.code), ids: idsOf(byProduct.code) };

  // 2) 直接是吊牌号。名下 0 件也认——名单允许先记下，商品以后才回来
  const exists = db.prepare('SELECT 1 AS x FROM products WHERE site = ? AND code = ? LIMIT 1').get(site, q);
  if (exists) return { ok: true, code: q, name: nameOf(q), ids: idsOf(q) };

  // 3) 当成商品名（子串）
  const hits = db
    .prepare('SELECT code, MIN(name) AS name, COUNT(*) AS n FROM products WHERE site = ? AND name LIKE ? GROUP BY code')
    .all(site, '%' + q + '%');
  if (hits.length === 0) return { ok: false, reason: 'notfound' };
  if (hits.length === 1) return { ok: true, code: hits[0].code, name: hits[0].name, ids: idsOf(hits[0].code) };
  return { ok: false, reason: 'ambiguous', candidates: hits };
}

export function startRun(db, site, note = '') {
  const r = db.prepare('INSERT INTO runs (site, started_at, note) VALUES (?,?,?)').run(site, new Date().toISOString(), note);
  return r.lastInsertRowid;
}

export function finishRun(db, id, { fetched, discounted }) {
  db.prepare('UPDATE runs SET finished_at=?, fetched=?, discounted=? WHERE id=?')
    .run(new Date().toISOString(), fetched, discounted, id);
}

/**
 * 捡漏榜：默认按降幅排序，只保留真的比原价便宜的、还在售的。
 *
 * 排序键是两家的并集：`rate`（降幅）、`saving`（省多少）、`price`（现价，
 * 迪卡侬用）、`sales`（月销，优衣库用）、`newest`（新出现）。
 *
 * @param {object} opts
 * @param {'rate'|'saving'|'price'|'sales'|'newest'} [opts.sort]
 * @param {string} [opts.tag] 只看某个标签（优衣库 concessional_rate / 迪卡侬 endlife）
 */
export function listDeals(db, site, { sort = 'rate', limit = 40, minRate = 0.2, trackedOnly = false, tag = '' } = {}) {
  const order =
    {
      rate: 'max_discount DESC',
      saving: '(origin_price - last_price) DESC',
      price: 'last_price ASC',
      sales: 'monthly_sales DESC',
      newest: 'first_seen_at DESC',
    }[sort] || 'max_discount DESC';

  // 盯着的商品不设降幅门槛——盯的就是还没降的那些，降了才好通知；
  // 也**不排除已不在特价的**：那正是你等它的意义，宁可让它留着并标出来
  const where = trackedOnly
    ? 'WHERE site = ? AND tracked = 1'
    : `WHERE site = ?
         AND origin_price > last_price
         AND origin_price > 0
         AND in_stock = 1
         AND missed < 2
         AND (1.0 - last_price * 1.0 / origin_price) >= ?`;
  const params = trackedOnly ? [site] : [site, minRate];

  // tags 是 JSON 文本，用 LIKE 粗筛足够（标签都是 ASCII 码）
  const tagClause = tag ? `AND tags LIKE '%"${tag}"%'` : '';

  const rows = db
    .prepare(`
    SELECT *, (origin_price - last_price) AS saving,
           CASE WHEN origin_price > 0 THEN 1.0 - last_price * 1.0 / origin_price ELSE 0 END AS rate
    FROM products
    ${where} ${tagClause}
    ORDER BY ${order}
    LIMIT ?
  `)
    .all(...params, limit);
  return rows.map(hydrate);
}

/** 手动盯的商品（不参与特价筛选，永远显示） */
export function listTracked(db, site) {
  return db
    .prepare(`
    SELECT *, (origin_price - last_price) AS saving,
           CASE WHEN origin_price > 0 THEN 1.0 - last_price * 1.0 / origin_price ELSE 0 END AS rate
    FROM products WHERE site = ? AND tracked = 1 ORDER BY rate DESC
  `)
    .all(site)
    .map(hydrate);
}

/** 最近一次抓取里又降价的商品（`deals <站点> new`） */
export function listJustDropped(db, site, limit = 60) {
  return db
    .prepare(`
    SELECT *, (origin_price - last_price) AS saving,
           CASE WHEN origin_price > 0 THEN 1.0 - last_price * 1.0 / origin_price ELSE 0 END AS rate
    FROM products
    WHERE site = ?
      AND prev_price IS NOT NULL AND last_price < prev_price AND origin_price > 0
      AND missed < 2
    ORDER BY (prev_price - last_price) DESC
    LIMIT ?
  `)
    .all(site, limit)
    .map(hydrate);
}

/**
 * 某件商品的价格历史，一天一条（只读本地快照，不去接口核对）。
 *
 * 参数是用户手里的那个**显示编号**（优衣库是吊牌 6 位数、迪卡侬是 dsm_code），
 * 而历史表记的是 `product_code`。两家在迪卡侬那边两者恰好相同，优衣库那边不同
 * （`488089` vs `u0000000072656`），所以这里先按两种编号都试着定位一次。
 */
export function historyOf(db, site, code) {
  const hit = db
    .prepare('SELECT product_code FROM products WHERE site = ? AND (product_code = ? OR code = ?) LIMIT 1')
    .get(site, code, code);
  const key = hit?.product_code ?? code;
  return db
    .prepare(`
    SELECT observed_on, origin_price, price FROM price_history
    WHERE site = ? AND product_code = ? ORDER BY observed_on
  `)
    .all(site, key);
}

/**
 * 本地数据概览。
 * @param {Array<{label:string, tag:string}>} extraStats 站点私有的统计行
 *   （迪卡侬要「其中尾货清仓」，优衣库没有）
 */
export function stats(db, site, { extraStats = [] } = {}) {
  const row = db
    .prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN origin_price > last_price THEN 1 ELSE 0 END) AS discounted,
           SUM(CASE WHEN tracked = 1 THEN 1 ELSE 0 END) AS tracked,
           SUM(CASE WHEN missed >= 2 THEN 1 ELSE 0 END) AS gone,
           SUM(CASE WHEN missed = 1 THEN 1 ELSE 0 END) AS missing_once
    FROM products WHERE site = ?
  `)
    .get(site);

  const extras = {};
  for (const e of extraStats) {
    extras[e.tag] = db
      .prepare(`SELECT COUNT(*) AS n FROM products WHERE site = ? AND tags LIKE ?`)
      .get(site, `%"${e.tag}"%`).n;
  }

  const lastRun = db.prepare('SELECT * FROM runs WHERE site = ? ORDER BY id DESC LIMIT 1').get(site);
  const blocked = db.prepare('SELECT COUNT(*) AS n FROM blocked WHERE site = ?').get(site).n;
  return { ...row, extras, lastRun, blocked };
}
