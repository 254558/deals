import { json, fail, validate, ipHash, checkRate, randomId, randomToken, SHA } from './_lib.mjs';

/** 列表最大条数（个人市集，几十上百件就到头了） */
const LIMIT = 200;

/** GET /api/listings —— 在售列表，最新在前（不含图片数据，图片走 /api/img/<id>） */
export async function onRequestGet({ env }) {
  // 顺手带上评论数（卡片上要显示「评论 N」）——子查询，别为这个再开一趟请求
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, title, price, size, note, contact, reports,
            (SELECT COUNT(*) FROM comments c WHERE c.listing_id = listings.id AND c.hidden = 0) AS comments
       FROM listings WHERE hidden = 0 ORDER BY created_at DESC LIMIT ?`
  )
    .bind(LIMIT)
    .all();
  return json({ ok: true, items: (results || []).map((r) => ({ ...r, hasImage: true })) });
}

/**
 * POST /api/listings —— 发一件。
 *
 * 没有账号体系：谁都能发，站长随时删（用户选的那条路）。防刷靠三样——
 * 蜜罐字段（机器人会填）、每 IP 每天 5 件、每天全站 200 件上限。
 * 发完回一条**删除凭据**：只回这一次（服务端只存哈希），浏览器也会存进 localStorage。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }

  // 蜜罐：正常浏览器不会填这个字段
  if (String(body.website || '').trim()) return json({ ok: true, id: null, skipped: true });

  const checked = validate(body);
  if (!checked.ok) return fail(checked.error);
  const v = checked.value;

  const hash = await ipHash(request);
  const limited = await checkRate(env, hash);
  if (limited) return fail(limited, 429);

  const id = randomId(8);
  const token = randomToken(16);
  const now = new Date().toISOString();
  const bytes = Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0));

  // 列数必须和占位符个数一致：删 store 那轮改了列名、却漏改 `?` 的个数
  // （12 个占位符对 11 列），于是发帖在线上一直是 500。单测用的是假 D1、SQL 根本不执行，
  // 所以 43 条全绿也没抓到——是靠本地真 D1 的冒烟才现形的。
  await env.DB.prepare(
    `INSERT INTO listings (id, created_at, title, price, size, contact, note,
                           image_mime, image_bytes, ip_hash, token_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(id, now, v.title, v.price, v.size, v.contact, v.note, v.mime, bytes, hash, await SHA(token))
    .run();

  return json({ ok: true, id, token, createdAt: now });
}
