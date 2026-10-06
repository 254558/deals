import { json, fail, validateReview, ipHash, checkReviewRate, randomId, randomToken, SHA } from './_lib.mjs';

/** 一次最多给多少条（测评不是瀑布流，这个量级够翻很久了） */
const LIMIT = 100;

/**
 * GET /api/reviews —— 测评列表。
 *
 *   ?productCode=u0000000072656   某一**件商品**的测评（报告卡片点进来的就是这条）
 *   ?code=488131                  按吊牌编号查（人手里只有编号时）
 *   ?counts=1                     只要「每件各有几条」（报告卡片上的小角标用）
 *   ?offset=n                     翻页
 *   都不带                         = 最新的一批（测评页首屏）
 *
 * 图片不进这个回应（一列 BLOB，几百 KB），走 /api/img/<id>，和原来一样。
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // 只要计数：报告卡片上那个「N 条测评」。一件一行，量很小。
  if (url.searchParams.get('counts')) {
    const { results } = await env.DB.prepare(
      'SELECT product_code, COUNT(*) AS n FROM reviews WHERE hidden = 0 GROUP BY product_code'
    ).all();
    const counts = {};
    for (const r of results || []) counts[r.product_code] = r.n;
    return json({ ok: true, counts });
  }

  const productCode = String(url.searchParams.get('productCode') || '').trim();
  const code = String(url.searchParams.get('code') || '').trim();
  const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset')) || 0));

  // 三种筛选：商品号 / 吊牌号 / 不过滤。用条件拼 WHERE，参数个数跟着走。
  const where = ['hidden = 0'];
  const args = [];
  if (productCode) { where.push('product_code = ?'); args.push(productCode); }
  else if (code) { where.push('code = ?'); args.push(code); }

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, product_code, code, name, body,
            CASE WHEN image_mime IS NULL THEN 0 ELSE 1 END AS hasImage
       FROM reviews WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...args, LIMIT, offset)
    .all();

  return json({ ok: true, items: results || [] });
}

/**
 * POST /api/reviews —— 写一条测评。
 *
 * 和「发一件二手」同一套：没有账号，谁都能写，站长随时删，
 * 防刷靠蜜罐 + 限速，写完回一条**只回这一次**的删除凭据（服务端只存哈希）。
 * 区别只有一个，但很关键：**必须带上商品号** —— 测评是绑在商品上的，
 * 绑不上就没意义（这条在 validateReview 里卡）。
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('请求体不是 JSON');
  }

  // 蜜罐：正常浏览器不会填这个字段
  if (String(body.website || '').trim()) return json({ ok: true, id: null, skipped: true });

  const checked = validateReview(body);
  if (!checked.ok) return fail(checked.error);
  const v = checked.value;

  const hash = await ipHash(request);
  const limited = await checkReviewRate(env, hash);
  if (limited) return fail(limited, 429);

  const id = randomId(8);
  const token = randomToken(16);
  const now = new Date().toISOString();
  // 没图就存 NULL —— 不能传空 Uint8Array，D1 会把它当成一张 0 字节的图
  const bytes = v.b64 ? Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)) : null;

  // 列数与占位符数必须一一对应（这个坑踩过一次：12 个 ? 对 11 列 → 线上 500，
  // 而单测用的是假 D1、SQL 根本不执行，所以测试全绿也没抓到）。
  await env.DB.prepare(
    `INSERT INTO reviews (id, created_at, product_code, code, name, body,
                          image_mime, image_bytes, ip_hash, token_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(id, now, v.productCode, v.code, v.name, v.body, v.mime, bytes, hash, await SHA(token))
    .run();

  return json({ ok: true, id, token, createdAt: now });
}
