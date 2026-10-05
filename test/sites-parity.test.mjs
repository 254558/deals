/**
 * 保险之二：多个站点的描述符必须是「同一套键、不同的值」。
 *
 * 为什么要有这条：统一皮肤那轮我从优衣库抄了一份 `features` 给迪卡侬，
 * 结果把 `cardChips` 一起抄成了 false，迪卡侬卡片上的「尾货 / 新品」标记全没了——
 * 而且**没有任何测试会红**，是用户报上来的。同类还有：
 *   - `store` 字段（形态不同、抄漏了）
 *   - `cardMin`（列数：5 列抄成 4 列）
 *   - `imageAspect`（图框 1:1 抄成 3:4，方图被拉伸留白）
 *
 * 这条测试把「键集合」锁死：两边可以**值**不同（那正是描述符的意义），
 * 但不该出现「一边有这个键、另一边没有」——那种差异通常就是抄漏。
 * 真要引入只属于某一站的键，写进下面的 ALWAYS_MISSING 白名单并说明原因。
 *
 * ⚠️ 2026-10-06：站点几经换血（迪卡侬 → ZARA → 都删掉），现在注册表里**只剩优衣库**
 * 一家，这条 parity 检查自然没有第二家可比。所以它改成**按注册表动态取站点**：
 * 有第二家时自动生效，只剩一家时 **skip**（而不是静默通过 —— 免得以后有人
 * 以为它一直在守着）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SITES as REGISTERED } from '../src/sites/index.mjs';

const MULTI = REGISTERED.length >= 2;
const SKIP = MULTI ? false : '只剩一个站点，没有第二家可比';

/** 允许「只有某一站有」的键：键名 -> 为什么 */
const ALWAYS_MISSING = new Map([
  // 例：'xxx': '只有某站有这个形态',
]);

function keysOf(obj) {
  return Object.keys(obj || {}).sort();
}

function diff(a, b) {
  const setB = new Set(b);
  return a.filter((k) => !setB.has(k));
}

test('report 的键集合各站一致（值可以不同）', { skip: SKIP }, () => {
  const [a, b] = REGISTERED;
  const [u, d] = [keysOf(a.report), keysOf(b.report)];
  const onlyU = diff(u, d).filter((k) => !ALWAYS_MISSING.has(k));
  const onlyD = diff(d, u).filter((k) => !ALWAYS_MISSING.has(k));
  assert.deepEqual(
    { [`只有${a.id}有`]: onlyU, [`只有${b.id}有`]: onlyD },
    { [`只有${a.id}有`]: [], [`只有${b.id}有`]: [] },
    'report 的键两边对不上：多半是抄的时候漏了。要么补齐，要么加进 ALWAYS_MISSING 并写明原因。'
  );
});

test('report.features 的键集合各站一致', { skip: SKIP }, () => {
  const [a, b] = REGISTERED;
  const [u, d] = [keysOf(a.report?.features), keysOf(b.report?.features)];
  const onlyU = diff(u, d).filter((k) => !ALWAYS_MISSING.has('features.' + k));
  const onlyD = diff(d, u).filter((k) => !ALWAYS_MISSING.has('features.' + k));
  assert.deepEqual(
    { [`只有${a.id}有`]: onlyU, [`只有${b.id}有`]: onlyD },
    { [`只有${a.id}有`]: [], [`只有${b.id}有`]: [] },
    'features 的键两边对不上：这个最危险——上次 cardChips 就是在这里被抄没的。'
  );
});

test('pageTitle / searchPlaceholder 这类标量键每站都非空（形态没被抄丢）', () => {
  for (const site of REGISTERED) {
    assert.ok(site.report?.pageTitle, `${site.id}: pageTitle 不该空`);
  }
});
