import { json, fail, SHA } from '../_lib.mjs';

/**
 * 管理口令校验。
 *
 * 口令放在 Pages 项目的环境变量 `ADMIN_TOKEN` 里（不是代码里，也不进仓库）。
 * 比较的是两者的 SHA-256——避免逐字符比较泄漏前缀信息，也让日志里不会出现口令原文。
 */
export async function requireAdmin(request, env) {
  const given = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_TOKEN) return fail('服务端没配 ADMIN_TOKEN（见 docs/MARKET.md）', 503);
  if (!given) return fail('要口令', 401);
  if ((await SHA(given)) !== (await SHA(env.ADMIN_TOKEN))) return fail('口令不对', 403);
  return null; // 通过
}

/**
 * GET /api/admin/list —— 全部测评（含已下架），管理页用。
 *
 * 2026-10-06：原来列的是「二手 + 评论」，「有品」换成测评之后只剩一张表，
 * 于是评论那一整块（连 JOIN）都删掉了。
 */
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, product_code, code, name, body, reports, hidden,
            CASE WHEN image_mime IS NULL THEN 0 ELSE 1 END AS hasImage
       FROM reviews ORDER BY hidden ASC, created_at DESC LIMIT 500`
  ).all();
  const items = results || [];

  return json({
    ok: true,
    items,
    counts: {
      live: items.filter((x) => !x.hidden).length,
      hidden: items.filter((x) => x.hidden).length,
      reported: items.filter((x) => x.reports > 0).length,
      withImage: items.filter((x) => x.hasImage).length,
    },
  });
}
