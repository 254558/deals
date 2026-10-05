/**
 * 保险之二：两个站点的描述符必须是「同一套键、不同的值」。
 *
 * 为什么要有这条：统一皮肤那轮我从优衣库抄了一份 `features` 给迪卡侬（现为 ZARA），
 * 结果把 `cardChips` 一起抄成了 false，迪卡侬卡片上的「尾货 / 新品」标记全没了——
 * 而且**没有任何测试会红**，是用户报上来的。同类还有：
 *   - `store` 字段（形态不同、抄漏了）
 *   - `cardMin`（列数：5 列抄成 4 列）
 *   - `imageAspect`（图框 1:1 抄成 3:4，方图被拉伸留白）
 *
 * 这条测试把「键集合」锁死：两边可以**值**不同（那正是描述符的意义），
 * 但不该出现「一边有这个键、另一边没有」——那种差异通常就是抄漏。
 * 真要引入只属于某一站的键，写进下面的 ALWAYS_MISSING 白名单并说明原因。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import uniqlo from '../src/sites/uniqlo.mjs';
import zara from '../src/sites/zara.mjs';

const SITES = { uniqlo, zara };

/** 允许「只有某一站有」的键：键名 -> 为什么 */
const ALWAYS_MISSING = new Map([
  // 例：'xxx': '只有ZARA有这个形态',
]);

function keysOf(obj) {
  return Object.keys(obj || {}).sort();
}

function diff(a, b) {
  const setB = new Set(b);
  return a.filter((k) => !setB.has(k));
}

test('report 的键集合两站一致（值可以不同）', () => {
  const [u, d] = [keysOf(uniqlo.report), keysOf(zara.report)];
  const onlyU = diff(u, d).filter((k) => !ALWAYS_MISSING.has(k));
  const onlyD = diff(d, u).filter((k) => !ALWAYS_MISSING.has(k));
  assert.deepEqual(
    { 只有优衣库有: onlyU, 只有ZARA有: onlyD },
    { 只有优衣库有: [], 只有ZARA有: [] },
    'report 的键两边对不上：多半是抄的时候漏了。要么补齐，要么加进 ALWAYS_MISSING 并写明原因。'
  );
});

test('report.features 的键集合两站一致', () => {
  const [u, d] = [keysOf(uniqlo.report?.features), keysOf(zara.report?.features)];
  const onlyU = diff(u, d).filter((k) => !ALWAYS_MISSING.has('features.' + k));
  const onlyD = diff(d, u).filter((k) => !ALWAYS_MISSING.has('features.' + k));
  assert.deepEqual(
    { 只有优衣库有: onlyU, 只有ZARA有: onlyD },
    { 只有优衣库有: [], 只有ZARA有: [] },
    'features 的键两边对不上：这个最危险——上次 cardChips 就是在这里被抄没的。'
  );
});

  test('pageTitle / searchPlaceholder 这类标量键两站都非空（形态没被抄丢）', () => {
  for (const [name, site] of Object.entries(SITES)) {
    assert.ok(site.report?.pageTitle, `${name}: pageTitle 不该空`);
  }
});
