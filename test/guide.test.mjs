import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { buildGuide, loadContent, STALE_HOURS } from '../src/core/guide.mjs';
// `site` 参数一律传**站点描述符**（buildGuide 里要读 site.id），不是 'uniqlo' 这个字符串
import uniqlo from '../src/sites/uniqlo.mjs';
import { buildPayload } from '../src/core/report.mjs';
import { tmpDb, product, sync } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 仓库里那份真内容文件 —— 「人工整理」那层的真身，它坏了页面上就是一页兜底 */
const REAL = join(ROOT, 'content', 'double11.json');

/** 一份最小的、合法的内容文件（想单独验某一块时从它改） */
const minimal = (over = {}) => ({
  updatedAt: '2026-10-12',
  expiresAt: '2026-11-13',
  intro: '导语',
  schedule: [{ when: '10/20 20:00', at: '2026-10-20T20:00:00+08:00', what: '付尾款', todo: '凑单' }],
  sources: [{ name: '会场', url: 'https://example.invalid', how: 'APP 里领' }],
  ...over,
});

/** 把内容写进临时文件，返回路径（用完连目录一起删） */
function tmpContent(t, content, { raw = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deals-guide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, 'double11.json');
  writeFileSync(p, raw ?? JSON.stringify(content), 'utf8');
  return p;
}

/* ── 仓库里那份真内容：它是给人维护的，写错了页面就塌了，所以钉住它的形状 ── */

test('content/double11.json：必备字段齐全，日期/时间点都合法', () => {
  const { content, warn } = loadContent(REAL);
  assert.equal(warn, null, `真内容文件读不动：${warn}`);
  assert.match(content.updatedAt, /^\d{4}-\d{2}-\d{2}$/, 'updatedAt 是给人看的日期');
  assert.match(content.expiresAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(content.updatedAt <= content.expiresAt, '更新日不该晚于失效日');

  for (const s of content.schedule) {
    assert.ok(s.when && s.what, `时间表每条都要有 when / what：${JSON.stringify(s)}`);
    // at 是机器算倒计时用的：必须是带时区的 ISO 时间，写错页面上的「还有几天」就是错的
    assert.match(s.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, `at 要带时区：${s.at}`);
    assert.ok(Number.isFinite(new Date(s.at).getTime()), `at 解析不出来：${s.at}`);
  }
  // 时间表按时间排好了（页面直接顺序渲染，不排序）
  const times = content.schedule.map((s) => new Date(s.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), '时间表要按 at 从早到晚排');

  for (const s of content.sources) {
    assert.ok(s.name && s.how, `领取入口每条都要有 name / how：${JSON.stringify(s)}`);
    assert.match(s.url, /^https:\/\//, `入口 url 必须是 https：${s.url}`);
  }
  for (const k of ['formula', 'summary']) assert.ok(content[k], `${k} 不能空`);
  for (const k of ['timeNotes', 'formulaTips', 'stackOrder', 'byCategory', 'pitfalls']) {
    assert.ok(Array.isArray(content[k]) && content[k].length, `${k} 得是非空数组`);
  }
  for (const c of [...content.byCategory, ...content.pitfalls]) {
    assert.ok(c.t && c.d, `{t, d} 两条都要有：${JSON.stringify(c)}`);
  }

  // 「往年经验」那层（官方口径还没公布时先顶上的参考版）。
  // 官方公布之后人工把它删掉或改成已核实，都是**允许的**（见 JSON 里的 _readme）——
  // 到那天把下面这几行一起改掉就行：它们在这儿是提醒"这层还在、且还是未经核实的老样子"。
  assert.ok(content.reference, 'reference 现在还在（官方口径未公布，先摆参考版）');
  assert.ok(content.reference.headline && content.reference.note, 'headline（置顶说明）/ note（收尾）都要有');
  assert.ok(Array.isArray(content.reference.items) && content.reference.items.length, 'reference.items 得是非空数组');
  for (const r of content.reference.items) {
    assert.ok(r.t && r.d, `{t, d} 两条都要有：${JSON.stringify(r)}`);
  }
});

/* ── 组装出来的形状 ── */

test('guide：不变的字段原样带过来，倒计时只带 at 不带算好的结果', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);
  sync(db, 'uniqlo', [product()]);

  const { guide, warn } = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.equal(warn, null);
  assert.equal(guide.updatedAt, '2026-10-12');
  assert.equal(guide.expiresAt, '2026-11-13');
  assert.ok(guide.intro && guide.formula && guide.summary);
  assert.ok(guide.stackOrder.length >= 4);

  // **刻意不在后端算倒计时**：报告可能是几天前生成的，这里算出来的「还有 2 天」到时候就是错的。
  // 所以只带 at，由页面按读者的时钟现算（见 MineDouble11.vue）。
  for (const s of guide.schedule) {
    assert.ok(s.at, 'at 要原样带过去');
    assert.equal(s.daysLeft, undefined, '不许把算好的倒计时塞进 payload');
    assert.equal(typeof s.when, 'string');
  }
});

