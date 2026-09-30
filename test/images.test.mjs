import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureImages } from '../src/core/images.mjs';

/**
 * 图片缓存那层：统一出 WebP，老缓存（JPEG）就地升级。
 *
 * 这里不碰网络——老缓存升级那条路本来就只读本地文件。新下载那条路靠
 * scripts/market-smoke.mjs 那种打真服务的冒烟来验。
 */
const SIZE = 800;

async function makeLegacyJpeg(dir, code) {
  const sharp = (await import('sharp')).default;
  const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3643ba' } })
    .jpeg({ quality: 90 })
    .toBuffer();
  writeFileSync(join(dir, `${code}@${SIZE}.jpg`), jpg);
  return jpg.length;
}

test('老缓存里的 JPEG 会就地转成 WebP，并删掉旧的', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deals-img-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const jpgBytes = await makeLegacyJpeg(dir, 'u0000000000001');
  const r = await ensureImages([{ id: 'u0000000000001', name: '测试' }], dir, {
    size: SIZE, concurrency: 1, offline: false, sizeVariant: (u) => u,
  });

  assert.equal(r.failed, 0);
  assert.deepEqual([...r.images], [['u0000000000001', `img/u0000000000001@${SIZE}.webp`]]);
  assert.ok(existsSync(join(dir, `u0000000000001@${SIZE}.webp`)), 'WebP 应该生成了');
  assert.ok(!existsSync(join(dir, `u0000000000001@${SIZE}.jpg`)), '老的 JPEG 应该删掉');
  const webpBytes = statSync(join(dir, `u0000000000001@${SIZE}.webp`)).size;
  assert.ok(webpBytes > 0 && webpBytes < jpgBytes, `WebP 该比 JPEG 小（${webpBytes} < ${jpgBytes}）`);
});

test('第二次跑是缓存命中，不再转换、也不下载', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deals-img-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await makeLegacyJpeg(dir, 'u0000000000002');
  await ensureImages([{ id: 'u0000000000002' }], dir, { size: SIZE, sizeVariant: (u) => u });
  const before = readdirSync(dir).sort();

  const again = await ensureImages([{ id: 'u0000000000002' }], dir, { size: SIZE, sizeVariant: (u) => u });
  assert.equal(again.cached, 1);
  assert.equal(again.downloaded, 0);
  assert.equal(again.failed, 0);
  assert.deepEqual(readdirSync(dir).sort(), before, '文件不该被改动');
});

test('既没有缓存、也没给候选地址：不进 images 也不算「失败」（没有候选图可下，不是下载失败）', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deals-img-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = await ensureImages([{ id: 'u0000000000003', name: '没有图的' }], dir, {
    size: SIZE, sizeVariant: (u) => u,
  });
  assert.equal(r.failed, 0, '没候选地址不算下载失败');
  assert.equal(r.images.size, 0, '所以它不在 images 里，生成报告时会被「没图不上榜」那道过滤拦下');
});

test('offline 模式只认缓存，缺的不去下', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deals-img-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await makeLegacyJpeg(dir, 'u0000000000004');
  const r = await ensureImages([{ id: 'u0000000000004' }, { id: 'u0000000000005' }], dir, {
    size: SIZE, sizeVariant: (u) => u, offline: true,
  });
  // offline 时不给 legacy 升级排队（那是本地转换，本来也不需要网络；这里只确认缺图的不报下载）
  assert.equal(r.downloaded, 0, '转换不算下载');
  assert.equal(r.converted, 1);
  assert.equal(r.failed, 0);
});
