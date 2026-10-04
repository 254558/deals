import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validate, clean, len, SHA, checkRate, PER_DAY_GLOBAL } from '../functions/api/_lib.mjs';
import { onRequestPost as createListing, onRequestGet as listListings } from '../functions/api/listings.js';
import { onRequestPost as deleteListing } from '../functions/api/delete.js';
import { onRequestPost as reportListing } from '../functions/api/report.js';
import { onRequestGet as adminList } from '../functions/api/admin/list.js';
import { onRequestPost as adminAct } from '../functions/api/admin/act.js';
import { onRequestPost as editListing } from '../functions/api/edit.js';
import { onRequestGet as listComments, onRequestPost as createComment } from '../functions/api/comments.js';
import { onRequestPost as deleteComment } from '../functions/api/comment-delete.js';
import { onRequestGet as list } from '../functions/api/listings.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 一个够用的假 D1：按 SQL 里的关键词回话，并记下都执行过什么。
 * 真实 D1 的行为（BLOB 回成数组、LIMIT 的语义…）不在这里完全模拟——那些靠
 * `npm run smoke:market` 打真实服务来验。
 */
function fakeDB(seed = {}) {
  const calls = [];
  const state = { posts: [], listings: [], comments: [], ...seed };
  const db = {
    calls,
    prepare(sql) {
      const q = { sql, args: [] };
      const api = {
        bind(...args) { q.args = args; return api; },
        async first() {
          calls.push(q);
          if (/FROM posts WHERE ip_hash/.test(sql)) return { n: state.posts.filter((p) => p.ip_hash === q.args[0]).length };
          if (/FROM posts WHERE at LIKE/.test(sql)) return { n: state.posts.length };
          if (/SELECT ip_hash FROM listings/.test(sql)) {
            const row = state.listings.find((l) => l.id === q.args[0]);
            return row ? { ip_hash: row.ip_hash } : null;
          }
          if (/SELECT id FROM listings WHERE id = \? AND hidden = 0/.test(sql)) {
            const row = state.listings.find((l) => l.id === q.args[0] && !l.hidden);
            return row ? { id: row.id } : null;
          }
          if (/SELECT token_hash FROM comments/.test(sql)) {
            const row = state.comments.find((c) => c.id === q.args[0]);
            return row ? { token_hash: row.token_hash } : null;
          }
          if (/FROM comments WHERE ip_hash = \? AND created_at > \?/.test(sql)) {
            return { n: state.comments.filter((c) => c.ip_hash === q.args[0] && c.created_at > q.args[1]).length };
          }
          if (/FROM comments WHERE created_at LIKE/.test(sql)) return { n: state.comments.length };
          if (/SELECT token_hash FROM listings/.test(sql)) {
            const row = state.listings.find((l) => l.id === q.args[0]);
            return row ? { token_hash: row.token_hash } : null;
          }
          // 带 RETURNING 的写操作：D1 那边也是走 first()/all() 拿回行
          if (/UPDATE listings SET hidden = \? WHERE id = \? RETURNING id/.test(sql)) {
            const r = state.listings.find((l) => l.id === q.args[1]);
            if (!r) return null;
            r.hidden = q.args[0];
            return { id: r.id };
          }
          if (/DELETE FROM listings WHERE id = \? RETURNING id/.test(sql)) {
            const i = state.listings.findIndex((l) => l.id === q.args[0]);
            if (i < 0) return null;
            const [r] = state.listings.splice(i, 1);
            return { id: r.id };
          }
          if (/SELECT reports FROM listings/.test(sql)) {
            const row = state.listings.find((l) => l.id === q.args[0]);
            return row ? { reports: row.reports } : null;
          }
          return null;
        },
        async run() {
          calls.push(q);
          if (/INSERT INTO posts/.test(sql)) state.posts.push({ ip_hash: q.args[0], at: q.args[1] });
          // INSERT 的列顺序：id, created_at, title, price, size, contact, note,
          //                   image_mime, image_bytes, ip_hash, token_hash
          if (/INSERT INTO comments/.test(sql)) {
            const [id, listing_id, created_at, body, ip_hash, token_hash] = q.args;
            state.comments.push({ id, listing_id, created_at, body, ip_hash, token_hash, hidden: 0 });
          }
          if (/UPDATE comments SET hidden = 1/.test(sql)) { const c = state.comments.find((x) => x.id === q.args[0]); if (c) c.hidden = 1; }
          if (/INSERT INTO listings/.test(sql)) {
            const [id, created_at, title, price, size, contact, note, , image_bytes, ip_hash, token_hash] = q.args;
            state.listings.push({ id, created_at, title, price, size, contact, note, image_bytes, ip_hash, token_hash, reports: 0, hidden: 0 });
          }
          if (/UPDATE listings SET hidden = 1/.test(sql)) { const r = state.listings.find((l) => l.id === q.args[0]); if (r) r.hidden = 1; }
          if (/UPDATE listings SET reports = 0/.test(sql)) { const r = state.listings.find((l) => l.id === q.args[0]); if (r) r.reports = 0; }
          // 编辑：带图（9 个参数，最后是 id）与不带图（7 个参数）两条
          if (/UPDATE listings SET title=\?, price=\?, size=\?, contact=\?, note=\?,\s*image_mime=\?, image_bytes=\? WHERE id=\?/.test(sql)) {
            const [title, price, size, contact, note, , image_bytes, id] = q.args;
            const r = state.listings.find((l) => l.id === id);
            if (r) Object.assign(r, { title, price, size, contact, note, image_bytes });
          }
          if (/UPDATE listings SET title=\?, price=\?, size=\?, contact=\?, note=\? WHERE id=\?/.test(sql)) {
            const [title, price, size, contact, note, id] = q.args;
            const r = state.listings.find((l) => l.id === id);
            if (r) Object.assign(r, { title, price, size, contact, note });
          }
          if (/UPDATE listings SET reports/.test(sql)) { const r = state.listings.find((l) => l.id === q.args[3]); if (r) { r.reports = q.args[0]; if (q.args[1] >= q.args[2]) r.hidden = 1; } }
          return { success: true };
        },
        async all() {
          calls.push(q);
          if (/SELECT c\.id/.test(sql)) {
            // 带 listing_id 的那条（按件查）参数是 [listingId, limit]；批量那条没有参数
            const only = /c\.listing_id = \?/.test(sql) ? q.args[0] : null;
            const bySeller = (c) => {
              const l = state.listings.find((x) => x.id === c.listing_id);
              return !!(l && l.ip_hash && c.ip_hash && l.ip_hash === c.ip_hash);
            };
            const rows = state.comments
              .filter((c) => !c.hidden && (only === null || c.listing_id === only))
              .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
              .map((c) => ({ id: c.id, listing_id: c.listing_id, created_at: c.created_at, body: c.body, by_seller: bySeller(c) ? 1 : 0 }));
            return { results: rows };
          }
          // 列表带评论数（对应线上那条子查询）
          return {
            results: state.listings
              .filter((l) => !l.hidden)
              .map((l) => ({
                ...l,
                image_bytes: undefined,
                comments: state.comments.filter((c) => c.listing_id === l.id && !c.hidden).length,
              })),
          };
        },
      };
      return api;
    },
  };
  return { db, state, calls };
}

