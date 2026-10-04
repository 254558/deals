-- 有品：一件在售的二手/尾货 = 一行
--
-- 图片直接存 D1（BLOB）。为什么不用 R2：R2 要绑支付方式；KV 又多一个要配的资源。
-- 这个量级（个人市集、几十上百件）D1 完全够，而且只需要**一个**绑定。
-- 代价是单行不能太大——所以图片在浏览器端先压到 ≤400KB 才发（见 market/index.html 的
-- 压缩那段），服务端也照样卡一遍。
CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,           -- 随机 id，同时是图片的地址（/api/img/<id>）
  created_at  TEXT NOT NULL,              -- ISO 时间，列表按它倒序
  title       TEXT NOT NULL,              -- 商品名（卖家自己写）
  price       REAL NOT NULL,              -- 标价（元）
  size        TEXT NOT NULL DEFAULT '',   -- 尺码
  contact     TEXT NOT NULL,              -- 微信 / 手机号 / 闲鱼链接，卖家自己填
  note        TEXT NOT NULL DEFAULT '',   -- 包邮还是到付、有瑕疵之类的说明
  image_mime  TEXT NOT NULL,
  image_bytes BLOB NOT NULL,
  ip_hash     TEXT NOT NULL DEFAULT '',   -- 限速用；**不存原始 IP**
  token_hash  TEXT NOT NULL,              -- 发帖人手里那条删除凭据的哈希（原文不存）
  reports     INTEGER NOT NULL DEFAULT 0, -- 被举报次数
  hidden      INTEGER NOT NULL DEFAULT 0  -- 站长删掉 = 1（不真删，留个记录好回查）
);
CREATE INDEX IF NOT EXISTS idx_listings_live ON listings (hidden, created_at DESC);

-- 发布记录：限速用（每个 ip_hash 24 小时内最多几件）
CREATE TABLE IF NOT EXISTS posts (
  ip_hash TEXT NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_ip ON posts (ip_hash, at);

-- 评论：谁都能评论别人发的尾货（没有账号体系，和发帖一样靠凭据 + 限速）
--
-- 为什么单独一张表：评论要能按件查、要能单独隐藏（站长删评论不动商品），
-- 而且发评论的限速要和发帖的**分开算**——共用一份预算的话，聊两句就发不了东西了。
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,            -- 随机 id
  listing_id TEXT NOT NULL,               -- 属于哪一件
  created_at TEXT NOT NULL,               -- ISO 时间，同一件内正序
  body       TEXT NOT NULL,               -- 正文（≤200 字）
  ip_hash    TEXT NOT NULL DEFAULT '',    -- 限速用，也用来认「卖家自己来答」
  token_hash TEXT NOT NULL,               -- 发评论的人可以删自己那条（只存哈希）
  hidden     INTEGER NOT NULL DEFAULT 0   -- 站长删 = 1（不真删）
);
CREATE INDEX IF NOT EXISTS idx_comments_listing ON comments (listing_id, hidden, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);

-- 点赞 / 收藏。没有账号体系，所以防重复只能靠 IP：
-- 主键 (listing_id, ip_hash, kind) → 同一个 IP 对同一条同一种动作只能留一行，
-- 再点一次就是把这行删掉（接口是「切换」语义）。
-- 收藏与点赞共用这张表，靠 kind 区分，以后加新动作不用改表。
CREATE TABLE IF NOT EXISTS reactions (
  listing_id TEXT NOT NULL,
  ip_hash    TEXT NOT NULL,
  kind       TEXT NOT NULL,           -- 'like' | 'save'
  created_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, ip_hash, kind)
);

CREATE INDEX IF NOT EXISTS idx_reactions_listing ON reactions(listing_id, kind);
