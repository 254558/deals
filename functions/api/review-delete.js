import { json, fail, SHA } from './_lib.mjs';

/**
 * POST /api/review-delete —— 写测评的人删自己那条（凭发布时回的 token）。
 *
 * 和二手那套一样：**不真删**，只置 hidden = 1（留个记录，站长回查时看得到）。
 * 没有账号体系，所以「是不是本人」只能靠发布时那条凭据 —— 服务端只存它的哈希，
 * 原文只在发布那一刻回给浏览器一次。
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

  const row = await env.DB.prepare('SELECT token_hash FROM reviews WHERE id = ?').bind(id).first();
  if (!row) return fail('这条测评已经不在了', 404);
  if (row.token_hash !== (await SHA(token))) return fail('凭据不对（只有写这条的那个浏览器能删）', 403);

  await env.DB.prepare('UPDATE reviews SET hidden = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