const req = (body) => new Request('https://x/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify(body) });
const good = { title: '羊毛混纺大衣', price: 299, size: 'M', contact: 'wx: a', note: '包邮', image: PNG };

test('validate：不合格的输入每条都有话说明白', () => {
  assert.equal(validate({ ...good, title: '一' }).error.includes('太短'), true);
  assert.equal(validate({ ...good, price: 0 }).error.includes('价格'), true);
  assert.equal(validate({ ...good, price: 'abc' }).error.includes('价格'), true);
  assert.equal(validate({ ...good, contact: '' }).error.includes('联系方式'), true);
  assert.equal(validate({ ...good, image: 'data:image/gif;base64,R0lGOD' }).error.includes('格式'), true);
  assert.equal(validate({ ...good, image: '' }).error.includes('格式'), true);
  const big = validate({ ...good, image: 'data:image/jpeg;base64,' + 'A'.repeat(700 * 1024) });
  assert.equal(big.error.includes('太大'), true);
  const okv = validate(good);
  assert.equal(okv.ok, true);
  assert.equal(okv.value.mime, 'image/png');
});

test('clean / len：空白压平、控制字符去掉、中文按一个字算', () => {
  assert.equal(clean('  羊毛   混纺\u0007 大衣 ', 60), '羊毛 混纺 大衣');
  assert.equal(len('大衣'), 2);
  assert.equal(len('M号'), 2);
  assert.equal(clean('一二三四五', 3), '一二三');
});

test('发布：蜜罐被填就静默丢弃，正常发贴回一条删除凭据', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };

  const honey = await createListing({ request: req({ ...good, website: 'http://spam' }), env });
  assert.deepEqual(await honey.json(), { ok: true, id: null, skipped: true });
  assert.equal(state.listings.length, 0, '机器人那一发不该落库');

  const res = await createListing({ request: req(good), env });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.id && body.token, '要回 id 和删除凭据');
  assert.equal(state.listings.length, 1);
  assert.equal(state.listings[0].token_hash, await SHA(body.token), '库里只存凭据的哈希');
  assert.equal(state.listings[0].image_bytes instanceof Uint8Array, true, '图片以字节落库');
});

