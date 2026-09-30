import { json, fail, validateComment, checkCommentRate, ipHash, randomId, randomToken, SHA } from './_lib.mjs';

/** 一件最多取多少条评论 */
const LIMIT = 100;

/**
 * GET /api/comments?listingId=xxx —— 某一件的评论，**正序**（先说的在前，像聊天记录）。
 *
 * 只回可见的；不存在的商品给空数组（不是错误——商品被删了，评论跟着看不见就是了）。
 * 顺手标一下哪几条是**卖家自己**来答的：比对 ip_hash（只回布尔值，不暴露哈希）。
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const listingId = String(url.searchParams.get('listingId') || '').replace(/[^a-z0-9]/gi, '');
  if (!listingId) return fail('缺少 listingId');

  const owner = await env.DB.prepare('SELECT ip_hash FROM listings WHERE id = ?').bind(listingId).first();
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, body, ip_hash FROM comments
      WHERE listing_id = ? AND hidden = 0 ORDER BY created_at ASC LIMIT ?`
  )
    .bind(listingId, LIMIT)
    .all();

  const items = (results || []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    body: r.body,
    bySeller: !!owner && !!r.ip_hash && r.ip_hash === owner.ip_hash,
  }));
  return json({ ok: true, items });
}

/**
 * POST /api/comments —— 发一条评论。{listingId, body, website?}
 *
 * 没有账号：谁都能评，发完回一条**删除凭据**（只回这一次，服务端只存哈希），
 * 和发帖一样靠蜜罐 + 限速兜住。评论的限速**和发帖分开算**（见 _lib 的 checkCommentRate）。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }

  // 蜜罐：正常浏览器不会填
  if (String(body.website || '').trim()) return json({ ok: true, id: null, skipped: true });

  const listingId = String(body.listingId || '').replace(/[^a-z0-9]/gi, '');
  if (!listingId) return fail('缺少 listingId');

  const checked = validateComment(body);
  if (!checked.ok) return fail(checked.error);

  const target = await env.DB.prepare('SELECT id FROM listings WHERE id = ? AND hidden = 0').bind(listingId).first();
  if (!target) return fail('这件已经不在了', 404);

  const hash = await ipHash(request);
  const limited = await checkCommentRate(env, hash);
  if (limited) return fail(limited, 429);

  const id = randomId(8);
  const token = randomToken(16);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO comments (id, listing_id, created_at, body, ip_hash, token_hash) VALUES (?,?,?,?,?,?)'
  )
    .bind(id, listingId, now, checked.value.body, hash, await SHA(token))
    .run();

  return json({ ok: true, id, token, createdAt: now });
}
