import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, saveSnapshot, startRun, finishRun } from '../src/core/db.mjs';

/** 每个用例一个临时库，用完删掉（跑在 /tmp 里，绝不碰 data/deals.db） */
export function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'deals-test-'));
  const db = openDb(join(dir, 'test.db'));
  return {
    db,
    done() { try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}

let seq = 0;
/** 一件规范形状的商品（跟适配器 sync() 交出来的同形） */
export function product(over = {}) {
  seq += 1;
  const originPrice = over.originPrice ?? 200;
  const price = over.price ?? 100;
  return {
    productCode: over.productCode ?? `u${String(seq).padStart(13, '0')}`,
    code: over.code ?? String(480000 + seq),
    name: over.name ?? `测试商品 ${seq}`,
    brand: '', sports: '', season: '2026年夏季',
    sizeRange: over.sizeRange ?? 'S ~ XL',
    sizeCodes: over.sizeCodes ?? [],
    url: 'https://example.invalid/p',
    image: 'https://example.invalid/i.jpg',
    images: ['https://example.invalid/i.jpg'],
    tags: over.tags ?? ['concessional_rate'],
    extra: {},
    originPrice, price,
    monthlySales: 0,
    inStock: over.inStock ?? true,
  };
}

/** 跑一轮完整抓取（有 run 记录，delisting 的基准靠它） */
export function sync(db, site, products, { tracked = false, full = true } = {}) {
  const runId = startRun(db, site, 'test');
  const diff = saveSnapshot(db, site, products, { tracked, full });
  finishRun(db, runId, { fetched: products.length, discounted: products.length });
  return diff;
}
