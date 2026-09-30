import { json, fail, validateComment, checkCommentRate, ipHash, randomId, randomToken, SHA } from './_lib.mjs';

/** 一件最多取多少条评论；一次批量取的总上限 */
const LIMIT = 100;
const ALL_LIMIT = 800;

/**
 * GET /api/comments?listingId=xxx —— 某一件的评论，**正序**（先说的在前，像聊天记录）。
 * GET /api/comments            —— **全部**可见评论（带 listing_id），市集页默认展开时用。
 *
 * 为什么要有第二种：市集页现在是**默认展开**评论的，如果照旧每张卡片各发一个请求，
 * 一屏几十张卡就是几十个请求。改成一趟把全部评论取回来，前端按 listing_id 分组填进去。
 * 个人市集这个量级（几百条）一趟完全够。
 *
 * 只回可见的；顺手标一下哪几条是**卖家自己**来答的——比 ip_hash（只回布尔值，不暴露哈希）。
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const listingId = String(url.searchParams.get('listingId') || '').replace(/[^a-z0-9]/gi, '');

  if (!listingId) {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.listing_id, c.created_at, c.body,
              (c.ip_hash = l.ip_hash) AS by_seller
         FROM comments c LEFT JOIN listings l ON l.id = c.listing_id
        WHERE c.hidden = 0 ORDER BY c.created_at ASC LIMIT ?`
    )
      .bind(ALL_LIMIT)
      .all();
    return json({
      ok: true,
      items: (results || []).map((r) => ({
        id: r.id,
        listingId: r.listing_id,
        created_at: r.created_at,
        body: r.body,
        bySeller: !!r.by_seller,
      })),
    });
  }

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.created_at, c.body, (c.ip_hash = l.ip_hash) AS by_seller
       FROM comments c LEFT JOIN listings l ON l.id = c.listing_id
      WHERE c.listing_id = ? AND c.hidden = 0 ORDER BY c.created_at ASC LIMIT ?`
  )
    .bind(listingId, LIMIT)
    .all();

  return json({
    ok: true,
    items: (results || []).map((r) => ({
      id: r.id,
      listingId,
      created_at: r.created_at,
      body: r.body,
      bySeller: !!r.by_seller,
    })),
  });
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
