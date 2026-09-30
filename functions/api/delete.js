import { fail, SHA } from './_lib.mjs';

/**
 * POST /api/delete —— 发帖人自己删（凭发帖时那一刻回的 token）。
 * 站长删帖走本地脚本 scripts/market-admin.mjs（不需要往线上放管理密钥）。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }
  const id = String(body.id || '');
  const token = String(body.token || '');
  if (!id || !token) return fail('缺少 id 或凭据');

  const row = await env.DB.prepare('SELECT token_hash FROM listings WHERE id = ?').bind(id).first();
  if (!row) return fail('这件已经不在了', 404);
  if (row.token_hash !== (await SHA(token))) return fail('凭据不对（删除链接只有发帖那个浏览器里有）', 403);

  // 不真删：留个记录，方便回查（图也一起留着，占不了多少）
  await env.DB.prepare('UPDATE listings SET hidden = 1 WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
