/**
 * 尾货市集接口用的小工具：JSON 回应、字段校验、限速、凭据哈希。
 *
 * 这一层刻意不碰数据库句柄的形状（只当 `env.DB` 是 D1）——测试里塞一个假的进去就能跑。
 */

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

export const fail = (message, status = 400) => json({ ok: false, error: message }, status);

/** 字符数（按码点算，中文算一个） */
export const len = (s) => [...String(s ?? '')].length;

/** 去掉首尾空白 + 把连续空白压成一个空格 + 砍掉控制字符 */
export const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);

export const SHA = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const randomId = (bytes = 8) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const randomToken = (bytes = 16) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * 发帖人 IP 的哈希（只用来限速）。
 * 不存原始 IP；固定盐只是别让哈希能被彩虹表直接反查，不是安全边界。
 */
export const ipHash = (request) =>
  SHA('deals-market|' + (request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown'));

/** 允许的图片类型与体积（浏览器端已经压过一轮，这里再卡一道） */
export const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_IMAGE_BYTES = 400 * 1024;

/** 每个 IP 24 小时最多发几件、整个市集一天最多几件 */
export const PER_IP_PER_DAY = 5;
export const PER_DAY_GLOBAL = 200;

/**
 * 限速。返回 null 表示放行（并把这次记上），否则返回该回给用户的话。
 */
export async function checkRate(env, hash, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const day = now.toISOString().slice(0, 10);

  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE ip_hash = ? AND at > ?').bind(hash, since).first();
  if ((mine?.n ?? 0) >= PER_IP_PER_DAY) return '今天你发得有点多，歇一天再来（每 24 小时最多 5 件）。';

  const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE at LIKE ?").bind(day + '%').first();
  if ((all?.n ?? 0) >= PER_DAY_GLOBAL) return '今天整个市集的新帖到上限了，明天再来。';

  await env.DB.prepare('INSERT INTO posts (ip_hash, at) VALUES (?, ?)').bind(hash, now.toISOString()).run();
  // 顺手清掉一周前的记录，表不会一直长
  await env.DB.prepare('DELETE FROM posts WHERE at < ?').bind(new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()).run();
  return null;
}

/**
 * 校验一条待发布的商品；返回 { ok:true, value } 或 { ok:false, error }。
 *
 * `imageOptional` 给「编辑」用：编辑时可以不换图（沿用库里那张），所以 image 允许缺失；
 * 但**给了就必须是合法的**——不能指望前端一定压过。
 */
export function validate(input, { imageOptional = false } = {}) {
  const title = clean(input.title, 60);
  const contact = clean(input.contact, 80);
  const size = clean(input.size, 24);
  const note = clean(input.note, 240);
  const price = Number(input.price);
  const image = String(input.image || '');
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);

  if (len(title) < 2) return { ok: false, error: '商品名太短了（至少 2 个字）' };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: '价格没填对' };
  if (price > 99999) return { ok: false, error: '价格超出范围' };
  if (len(contact) < 2) return { ok: false, error: '留个联系方式吧，不然没人找得到你（微信 / 手机号都行）' };
  if (len(note) > 240) return { ok: false, error: '说明太长了' };
  if (!m) {
    if (imageOptional && !image) return { ok: true, value: { title, price, size, note, contact, mime: null, b64: null } };
    return { ok: false, error: '图片格式不对（只收 jpg / png / webp）' };
  }

  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, error: `图片太大了（${Math.round(approxBytes / 1024)}KB，上限 400KB）` };

  return { ok: true, value: { title, price, size, note, contact, mime: m[1], b64: m[2] } };
}

/** 每条评论最长多少字、每个 IP 24 小时最多几条、全站一天最多几条 */
export const MAX_COMMENT_LEN = 200;
export const COMMENTS_PER_IP_PER_DAY = 20;
export const COMMENTS_PER_DAY_GLOBAL = 500;

/** 校验一条评论；返回 { ok:true, value } 或 { ok:false, error } */
export function validateComment(input) {
  const body = clean(input.body, MAX_COMMENT_LEN);
  if (len(body) < 1) return { ok: false, error: '写点什么吧' };
  if (len(String(input.body ?? '').trim()) > MAX_COMMENT_LEN) return { ok: false, error: `评论最多 ${MAX_COMMENT_LEN} 字` };
  return { ok: true, value: { body } };
}

/**
 * 评论限速。**和发帖分开算**（各查各的表）——共用一份预算的话，聊两句就发不了东西了。
 * 返回 null 表示放行，否则返回该回给用户的话。
 */
export async function checkCommentRate(env, hash, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const day = now.toISOString().slice(0, 10);

  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?').bind(hash, since).first();
  if ((mine?.n ?? 0) >= COMMENTS_PER_IP_PER_DAY) return `今天你评论得有点多，歇一会儿（每 24 小时最多 ${COMMENTS_PER_IP_PER_DAY} 条）。`;

  const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE created_at LIKE ?').bind(day + '%').first();
  if ((all?.n ?? 0) >= COMMENTS_PER_DAY_GLOBAL) return '今天整个市集的评论到上限了，明天再来。';

  return null;
}
