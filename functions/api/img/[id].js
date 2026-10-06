/**
 * GET /api/img/<id> —— 商品图。
 *
 * 图片在 D1 里是 BLOB，这里原样吐出来。带长缓存：文件名（id）是随机的、内容永不改，
 * 所以 `immutable` 完全没问题——省得每次刷新都来回传一遍。
 *
 * ⚠️ D1 把 BLOB 回给函数时是**普通数组**（实测 `[137,80,78,…]`，不是 ArrayBuffer）。
 * 不套一层 `Uint8Array` 的话，`new Response(数组)` 会把它按字符串拼出来，图就废了。
 * `new Uint8Array(...)` 对数组 / ArrayBuffer / TypedArray 三种都对，所以这里用它。
 */
export async function onRequestGet({ params, env }) {
  // 2026-10-06：只剩 reviews 一张表了（`listings` 那套二手已经拆掉），
  // 过渡期的那句「先 reviews 后 listings」也一起收掉。
  const row = await env.DB.prepare('SELECT image_mime, image_bytes FROM reviews WHERE id = ?').bind(params.id).first();
  if (!row) return new Response('not found', { status: 404 });

  return new Response(new Uint8Array(row.image_bytes), {
    headers: {
      'Content-Type': row.image_mime || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
