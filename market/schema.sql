-- 尾货市集：一件在售的二手/尾货 = 一行
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
  store       TEXT NOT NULL DEFAULT '',   -- 哪家店、哪个城市
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
