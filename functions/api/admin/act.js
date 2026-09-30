import { json, fail } from '../_lib.mjs';
import { requireAdmin } from './list.js';

/**
 * POST /api/admin/act —— 管理动作：隐藏 / 放回 / 真删。
 *
 * 跟发帖人自己那条删除凭据是两条路：这条要口令（站长），那条要发帖时回的那个 token。
 * 口令只存在 Pages 的环境变量里，页面上由你自己填一次（存这个浏览器的 localStorage）。
 */
export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }
  const id = String(body.id || '').replace(/[^a-z0-9]/gi, '');
  const action = String(body.action || '');
  if (!id) return fail('缺少 id');

  if (action === 'hide' || action === 'unhide') {
    const r = await env.DB.prepare('UPDATE listings SET hidden = ? WHERE id = ? RETURNING id')
      .bind(action === 'hide' ? 1 : 0, id)
      .first();
    if (!r) return fail('没找到这件', 404);
    // 放回时把举报数清零：不清的话它一被举报就又会自动下架
    if (action === 'unhide') await env.DB.prepare('UPDATE listings SET reports = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true, id, action });
  }

  if (action === 'remove') {
    const r = await env.DB.prepare('DELETE FROM listings WHERE id = ? RETURNING id').bind(id).first();
    if (!r) return fail('没找到这件', 404);
    return json({ ok: true, id, action });
  }

  return fail('action 只能是 hide / unhide / remove');
}
