import { json, fail, SHA } from './_lib.mjs';

/**
 * POST /api/comment-delete —— 评论的人删自己那条（凭发评论时回的 token）。
 * 和商品一样不真删，只置 hidden = 1（留个记录，站长回查时看得到）。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }
  const id = String(body.id || '').replace(/[^a-z0-9]/gi, '');
  const token = String(body.token || '');
  if (!id || !token) return fail('缺少 id 或凭据');

  const row = await env.DB.prepare('SELECT token_hash FROM comments WHERE id = ?').bind(id).first();
  if (!row) return fail('这条评论已经不在了', 404);
  if (row.token_hash !== (await SHA(token))) return fail('凭据不对（只有发评论那个浏览器能删）', 403);

  await env.DB.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
