import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateReview, MAX_REVIEW_LEN, REVIEWS_PER_IP_PER_DAY } from '../functions/api/_lib.mjs';
import { onRequestGet as listReviews, onRequestPost as createReview } from '../functions/api/reviews.js';
import { onRequestPost as deleteReview } from '../functions/api/review-delete.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * 一个够用的假 D1：只认 reviews 和 posts 那几个查询，按 SQL 关键词回话。
 * 真实 D1 的行为（BLOB 回成数组、索引、LIMIT 语义）不在这里模拟 —— 那些靠
 * `npm run smoke:market` 打真实服务验（这个项目已经栽过一次：假 D1 全绿、
 * 线上 500，就是列数和占位符对不上）。
 */
function fakeDB() {
  const state = { reviews: [], posts: [] };
  const db = {
    prepare(sql) {
      const q = { sql, args: [] };
      const api = {
        bind(...args) { q.args = args; return api; },
        async first() {
          if (/FROM posts WHERE ip_hash = \? AND note = 'review'/.test(sql)) {
            return { n: state.posts.filter((p) => p.ip_hash === q.args[0] && p.note === 'review' && p.at > q.args[1]).length };
          }
          if (/FROM posts WHERE note = 'review' AND at LIKE/.test(sql)) {
            return { n: state.posts.filter((p) => p.note === 'review').length };
          }
          if (/SELECT token_hash FROM reviews/.test(sql)) {
            const r = state.reviews.find((x) => x.id === q.args[0]);
            return r ? { token_hash: r.token_hash } : null;
          }
          return null;
        },
        async all() {
          if (/GROUP BY product_code/.test(sql)) {
            const m = {};
            for (const r of state.reviews) if (!r.hidden) m[r.product_code] = (m[r.product_code] || 0) + 1;
            return { results: Object.entries(m).map(([product_code, n]) => ({ product_code, n })) };
          }
          if (/FROM reviews WHERE/.test(sql)) {
            let rows = state.reviews.filter((r) => !r.hidden);
            if (/product_code = \?/.test(sql)) rows = rows.filter((r) => r.product_code === q.args[0]);
            else if (/code = \?/.test(sql)) rows = rows.filter((r) => r.code === q.args[0]);
            return { results: rows.map((r) => ({ id: r.id, created_at: r.created_at, product_code: r.product_code, code: r.code, name: r.name, body: r.body, hasImage: r.image_mime ? 1 : 0 })) };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO posts/.test(sql)) state.posts.push({ ip_hash: q.args[0], at: q.args[1], note: 'review' });
          if (/INSERT INTO reviews/.test(sql)) {
            const [id, created_at, product_code, code, name, body, image_mime, image_bytes, ip_hash, token_hash] = q.args;
            state.reviews.push({ id, created_at, product_code, code, name, body, image_mime, image_bytes, ip_hash, token_hash, hidden: 0 });
          }
          if (/UPDATE reviews SET hidden = 1/.test(sql)) { const r = state.reviews.find((x) => x.id === q.args[0]); if (r) r.hidden = 1; }
          if (/DELETE FROM posts/.test(sql)) { /* 清理，测试里不用管 */ }
          return { success: true };
        },
      };
      return api;
    },
  };
  return { db, state };
}

const post = (url, body) => new Request(url, { method: 'POST', body: JSON.stringify(body) });

test('validateReview：绑不上商品就不收（这是它和「市集」的根本区别）', () => {
  const r = validateReview({ body: '很好穿，值' });
  assert.equal(r.ok, false);
  assert.match(r.error, /哪件/);
});

test('validateReview：心得太短不收，太长不收', () => {
  assert.equal(validateReview({ productCode: 'u1', body: '好' }).ok, false);
  assert.equal(validateReview({ productCode: 'u1', body: 'x'.repeat(MAX_REVIEW_LEN + 1) }).ok, false);
  assert.equal(validateReview({ productCode: 'u1', body: '挺好穿的' }).ok, true);
});

test('validateReview：图是**可选**的（用户明确「就可以发图片，发心得」——不是必须发图）', () => {
  const noImg = validateReview({ productCode: 'u1', body: '挺好穿的' });
  assert.equal(noImg.ok, true);
  assert.equal(noImg.value.mime, null);
  assert.equal(noImg.value.b64, null);

  const withImg = validateReview({ productCode: 'u1', body: '挺好穿的', image: PNG });
  assert.equal(withImg.ok, true);
  assert.equal(withImg.value.mime, 'image/png');
});

