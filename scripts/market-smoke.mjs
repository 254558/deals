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
      const res = await fetch(BASE + '/api/listings');
      if (res.ok) { console.log('  服务就绪（' + BASE + '）\n'); return { stop: () => child.kill('SIGTERM') }; }
    } catch { /* 还没起来 */ }
  }
  child.kill('SIGTERM');
  throw new Error('wrangler pages dev 30 秒内没起来');
}

async function main() {
  if (BASE && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE) && !FORCE) {
    console.error('  拒绝：--url 指向的不是本机。打线上会真的建数据，确认要跑就加 --force');
    process.exit(2);
  }

  let server = null;
  if (!BASE) server = await startServer();
  else console.log('  用已存在的服务：' + BASE + '\n');

  const created = { listingId: null, listingToken: null, commentId: null, commentToken: null };
  try {
    // ── 1. 列表接口（读路径）──
    const list0 = await api('/api/listings');
    check('GET /api/listings 返回 200', list0.status === 200, 'HTTP ' + list0.status);
    check('响应里有 items 数组', Array.isArray(list0.json?.items));
    const before = list0.json?.items?.length ?? 0;

    // ── 2. 发帖（写路径：INSERT 的列数/占位符就靠这一步挡住）──
    const post = await api('/api/listings', {
      title: '冒烟测试 · 请忽略', price: 1, size: 'M', contact: 'wx: smoke', note: 'smoke', image: sampleImage(),
    });
    check('POST /api/listings 返回 200', post.status === 200, 'HTTP ' + post.status + (post.json?.error ? ' ' + post.json.error : ''));
    check('返回了 id 与 token', Boolean(post.json?.id && post.json?.token));
    created.listingId = post.json?.id || null;
    created.listingToken = post.json?.token || null;
    if (!created.listingId) throw new Error('发帖没成功，后面几步没法继续：' + JSON.stringify(post.json));

    // ── 3. 列表里能看到它 ──
    const list1 = await api('/api/listings');
    const mine = list1.json?.items?.find((x) => x.id === created.listingId);
    check('新帖出现在列表里', Boolean(mine), '列表 ' + before + ' → ' + (list1.json?.items?.length ?? '?'));

    // ── 4. 评论（写路径）──
    const cmt = await api('/api/comments', { listingId: created.listingId, body: '冒烟测试的评论' });
    check('POST /api/comments 返回 200', cmt.status === 200, 'HTTP ' + cmt.status + (cmt.json?.error ? ' ' + cmt.json.error : ''));
    created.commentId = cmt.json?.id || null;
    created.commentToken = cmt.json?.token || null;
    check('评论返回了 id 与 token', Boolean(created.commentId && created.commentToken));

    const cmts = await api('/api/comments?listingId=' + created.listingId);
    const cmtList = cmts.json?.items || cmts.json?.comments || [];
    check('评论能读回来', cmts.status === 200 && cmtList.length >= 1, '读到 ' + cmtList.length + ' 条');

    // ── 5. 编辑（写路径，**不带新图**：这一条曾经被写死成必须有图，改不动）──
    const edit = await api('/api/edit', {
      id: created.listingId, token: created.listingToken,
      title: '冒烟测试 · 改过了', price: 2, size: 'L', contact: 'wx: smoke2', note: 'edited',
    });
    check('POST /api/edit 不带新图也能改', edit.status === 200, 'HTTP ' + edit.status + (edit.json?.error ? ' ' + edit.json.error : ''));

    const list2 = await api('/api/listings');
    const after = list2.json?.items?.find((x) => x.id === created.listingId);
    check('改动生效了', after?.title === '冒烟测试 · 改过了' && Number(after?.price) === 2,
      '标题=' + after?.title + ' 价格=' + after?.price);

    // ── 5b. 点赞：切换语义 + 计数 + 「我点过没」──
    const like1 = await api('/api/react', { listingId: created.listingId, kind: 'like' });
    check('点赞成功（on=true、计数 1）', like1.status === 200 && like1.json?.on === true && like1.json?.likes === 1,
      'HTTP ' + like1.status + ' ' + JSON.stringify(like1.json));

    const like2 = await api('/api/react', { listingId: created.listingId, kind: 'like' });
    check('再点一次＝取消（on=false、计数 0）', like2.status === 200 && like2.json?.on === false && like2.json?.likes === 0,
      'HTTP ' + like2.status + ' ' + JSON.stringify(like2.json));

      // （收藏 2026-10-01 已彻底删掉：UI 与后端都清了，这里只测点赞）

    const listR = await api('/api/listings');
    const mineR = listR.json?.items?.find((x) => x.id === created.listingId);
      check('列表里带上计数与我点过没（只剩点赞）', Number(mineR?.likes) === 0 && Number(mineR?.liked) === 0 && mineR?.saves === undefined,
        'likes=' + mineR?.likes + ' liked=' + mineR?.liked + ' saves=' + mineR?.saves);

    const badKind = await api('/api/react', { listingId: created.listingId, kind: 'whatever' });
    check('kind 不对被挡（400）', badKind.status === 400, 'HTTP ' + badKind.status);

    const noTarget = await api('/api/react', { listingId: 'nope-nope-nope', kind: 'like' });
    check('点一条不存在的（404）', noTarget.status === 404, 'HTTP ' + noTarget.status);

    // ── 6. 权限：错凭据必须被拒（403），别把「谁都能改」放出去 ──
    const badEdit = await api('/api/edit', { id: created.listingId, token: 'wrong-token', title: 'x' });
    check('错的凭据改不动（403）', badEdit.status === 403, 'HTTP ' + badEdit.status);
    const badDel = await api('/api/delete', { id: created.listingId, token: 'wrong-token' });
    check('错的凭据删不掉（403）', badDel.status === 403, 'HTTP ' + badDel.status);

    // ── 7. 校验：没图的帖子应该被挡住 ──
    const noImg = await api('/api/listings', { title: 'x', price: 1, contact: 'wx: x' });
    check('缺图的帖子被挡（400）', noImg.status === 400, 'HTTP ' + noImg.status);

    // ── 8. 删评论 + 删帖（写路径，收尾）──
    if (created.commentId) {
      const cd = await api('/api/comment-delete', { id: created.commentId, token: created.commentToken });
      check('删自己的评论', cd.status === 200, 'HTTP ' + cd.status);
    }
    const del = await api('/api/delete', { id: created.listingId, token: created.listingToken });
    check('删自己的帖子', del.status === 200, 'HTTP ' + del.status);
    const list3 = await api('/api/listings');
    check('删完之后列表里没有它了', !list3.json?.items?.some((x) => x.id === created.listingId));
    created.listingId = null; // 已删，不用再收尾
  } finally {
    // 中途失败也要收尾，别在库里留垃圾
    if (created.listingId && created.listingToken) {
      await api('/api/delete', { id: created.listingId, token: created.listingToken }).catch(() => {});
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
