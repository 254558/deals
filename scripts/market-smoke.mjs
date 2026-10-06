#!/usr/bin/env node
/**
 * 市集接口的**端到端冒烟**：打真 wrangler + 真 D1，把四条写路径全走一遍。
 *
 * 为什么非要有这个（而不是靠 test/market.test.mjs）：
 *   单元测试用的是**手写的假 D1**，SQL 只被正则匹配、**根本不执行** —— 所以
 *   「列数和占位符个数不匹配」这类错它天然看不见。2026-10-01 就是因为
 *   `INSERT INTO listings` 有 11 列却写了 12 个 `?`，线上发帖 500 挂了几个小时，
 *   而当时 43 条单测全绿。**只有打真库才能挡住这一类。**
 *
 * 用法：
 *   node scripts/market-smoke.mjs                 # 自己起 wrangler pages dev，跑完杀掉
 *   node scripts/market-smoke.mjs --url=http://localhost:8788   # 用已经起着的那台
 *   node scripts/market-smoke.mjs --url=https://goodprices.online --force   # 打线上（会真的建/删）
 *
 * 它只碰自己创建的那几条数据，结束时全部删掉。
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='));
const FORCE = args.includes('--force');

let BASE = urlArg ? urlArg.slice(6).replace(/\/$/, '') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}

async function api(path, body) {
  const res = await fetch(BASE + path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  let json = null;
  try { json = await res.json(); } catch { /* 可能不是 JSON，交给调用方判断 */ }
  return { status: res.status, json };
}

/** 一张真图片（优先用仓库里现成的商品图；没有就用内嵌的 1×1 WebP 兜底） */
function sampleImage() {
  const dir = join(ROOT, 'reports/uniqlo/img');
  if (existsSync(dir)) {
    const f = readdirSync(dir).find((x) => x.endsWith('.webp'));
    if (f) return 'data:image/webp;base64,' + readFileSync(join(dir, f)).toString('base64');
  }
  // 1×1 的 WebP（体积最小，用来兜底）
  return 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=';
}

