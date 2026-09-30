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
 *    `max_discount` 语义本来一致，直接留；差异在商品属性上：优衣库要
 *    season / sex / size_range / colors，迪卡侬要 brand / sports / nature /
 *    family / catch_line / model_code。报告真正会渲染的（brand / sports /
 *    season / size_range）给独立列，其余的进 `extra` —— 报告的数据是从列里
 *    组的，`extra` 不会流进 payload，不会白白撑大单文件报告。
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
  product_code      TEXT NOT NULL,      -- 站点内唯一的商品号（优衣库 productCode / 迪卡侬 dsm_code）
  code              TEXT,               -- 给人看的编号（优衣库吊牌 6 位数 / 迪卡侬 dsm_code）
  name              TEXT,
  brand             TEXT,               -- 迪卡侬有；优衣库空
  sports            TEXT,               -- 迪卡侬的「运动」；优衣库空
  season            TEXT,               -- 优衣库有；迪卡侬空
  size_range        TEXT,
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
  monthly_sales     INTEGER,            -- 优衣库的月销；迪卡侬没有，存 0
  in_stock          INTEGER,
  first_seen_at     TEXT,
  last_seen_at      TEXT,
  tracked           INTEGER DEFAULT 0,  -- 1 = 手动 track 盯着的，不是抓特价抓来的
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
CREATE INDEX IF NOT EXISTS idx_history_code ON price_history(site, product_code, observed_on);
`;

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
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
 * @param {object} db
 * @param {string} site 站点 id
 * @param {object[]} products 站点适配器归一化后的商品（见 sites/*.mjs 的 toCanonical）
 * @returns {{added: object[], dropped: object[], raised: object[], permanent: object[]}}
 *   added     第一次见到
 *   dropped   又降价了（现价比上次低）
 *   raised    涨回去了（限时活动结束）
 *   permanent 官方原价自己下调了 —— 比打折更值得出手
 */
export function saveSnapshot(db, site, products, { tracked = false } = {}) {
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
      site, product_code, code, name, brand, sports, season, size_range,
      image, images, url, tags, extra,
      launch_price, origin_price, min_price_ever, min_price_at, last_price, prev_price,
      max_discount, monthly_sales, in_stock, first_seen_at, last_seen_at, tracked
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(site, product_code) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      brand = excluded.brand,
      sports = excluded.sports,
      season = excluded.season,
      size_range = excluded.size_range,
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

  return { added, dropped, raised, permanent };
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

  // 盯着的商品不设降幅门槛——盯的就是还没降的那些，降了才好通知
  const where = trackedOnly
    ? 'WHERE site = ? AND tracked = 1'
    : `WHERE site = ?
         AND origin_price > last_price
         AND origin_price > 0
         AND in_stock = 1
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
           SUM(CASE WHEN tracked = 1 THEN 1 ELSE 0 END) AS tracked
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
  return { ...row, extras, lastRun };
}
