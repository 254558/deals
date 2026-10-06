-- 「测评」的库结构（D1）。
--
-- 2026-10-06：这一页原来是「有品」市集（卖二手杂物），用户把它换成了测评：
-- 「大家可以分享自己在优衣库买的具体的衣服的测评，心得，值不值」。
-- 于是 listings / comments / reactions 三张表连同数据一起删掉了
-- （删之前导出过：backup/listings-2026-10-06.json、comments-2026-10-06.json、backup/images/）。
--
-- 现在只剩两张：
--   reviews —— 一条测评 = 一件优衣库商品 + 心得 + 可选的一张图
--   posts   —— 写入日志，只用来限速

-- ── 写入记录：限速用 ──────────────────────────────────────────────────────
-- 一张表服务所有写动作，靠 note 区分（'' ＝ 旧的二手发布，已经没了；'review' ＝ 测评），
-- 计数时也按 note 分开算 —— 共用一份预算的话，写两条测评就发不了东西了。
--
-- ⚠️ 2026-10-06 加 note 这一列时踩过一次：CREATE TABLE IF NOT EXISTS 对**已存在**的表
-- 不会补列，所以线上那张老表还是 (ip_hash, at)，而新代码往它写 note → 直接 500。
-- 改完必须单独跑一次 ALTER：
--   ALTER TABLE posts ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS posts (
  ip_hash TEXT NOT NULL,
  at      TEXT NOT NULL,
  note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_posts_ip ON posts (ip_hash, note, at);

-- ── 测评 ──────────────────────────────────────────────────────────────────
-- 和原来的 listings 的根本区别：**测评绑在商品上**（product_code）。
-- 榜单 payload 里每件商品也有同一个 product_code —— 两个功能于是共享同一个对象。
-- （2026-10-06 用户后来又把这条放松了：「不一定非要去榜单上找一件你用过的，
--   他可以测评任何优衣库的东西」—— 所以 product_code 现在来自 /api/search 的通用搜索，
--   不再限定于榜单里那几百件打折的。）
--
-- 用户明确要的字段只有两个：**心得 + 可选的图**。
-- 评分 / 值不值三档 / 尺码 / 身高体重 都问过，用户都不要（「连尺码也不要」），
-- 所以这里就是最短的那一版 —— 字段越少，越没人填错。
CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,           -- 随机 id，同时是图片地址（/api/img/<id>）
  created_at   TEXT NOT NULL,              -- ISO 时间
  product_code TEXT NOT NULL,              -- 优衣库 productCode
  code         TEXT NOT NULL DEFAULT '',   -- 吊牌编号（488131），给人认的
  name         TEXT NOT NULL DEFAULT '',   -- 写测评时的商品名（快照：官网会改）
  body         TEXT NOT NULL,              -- 心得
  image_mime   TEXT,                       -- 可选图；没图时这两列是 NULL
  image_bytes  BLOB,
  ip_hash      TEXT NOT NULL DEFAULT '',   -- 限速用；不存原始 IP
  token_hash   TEXT NOT NULL,              -- 写的人可以删自己那条（只存哈希）
  reports      INTEGER NOT NULL DEFAULT 0, -- 被举报次数
  hidden       INTEGER NOT NULL DEFAULT 0  -- 站长删 = 1（不真删）
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_code, hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_live    ON reviews (hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_ip      ON reviews (ip_hash, created_at);
