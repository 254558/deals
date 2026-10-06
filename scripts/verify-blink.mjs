import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.env.BASE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 7903;
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-bs-${port}`, 'about:blank']);
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
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'ERR:' + String(r.result.exceptionDetails.exception?.description || '').slice(0, 100);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: `${BASE}/uniqlo/` });
await sleep(8000);

const litNow = `[...document.querySelectorAll('.searchbox__grid > i')].filter(el => Number(getComputedStyle(el).opacity) > 0.05).length`;
console.log('  格子总数：' + await ev(`document.querySelectorAll('.searchbox__grid > i').length`));
console.log('  搜索框底是不是透明的（方格才露得出来）：' + await ev(`getComputedStyle(document.querySelector('.search')).backgroundColor`));
console.log('  容器底：' + await ev(`getComputedStyle(document.querySelector('.searchbox')).backgroundColor`));
console.log('  输入框能不能打字：' + await ev(`(() => { const i=document.querySelector('.search'); const e=new Event('input',{bubbles:true}); i.value='裙'; i.dispatchEvent(e); return i.value; })()`));

const box = JSON.parse(await ev(`JSON.stringify((() => { const r=document.querySelector('.searchbox').getBoundingClientRect(); return { x:Math.max(0,r.x-3), y:Math.max(0,r.y-3), width:r.width+6, height:r.height+6 }; })())`));

const litSamples = [];
const shots = [];
for (let k = 0; k < 3; k++) {
  const lit = await ev(litNow);
  litSamples.push(lit);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 4 } });
  shots.push(Buffer.from(r.result.data, 'base64'));
  console.log(`  第 ${k + 1} 次取样：亮着 ${lit} 格`);
  await sleep(650);
}

// 三张竖着拼起来，方便看"图案确实变了"
const metas = await Promise.all(shots.map((b) => sharp(b).metadata()));
const W = Math.max(...metas.map((m) => m.width));
const H = metas.reduce((a, m) => a + m.height, 0) + 8 * (shots.length - 1);
const comps = [];
let top = 0;
shots.forEach((b, i) => { comps.push({ input: b, left: 0, top }); top += metas[i].height + 8; });
await sharp({ create: { width: W, height: H, channels: 3, background: '#d9dde1' } }).composite(comps).png().toFile('/tmp/blinking-squares.png');
console.log('\n  ✅ /tmp/blinking-squares.png（三张相隔 650ms，图案应当各不相同）');
console.log('  亮的格数：' + litSamples.join(' → ') + (new Set(litSamples).size > 1 ? '  ✅ 确实在变' : '  ❌ 三次一样，没在动'));
sock.close();
chrome.kill();
