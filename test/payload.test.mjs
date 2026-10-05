import { test } from 'node:test';
import assert from 'node:assert/strict';

import uniqlo from '../src/sites/uniqlo.mjs';
import decathlon from '../src/sites/decathlon.mjs';
import { buildPayload } from '../src/core/report.mjs';
import { blockCode } from '../src/core/db.mjs';
import { tmpDb, product, sync } from './helpers.mjs';

/** 词表：码 → {label, grp, ord}，形状跟 loadSizeVocab 出来的一样 */
const vocab = (rows) => {
  const m = new Map();
  for (const [code, label, grp, ord] of rows) m.set(code, { label, grp, ord });
  return m;
};

test('payload 契约：字段齐全、没有空图、没有被屏蔽的商品、meta 里没有页脚', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const products = [
    product({ name: '抽褶裙', code: '488089', sizeRange: 'S ~ XL', sizeCodes: ['SMA003', 'SMA006'] }),
    product({ name: '廓形针织T恤', code: '482979', sizeRange: 'S ~ XL', sizeCodes: ['SMA002'] }),
  ];
  sync(db, 'uniqlo', products);
  const images = new Map(products.map((p) => [p.productCode, `img/${p.productCode}@561.jpg`]));

  // 带上词表（buildPayload 从库里读，所以先写进去）
  db.prepare('INSERT INTO size_vocab (site, code, label, grp, ord) VALUES (?,?,?,?,?)')
    .run('uniqlo', 'SMA002', 'XS', 2, 0);
  db.prepare('INSERT INTO size_vocab (site, code, label, grp, ord) VALUES (?,?,?,?,?)')
    .run('uniqlo', 'SMA003', 'S', 2, 1);
  db.prepare('INSERT INTO size_vocab (site, code, label, grp, ord) VALUES (?,?,?,?,?)')
    .run('uniqlo', 'SMA006', 'XL', 2, 4);

  const payload = buildPayload(db, uniqlo, images);
  assert.equal(payload.deals.length, 2);
  for (const d of payload.deals) {
    assert.ok(d.image, '每件都必须有本地图——没图的在生成阶段就被剔了');
    assert.ok(!d.name.includes('/'), '名字不该带斜线（适配器截过）');
      // 尺码要么算得出来，要么**因为码自相矛盾被丢光**（2026-10-05 起）。
      // 原来写的是 assert.ok(d.sizes) —— 那会把「丢掉范围外的码」这个正确行为判成失败。
      assert.ok(
        d.sizes === null || Array.isArray(d.sizes.labels),
        '尺码的形状只能是 null 或 {labels}（不能是别的）',
      );
    if (d.sizes) assert.ok(Array.isArray(d.sizes.labels), '有尺码就必须是数组');
  }
  // 「还剩哪些」与「是不是都有」：在售 [S, XL] 而该款 S~XL → 缺档
  const skirt = payload.deals.find((d) => d.name === '抽褶裙');
  assert.deepEqual(skirt.sizes.labels, ['S', 'XL']);
  assert.equal(skirt.sizes.full, false);
  // 只剩一档、而该款范围就是那一档 → 全都有
  const tee = payload.deals.find((d) => d.name === '廓形针织T恤');
  // 只剩一档、但那一档**不在该款范围里**（范围 S~XL，接口却给了 XS）→ 直接丢掉，
  // 于是这件没有可说的尺码。这就是线上「筛 XS 点进去没有 XS」那条坏数据的形状，
  // 而 fixture 里一直是它 —— 2026-10-05 之前的选择是「留着码、只把 full 降级」，现在改成丢掉。
  assert.equal(tee.sizes, null, '范围外的码丢掉后没得说，就是 null');

  // meta 里不该再有页脚那三样（2026-09-30 撤掉）
  assert.equal(payload.meta.foot, undefined);
  assert.equal(payload.meta.fontNotice, undefined);
  assert.equal(payload.meta.source, undefined);
  assert.equal(payload.meta.label, '优衣库');
});

test('没图的商品：有 images 时剔掉，没有 images（下载那一趟）时保留', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const withImg = product({ name: '有图' });
  const noImg = product({ name: '没图' });
  sync(db, 'uniqlo', [withImg, noImg]);
  const images = new Map([[withImg.productCode, 'img/a.jpg']]);

  assert.equal(buildPayload(db, uniqlo, images).deals.length, 1, '有图那一趟只留能显示的');
  assert.equal(buildPayload(db, uniqlo, null).deals.length, 2, '下载那一趟两件都要，否则永远下不到图');
});

test('谢绝名单里的商品不进 payload（所有设备、所有域名都一致）', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const a = product({ name: '要屏蔽的', code: '111111' });
  const b = product({ name: '要留着的', code: '222222' });
  sync(db, 'uniqlo', [a, b]);
  blockCode(db, 'uniqlo', '111111', '要屏蔽的');

  const names = buildPayload(db, uniqlo, null).deals.map((d) => d.name);
  assert.deepEqual(names, ['要留着的']);
});

test('迪卡侬没有尺码钩子：sizes 恒为 null（卡片于是显示商品名）', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  sync(db, 'decathlon', [product({ name: '乒乓球捡球器' })]);
  const payload = buildPayload(db, decathlon, null);
  assert.equal(payload.deals.length, 1);
  assert.equal(payload.deals[0].sizes, null);
  assert.equal(payload.meta.label, '迪卡侬');
  assert.equal(typeof decathlon.sizeInfo, 'undefined');
});

test('站点描述符：两家的必备字段都在，且没有残留的顶层 sortHint', () => {
  for (const site of [uniqlo, decathlon]) {
    // features 挂在 report 上（组件的 META.features 就是从那儿来的），不在描述符顶层
    for (const k of ['id', 'label', 'tableColumns', 'report', 'report.features', 'copy', 'parseCode', 'sync']) {
      const v = k.split('.').reduce((o, kk) => o?.[kk], site);
      assert.ok(v !== undefined, `${site.id} 少了 ${k}`);
    }
    assert.equal(site.sortHint, undefined, '取短名的 sortHint 早删了，CLI 读的是 copy.sortHint');
    assert.ok(site.copy.sortHint, 'CLI 的 --sort 提示文案还在 copy 里');
  }
});

test('词表不认识的新码：返回 null，绝不瞎猜', () => {
  const v = vocab([['SMA002', 'XS', 2, 0]]);
  assert.equal(uniqlo.sizeInfo({ sizeCodes: ['SMA002', 'ZZZ999'] }, v), null);
  assert.equal(uniqlo.sizeInfo({ sizeCodes: [] }, v), null);
  assert.equal(uniqlo.sizeInfo({ sizeCodes: ['SMA002'] }, new Map()), null);
});