test('发布：不再限制单 IP 每天的件数（连发 12 件都成功）', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  // 2026-10-01 用户要求去掉「每 24 小时最多 5 件」：同一个 IP 连发多件都该放过
  for (let i = 0; i < 12; i++) {
    const r = await createListing({ request: req({ ...good, title: `第 ${i + 1} 件` }), env });
    assert.equal(r.status, 200, `第 ${i + 1} 件应该放过`);
  }
  assert.equal(state.listings.length, 12);
});

test('发布：全站每天的上限还在（最后一道阀门）', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  // 假装今天已经发满了全站额度
  const now = new Date().toISOString();
  for (let i = 0; i < PER_DAY_GLOBAL; i++) state.posts.push({ ip_hash: 'other', at: now });

  const r = await createListing({ request: req({ ...good }), env });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /到上限/);
  assert.equal(state.listings.length, 0, '被挡住时一件都不该落库');
});

test('删除：凭据不对 403，对了就下架（且幂等）', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const { id, token } = await (await createListing({ request: req(good), env })).json();

  const wrong = await deleteListing({ request: req({ id, token: 'x' }), env });
  assert.equal(wrong.status, 403);
  assert.equal(state.listings[0].hidden, 0);

  const ok1 = await deleteListing({ request: req({ id, token }), env });
  assert.equal(ok1.status, 200);
  assert.equal(state.listings[0].hidden, 1);
  const ok2 = await deleteListing({ request: req({ id, token }), env });
  assert.equal(ok2.status, 200, '重复删是幂等的');

  const missing = await deleteListing({ request: req({ id: 'nope', token }), env });
  assert.equal(missing.status, 404);
});

test('举报：累加到 5 次自动下架（等人回看）', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const { id } = await (await createListing({ request: req(good), env })).json();

  for (let i = 1; i <= 4; i++) {
    const r = await reportListing({ request: req({ id }), env });
    assert.equal((await r.json()).hidden, false, `第 ${i} 次还不下架`);
  }
  const fifth = await reportListing({ request: req({ id }), env });
  assert.equal((await fifth.json()).hidden, true);
  assert.equal(state.listings[0].hidden, 1);

  const gone = await reportListing({ request: req({ id: 'nope' }), env });
  assert.equal(gone.status, 404);
});

test('列表：只给在售的，且不带图片字节', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  await createListing({ request: req({ ...good, title: '在售的' }), env });
  // 列表接口现在要按 IP 算「我点过没」，所以得给它一个真的 request
  const live = await (await listListings({ env, request: new Request('https://example.test/api/listings') })).json();
  assert.equal(live.ok, true);
  assert.equal(live.items.length, 1);
  assert.equal(live.items[0].image_bytes, undefined, '图片另走 /api/img');
  assert.equal(live.items[0].title, '在售的');
});

