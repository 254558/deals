import { json, fail, validate, SHA } from './_lib.mjs';

/**
 * POST /api/edit —— 发帖人自己改（凭发帖时回的那条 token，和「下架」是同一条凭据）。
 *
 * 几个刻意的取舍：
 *
 * - **图片可以不换**：不带 image 就沿用库里那张（不重新上传，省流量也省一次压缩）。
 *   带了就必须合法，校验走同一个 validate，只是把 imageOptional 打开。
 * - **改完不往前排**：created_at 不动，所以列表顺序不变——否则谁都能靠反复编辑
 *   把自家那件刷到最上面。
 * - **举报数不清零、下架状态不变**：不然被举报到自动下架之后，编辑一下就能复活。
 * - **不额外限速**：凭据本身就是门槛（每条帖子一条、只有发帖那个浏览器有），
 *   而发帖是限速的；能改的条数受限于自己发过的条数。
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
  if (row.token_hash !== (await SHA(token))) return fail('凭据不对（只有发帖那个浏览器能改）', 403);

  const checked = validate(body, { imageOptional: true });
  if (!checked.ok) return fail(checked.error);
  const v = checked.value;

  if (v.b64) {
    const bytes = Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0));
    await env.DB.prepare(
      `UPDATE listings SET title=?, price=?, size=?, store=?, contact=?, note=?,
                           image_mime=?, image_bytes=? WHERE id=?`
    )
      .bind(v.title, v.price, v.size, v.store, v.contact, v.note, v.mime, bytes, id)
      .run();
  } else {
    await env.DB.prepare(
      'UPDATE listings SET title=?, price=?, size=?, store=?, contact=?, note=? WHERE id=?'
    )
      .bind(v.title, v.price, v.size, v.store, v.contact, v.note, id)
      .run();
  }

  return json({ ok: true, id, imageChanged: !!v.b64 });
}
