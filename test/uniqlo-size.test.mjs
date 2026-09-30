import { test } from 'node:test';
import assert from 'node:assert/strict';

import uniqlo from '../src/sites/uniqlo.mjs';

/** 词表：码 → {label, grp, ord}。用真实词表里的写法（含它自己不一致的那几档） */
const V = new Map(Object.entries({
  SMA002: { label: 'XS', grp: 2, ord: 0 },
  SMA003: { label: 'S', grp: 2, ord: 1 },
  SMA004: { label: 'M', grp: 2, ord: 2 },
  SMA006: { label: 'XL', grp: 2, ord: 4 },
  SMA007: { label: 'XXL', grp: 2, ord: 5 },
  SMA009: { label: '4XL', grp: 2, ord: 7 },
  // CMD：词表里 7 档写了 cm、12 档没写；且写法和英寸对不上（3cm 一档的梯子）
  CMD070: { label: 'W28/28英寸/28码', grp: 6, ord: 5 },
  CMD073: { label: '73cm/W29/29英寸/29码', grp: 6, ord: 6 },
  CMD082: { label: '82cm/W32/32英寸/32码', grp: 6, ord: 8 },
  CMD100: { label: 'W40/40英寸/40码', grp: 6, ord: 14 },
  // INS：码里数字就是英寸
  INS021: { label: 'W21/21英寸/21码', grp: 8, ord: 0 },
  INS023: { label: 'W23/23英寸/23码', grp: 8, ord: 2 },
  // 其它家族
  CMA080: { label: '80cm', grp: 3, ord: 0 },
  CMA090: { label: '90cm', grp: 3, ord: 1 },
  SHC225: { label: '36/225mm/22.5cm', grp: 11, ord: 0 },
  MSC025: { label: '25-27cm', grp: 0, ord: 1 },
  FBJ499: { label: 'AA65/65AA/AA70/70AA', grp: 9, ord: 0 },
  SIZ999: { label: '均码', grp: 1, ord: 0 },
}));

const labels = (codes) => uniqlo.sizeInfo({ sizeCodes: codes }, V)?.labels;
const info = (codes) => uniqlo.sizeInfo({ sizeCodes: codes }, V);

test('字母码：按梯子顺序排，不看接口给的顺序', () => {
  assert.deepEqual(labels(['SMA006', 'SMA002', 'SMA004']), ['XS', 'M', 'XL']);
});

test('「都有」＝同家族内在售的码连成一段（缺档就一定不连续）', () => {
  assert.equal(info(['SMA002', 'SMA003', 'SMA004']).full, true);
  assert.equal(info(['SMA002', 'SMA004']).full, false, '中间缺 S');
  assert.equal(info(['SMA002', 'SMA006', 'SMA007', 'SMA009']).full, false, '缺 M/L/XXL');
  assert.equal(info(['SMA009']).full, true, '只有一档，它自己就是连续的一段');
});

test('腰围码换成厘米：CMD 用码里的数字，不能拿英寸乘 2.54', () => {
  // 码里数字就是厘米（词表里带 cm 的 7 档全部等于码里数字）
  assert.deepEqual(labels(['CMD073', 'CMD082']), ['73cm', '82cm']);
  // 没写 cm 的那 12 档照补
  assert.deepEqual(labels(['CMD070', 'CMD100']), ['70cm', '100cm']);
  // 反面：32 英寸 = 81.3cm，而官网写 82cm —— 所以不能按英寸换算
  assert.notEqual(labels(['CMD082'])[0], '81cm');
});

test('英寸码换成厘米：INS 的码里数字是英寸，乘 2.54', () => {
  assert.deepEqual(labels(['INS021', 'INS023']), ['53cm', '58cm']);
});

test('其它家族：词表写了 cm 就用它，没写的取第一段', () => {
  assert.deepEqual(labels(['CMA080', 'CMA090']), ['80cm', '90cm']);
  assert.deepEqual(labels(['SHC225']), ['22.5cm'], '鞋码取明写的厘米');
  assert.deepEqual(labels(['MSC025']), ['25-27cm'], '袜码是区间，原样');
  assert.deepEqual(labels(['FBJ499']), ['AA65'], '内衣码没有厘米可取，用第一段');
  assert.deepEqual(labels(['SIZ999']), ['均码']);
});

test('范围能用时只降不升：该款 S~XL、只剩 XS 不算码全', () => {
  const r = uniqlo.sizeInfo({ sizeCodes: ['SMA002'], size_range: 'S ~ XL' }, V);
  assert.equal(r.labels.length, 1);
  assert.equal(r.full, false, '范围写着还有 S/M/L/XL，不能因为「只有一档所以连续」就说都有');
  // 反过来：范围就是 XS~XS 时，只剩 XS 确实就是都有
  assert.equal(uniqlo.sizeInfo({ sizeCodes: ['SMA002'], size_range: 'XS ~ XS' }, V).full, true);
  // 认不出来的写法（CMD 那种）跳过校正，维持连续性判断
  assert.equal(uniqlo.sizeInfo({ sizeCodes: ['CMD070'], size_range: '160/70A ~ 190/120C' }, V).full, true);
});

test('跨家族混在一件商品上时，不当成「都有」', () => {
  const r = info(['SMA002', 'INS021']); // 理论上不会出现，但不能崩、也不能说 full
  assert.equal(r.full, false);
});