test('guide：sources 的 url 与 how 都在，但 probe 为 null 时不许假装探测过', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const { guide } = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.ok(guide.sources.length >= 1);
  for (const s of guide.sources) {
    assert.match(s.url, /^https:\/\//);
    assert.equal(s.probe, null, 'probe: false 那一趟每条都该是 null（页面显示「本次没探测」）');
  }
  assert.equal(guide.probedAt, null, '没探测就不该有探测时刻');
});

/* ── 新鲜度：断档判定 ── */

test('sync：刚抓完 → 不算断档；40 小时前抓的 → 断档', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);
  sync(db, 'uniqlo', [product()]);

  const fresh = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.equal(fresh.guide.sync.stale, false);
  assert.ok(fresh.guide.sync.hoursAgo < 1);
  assert.equal(fresh.guide.sync.staleHours, STALE_HOURS);
  assert.equal(STALE_HOURS, 36, '这个阈值和 cli.mjs 的 cmdAlert 共用，改了要两边一起看');

  // 把最后一轮的成功时间挪到 40 小时前（判定线是 > 36）
  const old = new Date(Date.now() - 40 * 3_600_000).toISOString();
  db.prepare('UPDATE runs SET finished_at = ? WHERE site = ?').run(old, 'uniqlo');

  const stale = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.equal(stale.guide.sync.stale, true, '超过 36 小时就是断档，页顶要挂提示');
  assert.ok(stale.guide.sync.hoursAgo > 39 && stale.guide.sync.hoursAgo < 41);
  assert.equal(stale.guide.sync.lastAt, old);
});

test('sync：还从来没抓成功过 → 也算断档，且不抛', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const { guide } = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.equal(guide.sync.lastAt, null);
  assert.equal(guide.sync.hoursAgo, null, '没有那一刻就只能给 null，不能给 Infinity（JSON 里会变成 null）');
  assert.equal(guide.sync.stale, true);
});

/* ── 探测：通了 / 没通 / 永不抛 ── */

test('探测：打不通的入口只记 ok:false，绝不抛（报告照常生成）', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  // 127.0.0.1:1 一定是关着的端口 —— 连不上、又不是 DNS 解析那种要等超时的
  const path = tmpContent(t, minimal({
    sources: [
      { name: '打不通的', url: 'http://127.0.0.1:1', how: '自己查' },
      { name: '没有 url 的', how: '去 APP 里找' },
    ],
  }));

  const { guide, warn } = await buildGuide(db, uniqlo, { contentPath: path, probe: true });
  assert.equal(warn, null, '探测失败不该变成内容层的 warn');
  assert.equal(guide.probedAt !== null, true, '探测过就该有探测时刻');

  const bad = guide.sources.find((s) => s.name === '打不通的');
  assert.equal(bad.probe.ok, false, '页面据此说「今天没抓到，点这里自己去查」');
  assert.equal(bad.probe.status, 0);
  assert.ok(bad.probe.error, '要留下原因，鼠标停上去能看到');

  // 内容里没写 url 的那条：不是"探测失败"，是压根没得探测
  const none = guide.sources.find((s) => s.name === '没有 url 的');
  assert.equal(none.url, null);
  assert.equal(none.probe, null);
});

test('探测：同一个 URL 只打一次（内容里淘宝和 88VIP 指向同一个域名）', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);
  const path = tmpContent(t, minimal({
    sources: [
      { name: '淘宝 A', url: 'http://127.0.0.1:1/a', how: 'x' },
      { name: '淘宝 B', url: 'http://127.0.0.1:1/a', how: 'y' },
    ],
  }));

  const { guide } = await buildGuide(db, uniqlo, { contentPath: path, probe: true });
  const [a, b] = guide.sources;
  assert.equal(a.probe.ok, false);
  // 两次拿到的必须是**同一次探测的结果**（同一个对象），证明确实只打了一次
  assert.equal(a.probe, b.probe);
});

