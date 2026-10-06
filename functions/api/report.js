import { fail } from './_lib.mjs';

/** 被举报到几次就先自动下架（站长再回看） */
const AUTO_HIDE_AT = 5;

/**
 * POST /api/report —— 举报一条测评（广告、谩骂、跟商品无关…）。
 *
 * 不需要登录：同一条被举报多次就累加，到阈值先自动下架，等人回看。
 * 2026-10-06：原来举报的是「一件二手」，「有品」换成测评之后改指向 reviews 表。
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

  const row = await env.DB.prepare('SELECT reports FROM reviews WHERE id = ?').bind(id).first();
  if (!row) return fail('这条已经不在了', 404);

  const next = (row.reports || 0) + 1;
  await env.DB.prepare('UPDATE reviews SET reports = ?, hidden = CASE WHEN ? >= ? THEN 1 ELSE hidden END WHERE id = ?')
    .bind(next, next, AUTO_HIDE_AT, id)
    .run();
  return new Response(JSON.stringify({ ok: true, reports: next, hidden: next >= AUTO_HIDE_AT }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
