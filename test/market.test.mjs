import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validate, clean, len, SHA, checkRate, PER_IP_PER_DAY } from '../functions/api/_lib.mjs';
import { onRequestPost as createListing, onRequestGet as listListings } from '../functions/api/listings.js';
import { onRequestPost as deleteListing } from '../functions/api/delete.js';
import { onRequestPost as reportListing } from '../functions/api/report.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 一个够用的假 D1：按 SQL 里的关键词回话，并记下都执行过什么。
 * 真实 D1 的行为（BLOB 回成数组、RETURNING、LIMIT…）不在这里模拟——那些靠
 * `npm run smoke:market` 打真实服务来验。
 */
function fakeDB(seed = {}) {
  const calls = [];
  const state = { posts: [], listings: [], ...seed };
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
          if (/SELECT token_hash FROM listings/.test(sql)) {
            const row = state.listings.find((l) => l.id === q.args[0]);
            return row ? { token_hash: row.token_hash } : null;
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
          // INSERT 的列顺序：id, created_at, title, price, size, store, contact, note,
          //                   image_mime, image_bytes, ip_hash, token_hash
          if (/INSERT INTO listings/.test(sql)) {
            const [id, created_at, title, price, size, store, contact, note, , image_bytes, , token_hash] = q.args;
            state.listings.push({ id, created_at, title, price, size, store, contact, note, image_bytes, token_hash, reports: 0, hidden: 0 });
          }
          if (/UPDATE listings SET hidden = 1/.test(sql)) { const r = state.listings.find((l) => l.id === q.args[0]); if (r) r.hidden = 1; }
          if (/UPDATE listings SET reports/.test(sql)) { const r = state.listings.find((l) => l.id === q.args[3]); if (r) { r.reports = q.args[0]; if (q.args[1] >= q.args[2]) r.hidden = 1; } }
          return { success: true };
        },
        async all() { calls.push(q); return { results: state.listings.filter((l) => !l.hidden).map((l) => ({ ...l, image_bytes: undefined })) }; },
      };
      return api;
    },
  };
  return { db, state, calls };
}

const req = (body) => new Request('https://x/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' }, body: JSON.stringify(body) });
const good = { title: '羊毛混纺大衣', price: 299, size: 'M', store: '上海 · 南京西路店', contact: 'wx: a', note: '包邮', image: PNG };

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

test('发布：同一 IP 发满当天额度就 429', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  for (let i = 0; i < PER_IP_PER_DAY; i++) {
    const r = await createListing({ request: req({ ...good, title: `第 ${i} 件` }), env });
    assert.equal(r.status, 200, `第 ${i + 1} 件应该放过`);
  }
  const blocked = await createListing({ request: req({ ...good, title: '超了' }), env });
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /最多 5 件/);
  assert.equal(state.listings.length, PER_IP_PER_DAY);
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
  const live = await (await listListings({ env })).json();
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
