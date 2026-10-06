/**
 * 测评接口用的小工具：JSON 回应、字段校验、限速、凭据哈希。
 *
 * 这一层刻意不碰数据库句柄的形状（只当 `env.DB` 是 D1）——测试里塞一个假的进去就能跑。
 *
 * 2026-10-06：这里原来还有一整套「二手 + 评论」的校验与限速（validate / checkRate /
 * validateComment / checkCommentRate，以及各自的上限常量）。「有品」换成测评之后
 * 那些全没人用了，**整块删掉** —— 留着只会让下一个人以为还有别的写入路径。
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
 * 写入者 IP 的哈希（只用来限速）。
 * 不存原始 IP；固定盐只是别让哈希能被彩虹表直接反查，不是安全边界。
 */
export const ipHash = (request) =>
  SHA('deals-reviews|' + (request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown'));

/** 图片体积上限（浏览器端已经压过一轮，这里再卡一道） */
export const MAX_IMAGE_BYTES = 400 * 1024;

/** 一条测评最长多少字、每个 IP 24 小时最多几条、全站一天最多几条 */
export const MAX_REVIEW_LEN = 500;
export const REVIEWS_PER_IP_PER_DAY = 20;
export const REVIEWS_PER_DAY_GLOBAL = 300;

/**
 * 校验一条测评；返回 { ok:true, value } 或 { ok:false, error }。
 *
 * 字段只有三个：**哪件商品 + 心得 + 可选的一张图**（用户 2026-10-06 明确：
 * 「就可以发图片，发心得」；评分、尺码、身高体重都问过，都不要）。
 * 所以这里的规矩就三条：得知道是哪件、心得别是空的、图别超。
 */
export function validateReview(input) {
  const productCode = clean(input.productCode, 40);
  const code = clean(input.code, 24);
  const name = clean(input.name, 80);
  const body = clean(input.body, MAX_REVIEW_LEN);
  const image = String(input.image || '');
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);

  // 绑不上商品就没意义了 —— 这正是它和「市集」的区别
  if (!productCode) return { ok: false, error: '不知道这件是哪件（缺商品号）' };
  if (len(body) < 4) return { ok: false, error: '多写两句吧（至少 4 个字）' };
  if (len(String(input.body ?? '').trim()) > MAX_REVIEW_LEN) return { ok: false, error: '最多 ' + MAX_REVIEW_LEN + ' 字' };
  // 图是**可选**的：不给就存 NULL
  if (!m) return { ok: true, value: { productCode, code, name, body, mime: null, b64: null } };

  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return { ok: false, error: '图片太大了（' + Math.round(approxBytes / 1024) + 'KB，上限 400KB）' };

  return { ok: true, value: { productCode, code, name, body, mime: m[1], b64: m[2] } };
}

/**
 * 写入限速。日志表 `posts` 一张表服务所有写动作，靠 note 区分
 * （'' = 旧的二手发布，已经没了；'review' = 测评），计数也按 note 分开算。
 * 返回 null 表示放行，否则返回该回给用户的话。
 */
export async function checkReviewRate(env, hash, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const day = now.toISOString().slice(0, 10);

  const mine = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE ip_hash = ? AND note = 'review' AND at > ?"
  ).bind(hash, since).first();
  if ((mine?.n ?? 0) >= REVIEWS_PER_IP_PER_DAY) {
    return '今天你写得有点多，歇一会儿（每 24 小时最多 ' + REVIEWS_PER_IP_PER_DAY + ' 条）。';
  }

  const all = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE note = 'review' AND at LIKE ?"
  ).bind(day + '%').first();
  if ((all?.n ?? 0) >= REVIEWS_PER_DAY_GLOBAL) return '今天全站的测评到上限了，明天再来。';

  await env.DB.prepare("INSERT INTO posts (ip_hash, at, note) VALUES (?, ?, 'review')").bind(hash, now.toISOString()).run();
  await env.DB.prepare('DELETE FROM posts WHERE at < ?').bind(since).run();
  return null;
}