test('限速表会顺手清理一周前的记录（表不会一直长）', async () => {
  const { db, calls } = fakeDB();
  await checkRate({ DB: db }, 'hash-1');
  assert.equal(calls.some((c) => /DELETE FROM posts WHERE at </.test(c.sql)), true);
});

test('管理接口：没有口令一律挡住', async () => {
  const { db } = fakeDB();
  const req2 = (token) => new Request('https://x/api/admin/list', { headers: token ? { 'x-admin-token': token } : {} });

  const noEnv = await adminList({ request: req2('whatever'), env: { DB: db } });
  assert.equal(noEnv.status, 503, '服务端没配 ADMIN_TOKEN 要说清楚，不是静默放行');

  const env = { DB: db, ADMIN_TOKEN: 'the-right-token' };
  assert.equal((await adminList({ request: req2(''), env })).status, 401);
  assert.equal((await adminList({ request: req2('nope'), env })).status, 403);
  const good = await adminList({ request: req2('the-right-token'), env });
  assert.equal(good.status, 200);
  assert.deepEqual((await good.json()).counts, { live: 0, hidden: 0, reported: 0, comments: 0 });
});

test('管理动作：下架 / 放回（顺带清举报数）/ 真删', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db, ADMIN_TOKEN: 'k' };
  const { id } = await (await createListing({ request: req({ ...good }), env })).json();
  const act = (action, token = 'k') =>
    adminAct({
      request: new Request('https://x/api/admin/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ id, action }),
      }),
      env,
    });

  assert.equal((await act('hide')).status, 200);
  assert.equal(state.listings[0].hidden, 1);

  // 放回时要把举报数清掉，不然一被举报又会自动下架
  state.listings[0].reports = 3;
  assert.equal((await act('unhide')).status, 200);
  assert.equal(state.listings[0].hidden, 0);
  assert.equal(state.listings[0].reports, 0);

  assert.equal((await act('nuke')).status, 400, '非法动作要被拒');
  assert.equal((await act('remove')).status, 200);
  assert.equal(state.listings.length, 0);
  assert.equal((await act('remove')).status, 404, '删不存在的返回 404');

  const noAuth = await adminAct({
    request: new Request('https://x/api/admin/act', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'hide' }),
    }),
    env,
  });
  assert.equal(noAuth.status, 401, '不带口令的动作一律挡住');
});

test('编辑：凭据对就改内容，不换图时图片原样保留', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const made = await (await createListing({ request: req({ ...good }), env })).json();
  const { id, token } = made;
  const before = state.listings[0].image_bytes;

  const edit = (body) =>
    editListing({
      request: new Request('https://x/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, token, ...body }),
      }),
      env,
    });

  // 不带 image：只改文字，图沿用
  const r1 = await edit({ title: '改过的名字', price: 66, contact: 'wx: new', note: '改过了' });
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).imageChanged, false);
  const row = state.listings[0];
  assert.equal(row.title, '改过的名字');
  assert.equal(row.price, 66);
  assert.equal(row.contact, 'wx: new');
  assert.equal(row.image_bytes, before, '没带图就沿用库里那张');
  assert.equal(row.created_at, state.listings[0].created_at, '不改时间，免得靠反复编辑往上刷');

  // 带 image：换图（120 个 base64 字符 → 90 字节）
  const r2 = await edit({ ...good, image: 'data:image/png;base64,' + 'B'.repeat(120) });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).imageChanged, true);
  assert.equal(state.listings[0].image_bytes.length, 90);
});

