import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  discountRate, listDeals, listTracked, stats,
  blockCode, unblockCode, listBlocked, resolveBlockTarget,
} from '../src/core/db.mjs';
import { tmpDb, product, sync } from './helpers.mjs';

test('discountRate：降幅是 0~1 的精确值，原价 0 时不给负数', () => {
  assert.equal(discountRate(100, 50), 0.5);
  assert.equal(discountRate(100, 100), 0);
  assert.equal(discountRate(100, 120), 0); // 涨价了也不给负数
  assert.equal(discountRate(0, 0), 0);
});

test('下架判定：连缺两轮才移出榜单，历史一条不删', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const all = Array.from({ length: 10 }, () => product());
  sync(db, 'uniqlo', all);
  assert.equal(listDeals(db, 'uniqlo', { limit: 99 }).length, 10);

  // 第二轮只见到 6 件（60%，不触发安全阀）→ 缺的 4 件记 missed=1，仍在榜上
  await sleep(5);
  const diff2 = sync(db, 'uniqlo', all.slice(0, 6));
  assert.equal(diff2.missedOne, 4);
  assert.equal(listDeals(db, 'uniqlo', { limit: 99 }).length, 10, '只缺一轮不下榜');

  // 第三轮还是这 6 件 → missed=2，那 4 件移出榜单
  await sleep(5);
  const diff3 = sync(db, 'uniqlo', all.slice(0, 6));
  assert.equal(diff3.gone, 4);
  assert.equal(listDeals(db, 'uniqlo', { limit: 99 }).length, 6);
  assert.equal(stats(db, 'uniqlo').gone, 4);
  // 但库里还有那 10 件（价格历史是不可再生资产）
  assert.equal(stats(db, 'uniqlo').total, 10);
});

test('安全阀：本轮件数暴跌到上一次成功抓取的 60% 以下时，一件都不标记', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const all = Array.from({ length: 10 }, () => product());
  sync(db, 'uniqlo', all);

  await sleep(5);
  const diff = sync(db, 'uniqlo', all.slice(0, 5)); // 50% → 暴跌
  assert.equal(diff.bulkDrop, true);
  assert.equal(diff.missedOne, 0, '暴跌那一轮不记 missed');
  assert.equal(listDeals(db, 'uniqlo', { limit: 99 }).length, 10);
});

test('手动 track 的商品即使已不在特价，也照样进 listTracked', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const watched = product({ tracked: true });
  const others = Array.from({ length: 9 }, () => product());
  sync(db, 'uniqlo', [watched, ...others]);
  db.prepare('UPDATE products SET tracked = 1 WHERE site = ? AND product_code = ?').run('uniqlo', watched.productCode);

  // 它连续两轮没出现 → 榜单不收，但 tracked 那条路把它带回来
  await sleep(5);
  sync(db, 'uniqlo', others);
  await sleep(5);
  sync(db, 'uniqlo', others);

  assert.equal(listDeals(db, 'uniqlo', { limit: 99 }).length, 9, '榜单里没有它');
  const tracked = listTracked(db, 'uniqlo');
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].product_code, watched.productCode);
});

test('谢绝名单：按吊牌号屏蔽、幂等、可解，解析器认得三种输入', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const a = product({ name: '廓形针织T恤', code: '482979' });
  const b = product({ name: '廓形针织T恤', code: '482979' }); // 同款另一个颜色
  const c = product({ name: '抽褶裙', code: '488089' });
  const d = product({ name: '廓形针织背心', code: '490001' }); // 另一个款，名字里也有「廓形」
  sync(db, 'uniqlo', [a, b, c, d]);

  // 三种输入：吊牌号 / product_code / 商品名
  assert.equal(resolveBlockTarget(db, 'uniqlo', '482979').code, '482979');
  assert.equal(resolveBlockTarget(db, 'uniqlo', a.productCode).code, '482979');
  assert.equal(resolveBlockTarget(db, 'uniqlo', '抽褶裙').code, '488089');
  // 名字命中多个款时给候选，不猜
  const amb = resolveBlockTarget(db, 'uniqlo', '廓形');
  assert.equal(amb.ok, false);
  assert.equal(amb.reason, 'ambiguous');
  // 查不到
  assert.equal(resolveBlockTarget(db, 'uniqlo', '不存在的东西').reason, 'notfound');

  blockCode(db, 'uniqlo', '482979', '廓形针织T恤');
  blockCode(db, 'uniqlo', '482979', '廓形针织T恤'); // 幂等
  assert.equal(listBlocked(db, 'uniqlo').length, 1);
  assert.equal(stats(db, 'uniqlo').blocked, 1);

  assert.equal(unblockCode(db, 'uniqlo', '482979'), 1);
  assert.equal(listBlocked(db, 'uniqlo').length, 0);
  assert.equal(unblockCode(db, 'uniqlo', '482979'), 0);
});
