import { fail } from './_lib.mjs';

/** 被举报到几次就先自动下架（站长再回看） */
const AUTO_HIDE_AT = 5;

/**
 * POST /api/report —— 举报一件（盗图、假货、已经卖了…）。
 * 不需要登录：同一件被举报多次就累加，到阈值先自动下架，等人回看。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }
  const id = String(body.id || '');
  if (!id) return fail('缺少 id');

  const row = await env.DB.prepare('SELECT reports FROM listings WHERE id = ?').bind(id).first();
  if (!row) return fail('这件已经不在了', 404);

  const next = (row.reports || 0) + 1;
  await env.DB.prepare('UPDATE listings SET reports = ?, hidden = CASE WHEN ? >= ? THEN 1 ELSE hidden END WHERE id = ?')
    .bind(next, next, AUTO_HIDE_AT, id)
    .run();
  return new Response(JSON.stringify({ ok: true, reports: next, hidden: next >= AUTO_HIDE_AT }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