test('编辑：凭据不对 / 找不到 / 字段不合法都要挡住', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const { id, token } = await (await createListing({ request: req({ ...good }), env })).json();
  const edit = (body) =>
    editListing({
      request: new Request('https://x/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, token, ...body }),
      }),
      env,
    });

  assert.equal((await edit({ token: 'wrong', title: '正常的名字', price: 10, contact: 'wx: ok' })).status, 403, '凭据不对');
  assert.equal((await edit({ title: '短', price: 10, contact: 'wx: ok' })).status, 400, '商品名只有一个字，太短');
  assert.equal((await edit({ title: '正常的名字', price: 0, contact: 'wx: ok' })).status, 400, '价格不对');
  assert.equal((await edit({ title: '正常的名字', price: 10, contact: 'x' })).status, 400, '联系方式太短');
  assert.equal(
    (await edit({ title: '正常的名字', price: 10, contact: 'wx: ok', image: 'data:image/gif;base64,AAA' })).status,
    400,
    '给了图就必须合法'
  );
  assert.equal(state.listings[0].title, good.title, '被挡住的那几次一个字都没改到');

  const gone = await editListing({
    request: new Request('https://x/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'nope', token, title: '正常的名字', price: 10, contact: 'wx: ok' }),
    }),
    env,
  });
  assert.equal(gone.status, 404, '不存在的 id');
});

test('评论：发一条、按件正序取回、列表带评论数', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const { id: listingId } = await (await createListing({ request: req({ ...good }), env })).json();

  const send = (body, honeypot = false) =>
    createComment({
      request: new Request('https://x/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ listingId, body, ...(honeypot ? { website: 'http://spam' } : {}) }),
      }),
      env,
    });

  const c1 = await send('还在吗？');
  assert.equal(c1.status, 200);
  const first = await c1.json();
  assert.ok(first.id && first.token, '要回 id 和删除凭据');
  await send('在的，明天寄');

  const honey = await send('买茶叶吗', true);
  assert.equal((await honey.json()).skipped, true, '蜜罐静默丢弃');
  assert.equal(state.comments.length, 2);

  const got = await (await listComments({
    request: new Request('https://x/api/comments?listingId=' + listingId),
    env,
  })).json();
  assert.deepEqual(got.items.map((c) => c.body), ['还在吗？', '在的，明天寄'], '正序');
  assert.ok(!('ip_hash' in got.items[0]), '不把 ip_hash 回给前端');
  assert.equal(got.items[0].bySeller, true, '同一 IP 发的标成卖家');

  const listed = await (await list({ env, request: new Request('https://example.test/api/listings') })).json();
  assert.equal(listed.items[0].comments, 2, '列表带评论数');
});

test('评论：删自己那条要凭据；空的、超长的、给不存在的商品都要挡住', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const { id: listingId } = await (await createListing({ request: req({ ...good }), env })).json();
  const post = (body) =>
    createComment({
      request: new Request('https://x/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, body }),
      }),
      env,
    });

  assert.equal((await post('   ')).status, 400, '空的要挡住');
  assert.equal((await post('字'.repeat(201))).status, 400, '超长的要挡住');

  const gone = await createComment({
    request: new Request('https://x/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: 'nope', body: '在吗' }),
    }),
    env,
  });
  assert.equal(gone.status, 404, '商品不在就不给评论');

  const made = await (await post('我删我自己的')).json();
  const del = (token) =>
    deleteComment({
      request: new Request('https://x/api/comment-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: made.id, token }),
      }),
      env,
    });
  assert.equal((await del('wrong')).status, 403);
  assert.equal(state.comments[0].hidden, 0, '凭据不对不能删');
  assert.equal((await del(made.token)).status, 200);
  assert.equal(state.comments[0].hidden, 1);

  const after = await (await listComments({ request: new Request('https://x/api/comments?listingId=' + listingId), env })).json();
  assert.equal(after.items.length, 0, '删掉的不再返回');
});

test('评论限速：同一个 IP 24 小时内到上限就 429', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  const { id: listingId } = await (await createListing({ request: req({ ...good }), env })).json();
  const post = (body) =>
    createComment({
      request: new Request('https://x/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, body }),
      }),
      env,
    });

  let last = 0;
  for (let i = 0; i < 21; i++) last = (await post('第 ' + (i + 1) + ' 条')).status;
  assert.equal(last, 429, '第 21 条该被限速');
});