/* ── 内容层坏了：一律 null + warn，绝不把报告带下去 ── */

test('内容文件读不到 / 不是 JSON / 缺字段 → guide 为 null 且给出 warn，都不抛', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  const missing = await buildGuide(db, uniqlo, { contentPath: join(ROOT, 'content', '根本没有这个文件.json') });
  assert.equal(missing.guide, null);
  assert.match(missing.warn, /读不到/);

  const broken = await buildGuide(db, uniqlo, { contentPath: tmpContent(t, null, { raw: '{ 这不是 JSON' }) });
  assert.equal(broken.guide, null);
  assert.match(broken.warn, /不是合法 JSON/);

  const lacks = await buildGuide(db, uniqlo, { contentPath: tmpContent(t, { intro: '只有一段话' }) });
  assert.equal(lacks.guide, null);
  assert.match(lacks.warn, /缺字段/);

  const empty = await buildGuide(db, uniqlo, { contentPath: tmpContent(t, minimal({ schedule: [] })) });
  assert.equal(empty.guide, null);
  assert.match(empty.warn, /schedule/);
});

test('内容层：单条写残的丢掉，剩下的照常渲染（一条写错不该让整页没了）', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);
  const path = tmpContent(t, minimal({
    schedule: [
      { when: '好的', at: '2026-10-20T20:00:00+08:00', what: '照常' },
      { when: '缺 what 的', at: '2026-10-21T20:00:00+08:00' },
      { what: '缺 when 的' },
    ],
    sources: [{ name: '好的', how: '照常' }, { name: '缺 how 的' }],
  }));

  const { guide, warn } = await buildGuide(db, uniqlo, { contentPath: path, probe: false });
  assert.equal(warn, null);
  assert.deepEqual(guide.schedule.map((s) => s.when), ['好的']);
  assert.deepEqual(guide.sources.map((s) => s.name), ['好的']);
  // 人工没写 at 的照样进 payload，只是页面不画那个倒计时角标
  assert.equal(guide.sources[0].url, null);
});

/* ── 「往年经验」那层：可以为空，但绝不能因为它空了就把整页带走 ── */

test('reference：原样透传；没写 / 写空 → null（整页照常），写残的单条丢掉', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);

  // 内容里没写 reference：页面上就没有「往年经验」那一段，其它照旧
  const bare = await buildGuide(db, uniqlo, { contentPath: tmpContent(t, minimal()), probe: false });
  assert.equal(bare.warn, null);
  assert.notEqual(bare.guide, null, 'reference 是可选层，缺了不该把 guide 变成 null');
  assert.equal(bare.guide.reference, null);

  // 单条写残的丢掉，剩下的照常渲染
  const path = tmpContent(t, minimal({
    reference: { headline: '置顶那句', items: [{ t: '好的', d: '照常' }, { t: '缺 d 的' }], note: '收尾' },
  }));
  const { guide } = await buildGuide(db, uniqlo, { contentPath: path, probe: false });
  assert.equal(guide.reference.headline, '置顶那句');
  assert.deepEqual(guide.reference.items, [{ t: '好的', d: '照常' }]);
  assert.equal(guide.reference.note, '收尾');

  // items 空数组 / 写成了别的类型：整段不渲染，而不是渲染一个空壳标题
  for (const bad of [{ items: [] }, { headline: '只有一句' }, {}]) {
    const { guide: g } = await buildGuide(db, uniqlo, { contentPath: tmpContent(t, minimal({ reference: bad })), probe: false });
    assert.equal(g.reference, null, `reference 写成 ${JSON.stringify(bad)} 时该是 null`);
    assert.notEqual(g, null, 'reference 写坏了不该把整份 guide 带下去');
  }
});

/* ── payload 接线：guide 是顶层键，默认为 null ── */

test('payload：带 guide 时原样带出去，不传时为 null', async (t) => {
  const { db, done } = tmpDb();
  t.after(done);
  sync(db, 'uniqlo', [product()]);

  assert.equal(buildPayload(db, uniqlo, null).guide, null, '没传就是 null（页面走兜底），不是 undefined');

  const { guide } = await buildGuide(db, uniqlo, { contentPath: REAL, probe: false });
  assert.equal(buildPayload(db, uniqlo, null, { guide }).guide, guide);
});
