/**
 * 报告界面的**基线截图**：重构（React → Vue）之前先把每个状态拍下来。
 *
 * 为什么非要有这个：这个报告**没有任何视觉回归测试** —— 样式全在一个 700 行的
 * styles.css 里，组件里的类名靠手写。换框架时最容易坏的就是"看着差不多、
 * 其实差 2px"或者某个状态忘了渲染。逐态截图 + 像素比对是唯一能兜住的东西。
 *
 * 用法：
 *   node scripts/shot.mjs <前缀>            # 拍一套到 /tmp/shots-<前缀>/
 *   node scripts/shot.mjs after --url=...   # 指定地址（默认打线上）
 *
 * 输出每个状态的 PNG + 一份 index.json（记下每张的尺寸与几个关键量出来的像素值，
 * 比纯图片更好 diff：数值不同就直接能看出是哪儿变了）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const prefix = args.find((a) => !a.startsWith('--')) || 'shot';
const urlArg = args.find((a) => a.startsWith('--url='));
const BASE = urlArg ? urlArg.slice(6).replace(/\/$/, '') : 'https://goodprices.online';
const OUT = `/tmp/shots-${prefix}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 7900 + Math.floor(Math.random() * 90);
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-shot-${port}`, 'about:blank']);
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
const errs = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })); });
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 120));
};
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception?.description || '').slice(0, 160) };
  return r.result?.result?.value;
};
const shot = async (name, extra = '') => {
  // 每张都顺手量几个关键盒子：图片看不出 2px，数字能
  const box = await ev(`JSON.stringify((() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    return {
      nav: r('.masthead'), toolbar: r('.toolbar'), grid: r('.grid'), card: r('.card'),
      cardImg: r('.card__img'), cardName: r('.card__name'), cardNow: r('.card__now'),
      dealBar: r('.card__bar'), acts: r('.dealacts'), mine: r('.mine'), tabs: r('.mine__tabs'), fav: r('.mine .fav'),
      cards: document.querySelectorAll('.card').length,
      bodyH: document.body.scrollHeight
    };
  })())`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('    ' + name.padEnd(26) + (typeof box === 'string' ? box.slice(0, 90) : String(box).slice(0, 90)));
  return typeof box === 'string' ? JSON.parse(box) : null;
};

const record = {};
await send('Page.enable');
await send('Runtime.enable');

// ── 手机（390×844，2x）──
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: `${BASE}/uniqlo/?v=${Math.random().toString(36).slice(2)}` });
await sleep(7000);
record.mobileList = await shot('01-mobile-list');

await ev(`(() => {
  const i = document.querySelector('.search');
  // ⚠️ React 的受控输入框：直接改 .value 不会触发 onChange，必须走原生 setter。
  // Vue 那边用普通事件监听，dispatchEvent 就够 —— 所以这一步是 React 专属的坑。
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  i.focus(); set.call(i, '裙'); i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(900);
record.mobileSearch = await shot('02-mobile-search');

await ev(`(() => {
  const i = document.querySelector('.search');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(700);
// 尺码筛选：点那颗按钮，再选一个码
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /尺码|码/.test(x.textContent)); if (b) b.click(); })()`);
await sleep(600);
record.mobileSizeOpen = await shot('03-mobile-size-open');
await ev(`[...document.querySelectorAll('.sizefilter__pop button')].find((x) => x.textContent.trim() === 'M')?.click()`);
await sleep(800);
record.mobileSizeOn = await shot('04-mobile-size-M');

// 收藏一件 → 进「我的」
await ev(`document.querySelector('.dealact[aria-pressed="false"]')?.click()`);
await sleep(700);
record.mobileFaved = await shot('05-mobile-faved');
await ev(`[...document.querySelectorAll('.masthead__cross')].find((x) => x.textContent.trim() === '我的')?.click()`);
await sleep(900);
record.mineFavs = await shot('06-mine-favs');
await ev(`[...document.querySelectorAll('.mine-tab')].find((x) => x.textContent.trim() === '转移码')?.click()`);
await sleep(500);
record.mineTransfer = await shot('07-mine-transfer');

// ── 桌面（1280×900，1x）──
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/uniqlo/?v=${Math.random().toString(36).slice(2)}` });
await sleep(7000);
record.desktopList = await shot('08-desktop-list');

writeFileSync(`${OUT}/index.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), boxes: record, errors: errs }, null, 2));
console.log('\n  截图 → ' + OUT + '（' + Object.keys(record).length + ' 张）+ index.json');
if (errs.length) console.log('  ⚠️ JS 异常：' + errs.join(' | '));
sock.close();
chrome.kill();