test('发一条测评：回一个 id + 一条只回一次的删除凭据，行也真的写进去了', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const res = await createReview({ request: post('https://x/api/reviews', { productCode: 'u0000000072656', code: '488089', name: '抽褶裙', body: '面料很软，59 值' }), env });
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.ok(j.id);
  assert.ok(j.token);
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].product_code, 'u0000000072656');
  assert.equal(state.reviews[0].body, '面料很软，59 值');
  assert.equal(state.reviews[0].image_bytes, null, '没给图时必须存 NULL，不能存空数组');
  assert.notEqual(state.reviews[0].token_hash, j.token, '服务端只能存哈希，不能存原文');
});

test('发一条带图的测评：图片字节进得去，列表里 hasImage = 1', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  await createReview({ request: post('https://x/api/reviews', { productCode: 'u2', body: '补个实拍', image: PNG }), env });
  const list = await (await listReviews({ request: new Request('https://x/api/reviews?productCode=u2'), env })).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].hasImage, 1);
});

test('蜜罐字段被填了 = 机器人，静默丢弃（不回 id，也不落库）', async () => {
  const { db, state } = fakeDB();
  const res = await createReview({ request: post('https://x/api/reviews', { productCode: 'u1', body: '挺好的', website: 'http://spam' }), env: { DB: db } });
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.id, null);
  assert.equal(state.reviews.length, 0);
});

test('列表：按商品查只出这一件的；不带参数出最新的', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  for (const [pc, body] of [['u1', '第一件的测评'], ['u2', '第二件的测评'], ['u1', '第一件的第二条']]) {
    await createReview({ request: post('https://x/api/reviews', { productCode: pc, body }), env });
  }
  const one = await (await listReviews({ request: new Request('https://x/api/reviews?productCode=u1'), env })).json();
  assert.equal(one.items.length, 2);
  assert.ok(one.items.every((r) => r.product_code === 'u1'));

  const all = await (await listReviews({ request: new Request('https://x/api/reviews'), env })).json();
  assert.equal(all.items.length, 3);
});

test('counts：报告卡片上那个「N 条测评」的角标数据', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  for (const pc of ['u1', 'u1', 'u2']) {
    await createReview({ request: post('https://x/api/reviews', { productCode: pc, body: '还行吧这个' }), env });
  }
  const j = await (await listReviews({ request: new Request('https://x/api/reviews?counts=1'), env })).json();
  assert.deepEqual(j.counts, { u1: 2, u2: 1 });
});

test('删自己的测评：凭据对就删，不对就 403；删掉之后列表里不再出现', async () => {
  const { db } = fakeDB();
  const env = { DB: db };
  const made = await (await createReview({ request: post('https://x/api/reviews', { productCode: 'u1', body: '写错了想删掉' }), env })).json();

  const bad = await deleteReview({ request: post('https://x/api/review-delete', { id: made.id, token: 'wrong' }), env });
  assert.equal(bad.status, 403);

  const good = await deleteReview({ request: post('https://x/api/review-delete', { id: made.id, token: made.token }), env });
  assert.equal(good.status, 200);

  const list = await (await listReviews({ request: new Request('https://x/api/reviews?productCode=u1'), env })).json();
  assert.equal(list.items.length, 0, 'hidden = 1 的不该再出现在列表里');
});

test('限速：同一个 IP 一天写满之后就不给写了', async () => {
  const { db, state } = fakeDB();
  const env = { DB: db };
  const mk = () => createReview({ request: post('https://x/api/reviews', { productCode: 'u1', body: '凑数用的一条测评' }), env });
  for (let i = 0; i < REVIEWS_PER_IP_PER_DAY; i++) {
    const r = await mk();
    assert.equal(r.status, 200, '第 ' + (i + 1) + ' 条应该是放行的');
  }
  const overflow = await mk();
  assert.equal(overflow.status, 429, '超出之后必须挡住');
  assert.equal(state.reviews.length, REVIEWS_PER_IP_PER_DAY);
});