/** 起一台 wrangler pages dev（本地真 D1），返回 { stop } */
async function startServer() {
  const port = 8800 + Math.floor(Math.random() * 100);
  BASE = 'http://localhost:' + port;
  // 先确保本地 D1 有表：CI / 新机器上 .wrangler 是空的，不建表第一步就会 500
  console.log('  确认本地 D1 的表结构（新环境会现建）…');
  await new Promise((resolve) => {
    const seed = spawn('npx', ['--yes', 'wrangler@latest', 'd1', 'execute', 'deals-market',
      '--local', '--file=market/schema.sql', '--yes'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    seed.on('exit', () => resolve());
    seed.on('error', () => resolve());
  });

  // 先把市集页铺进 reports/（注入 shell），否则本地起的服务用的是旧拷贝
  const { stageMarketPages } = await import('../src/core/report.mjs');
  const staged = stageMarketPages(join(ROOT, 'reports'), ROOT, { beacon: false }); // 本地不插统计
  console.log('  已铺 ' + staged + ' 个市集页到 reports/market/');

  console.log('  正在起 wrangler pages dev（本地真 D1，端口 ' + port + '）…');
  const child = spawn('npx', ['--yes', 'wrangler@latest', 'pages', 'dev', 'reports',
    '--port', String(port), '--compatibility-date=2026-09-01'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
        // 探针要打**现在还活着**的接口。2026-10-06 这里踩过一次：接口从 listings
        // 换成 reviews 之后，探针忘了改，于是一直 404、永远等不到「就绪」，
        // 报出来的却是「wrangler 30 秒没起来」——看起来像环境问题，其实是自己的尾巴。
        const res = await fetch(BASE + '/api/reviews');
      if (res.ok) { console.log('  服务就绪（' + BASE + '）\n'); return { stop: () => child.kill('SIGTERM') }; }
    } catch { /* 还没起来 */ }
  }
  child.kill('SIGTERM');
  throw new Error('wrangler pages dev 60 秒内没起来');
}

async function main() {
  if (BASE && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE) && !FORCE) {
    console.error('  拒绝：--url 指向的不是本机。打线上会真的建数据，确认要跑就加 --force');
    process.exit(2);
  }

  let server = null;
  if (!BASE) server = await startServer();
  else console.log('  用已存在的服务：' + BASE + '\n');

  const created = { reviewId: null, reviewToken: null };
  try {
    // ── 1. 读路径 ──
    const list0 = await api('/api/reviews');
    check('GET /api/reviews 返回 200', list0.status === 200, 'HTTP ' + list0.status);
    check('响应里有 items 数组', Array.isArray(list0.json?.items));
    const before = list0.json?.items?.length ?? 0;

    // ── 2. 写一条测评（INSERT 的列数/占位符就靠这一步挡住）──
    const post = await api('/api/reviews', {
      productCode: 'u0000000072656', code: '488089', name: '抽褶裙',
      body: '冒烟测试：面料挺软的，这个价我觉得值', image: sampleImage(),
    });
    check('POST /api/reviews 返回 200', post.status === 200, 'HTTP ' + post.status + (post.json?.error ? ' ' + post.json.error : ''));
    created.reviewId = post.json?.id || null;
    created.reviewToken = post.json?.token || null;
    check('返回了 id 与 token', Boolean(created.reviewId && created.reviewToken));

    // ── 3. 按商品查得到 ──
    const byProduct = await api('/api/reviews?productCode=u0000000072656');
    const mine = byProduct.json?.items?.find((x) => x.id === created.reviewId);
    check('按商品号能查到这条', Boolean(mine), '之前 ' + before + ' 条，这件共 ' + (byProduct.json?.items?.length ?? '?') + ' 条');
    check('带上了商品名与心得', mine?.name === '抽褶裙' && /冒烟测试/.test(mine?.body || ''));
    check('有图时 hasImage = 1', Number(mine?.hasImage) === 1);

    // ── 4. counts：报告卡片上那个角标靠它 ──
    const counts = await api('/api/reviews?counts=1');
    check('counts 里数得到这件', Number(counts.json?.counts?.['u0000000072656']) >= 1);

    // ── 5. 图真的能出来（D1 把 BLOB 回成普通数组，不过 Uint8Array 那一关图就废了）──
    const img = await fetch(BASE + '/api/img/' + created.reviewId);
    const buf = new Uint8Array(await img.arrayBuffer());
    check('GET /api/img/<id> 返回 200 且有内容', img.status === 200 && buf.length > 100, 'HTTP ' + img.status + '  ' + buf.length + 'B');

    // ── 6. 校验与凭据 ──
    const noProduct = await api('/api/reviews', { body: '没有商品号的一条' });
    check('缺商品号被挡（400）', noProduct.status === 400, 'HTTP ' + noProduct.status);
    const tooShort = await api('/api/reviews', { productCode: 'u1', body: '好' });
    check('心得太短被挡（400）', tooShort.status === 400, 'HTTP ' + tooShort.status);
    const badDel = await api('/api/review-delete', { id: created.reviewId, token: 'wrong-token' });
    check('错的凭据删不掉（403）', badDel.status === 403, 'HTTP ' + badDel.status);

    // ── 7. 删自己的（只置 hidden，列表里立刻看不到）──
    const del = await api('/api/review-delete', { id: created.reviewId, token: created.reviewToken });
    check('删自己的测评', del.status === 200, 'HTTP ' + del.status);
    const list3 = await api('/api/reviews?productCode=u0000000072656');
    check('删完之后列表里没有它了', !list3.json?.items?.some((x) => x.id === created.reviewId));
    created.reviewId = null; // 已删，不用再收尾

    // ── 8. 管理接口：不带口令必须被挡（本地没配 ADMIN_TOKEN 时是 503，也算挡住了）──
    const admin = await api('/api/admin/list');
    check('GET /api/admin/list 不带口令会被挡', [401, 403, 503].includes(admin.status), 'HTTP ' + admin.status);
  } finally {
    // 中途失败也要收尾，别在库里留垃圾
    if (created.reviewId && created.reviewToken) {
      await api('/api/review-delete', { id: created.reviewId, token: created.reviewToken }).catch(() => {});
      console.log('  （已清理中途留下的那条测试数据）');
    }
    if (server) { server.stop(); console.log('  （已停掉 wrangler）'); }
  }

  console.log('\n  合计：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n  冒烟跑挂了：' + err.message);
  process.exit(1);
});
