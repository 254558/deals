/**
 * 折扣条 + 「降 N 元」的几种配色，套在**真实卡片**上截图对比。
 *
 * 为什么这么做：颜色是口味问题，色号念出来没人有感觉。
 * 这里直接在线上页面里注入样式覆盖、把同一张卡片的下半截（价格行 + 折扣条）
 * 拍几遍、竖着拼成一张图 —— 并且**把计算样式读回来打出来**，免得出现
 * 「图看着没变，其实注入没生效」这种自己骗自己的情况（第一次就踩了：
 * 条那行红色写在站点作用域里，特异性比我注入的高，两边都是 !important 时拼特异性，
 * 结果它赢 —— 所以下面每一条都带 html[data-site] 把特异性抬上去）。
 *
 * 用法：node scripts/color-preview.mjs [BASE]
 */
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const BASE = process.argv[2] || 'https://goodprices.online';
const OUT = '/tmp/color-preview.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bar = (c) => `html[data-site] .card__bar > i{background:${c} !important}`;
const off = (c) => `.card__off{color:${c} !important}`;
const now = (c) => `html[data-site] .card__now{color:${c} !important}`;

const RED = '#e20c18';
const INK = '#000f17';
const BLUE = '#3643ba';
const ORANGE = '#c2410c';
const GREY = '#8a8f96';

// 每套只动这三处。现价不动的那几套，是为了看清「红只留给品牌」到底值不值。
const VARIANTS = [
  { name: 'A 现状（条红·字红·价红）', css: '' },
  { name: 'B 条墨·字墨（价仍红）', css: bar(INK) + off(INK) },
  { name: 'C 条蓝·字蓝（价仍红）', css: bar(BLUE) + off(BLUE) },
  { name: 'D 条橙·字橙（价仍红）', css: bar(ORANGE) + off(ORANGE) },
  { name: 'E 条灰·字墨（价仍红）', css: bar(GREY) + off(INK) },
  { name: 'F 条灰·字墨·价也墨', css: bar(GREY) + off(INK) + now(INK) },
  { name: 'G 条红·字红·价墨', css: bar(RED) + off(RED) + now(INK) },
];

const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 7917;
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-color-${port}`, 'about:blank']);
chrome.stderr.on('data', () => {});
let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(400);
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = l.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null;
  } catch { /* 还没起来 */ }
}
const sock = new WebSocket(ws);
await new Promise((r) => { sock.onopen = r; });
let id = 0;
const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })); });
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `${BASE}/uniqlo/` });
await sleep(8000);

const picked = await ev(`(() => {
  const c = [...document.querySelectorAll('.card')].find((el) => el.querySelector('.card__bar'));
  if (!c) return null;
  c.setAttribute('data-pv', '1');
  const p = c.querySelector('.card__prices').getBoundingClientRect();
  const b = c.getBoundingClientRect();
  return JSON.stringify({ x: Math.max(0, p.x - 2), y: Math.max(0, p.y - 6), width: b.width + 4, height: Math.max(40, b.bottom - p.top + 8) });
})()`);
if (!picked) { console.error('❌ 没找到带降幅条的卡片'); process.exit(1); }
const box = JSON.parse(picked);
console.log('  裁剪区域（价格行 → 卡片底）：' + JSON.stringify(box) + '\n');

const shots = [];
for (const v of VARIANTS) {
  await ev(`(() => {
    document.getElementById('__pv')?.remove();
    const css = ${JSON.stringify(v.css)};
    if (!css) return;
    const s = document.createElement('style');
    s.id = '__pv';
    s.textContent = css;
    document.head.appendChild(s);
  })()`);
  await sleep(280);
  const got = await ev(`JSON.stringify((() => {
    const c = document.querySelector('[data-pv]');
    return {
      条: getComputedStyle(c.querySelector('.card__bar > i')).backgroundColor,
      字: getComputedStyle(c.querySelector('.card__off')).color,
      价: getComputedStyle(c.querySelector('.card__now')).color,
    };
  })())`);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 3 } });
  shots.push(Buffer.from(r.result.data, 'base64'));
  console.log('  ' + v.name.padEnd(26) + got);
}

const metas = await Promise.all(shots.map((b) => sharp(b).metadata()));
const W = Math.max(...metas.map((m) => m.width));
const GAP = 8;
const total = metas.reduce((a, m) => a + m.height, 0) + GAP * (shots.length - 1);
const comps = [];
let top = 0;
shots.forEach((b, i) => { comps.push({ input: b, left: 0, top }); top += metas[i].height + GAP; });
await sharp({ create: { width: W, height: total, channels: 3, background: '#d9dde1' } })
  .composite(comps)
  .png()
  .toFile(OUT);

console.log('\n  ✅ ' + OUT + '（从上到下：' + VARIANTS.map((v) => v.name).join(' / ') + '）');
sock.close();
chrome.kill();
