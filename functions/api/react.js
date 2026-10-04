import { json, fail, ipHash } from './_lib.mjs';

/**
 * POST /api/react —— 点赞，**再点一次就是取消**。
 *
 * 为什么用「切换」而不是点赞/取消两个接口：这种全屏刷的界面里，用户只会点那一下，
 * 前端也不需要先记「我到底点没点」——服务端查一行就知道，回的 `on` 直接决定图标填不填。
 *
 * 没有登录体系（用户选的那条路），所以唯一的防重复手段是 **IP**：
 * 主键 (listing_id, ip_hash, kind) → 同一个 IP 对同一条只能留一行。
 * 代价要如实说：**同一个 WiFi 下的人算一个**（都走同一个出口 IP），
 * 换手机流量又是另一个。真要做准，就得上账号体系，那是另一件事。
 *
 * 点赞用这张表（`kind` 区分），以后加新动作也不用改表结构。
 */
const KINDS = new Set(['like']);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }

  const listingId = String(body.listingId || '').trim();
  const kind = String(body.kind || '').trim();
  if (!listingId || !KINDS.has(kind)) return fail('缺少 listingId，或者 kind 不是 like');

  const exists = await env.DB.prepare('SELECT id FROM listings WHERE id = ?').bind(listingId).first();
  if (!exists) return fail('这条已经不在了', 404);

  const hash = await ipHash(request);

  const mine = await env.DB.prepare(
    'SELECT 1 AS x FROM reactions WHERE listing_id = ? AND ip_hash = ? AND kind = ?'
  )
    .bind(listingId, hash, kind)
    .first();

  if (mine) {
    await env.DB.prepare('DELETE FROM reactions WHERE listing_id = ? AND ip_hash = ? AND kind = ?')
      .bind(listingId, hash, kind)
      .run();
  } else {
    await env.DB.prepare('INSERT INTO reactions (listing_id, ip_hash, kind, created_at) VALUES (?,?,?,?)')
      .bind(listingId, hash, kind, new Date().toISOString())
      .run();
  }

  // 回最新的两个计数，前端不用自己加减（也就不会因为并发点两次而对不上）
  const counts = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS n FROM reactions WHERE listing_id = ? GROUP BY kind"
  )
    .bind(listingId)
    .all();

  const by = {};
  for (const r of counts.results || []) by[r.kind] = r.n;

  return json({ ok: true, on: !mine, likes: by.like || 0 });
}
