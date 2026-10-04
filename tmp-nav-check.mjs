import { spawn } from 'node:child_process';

const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://goodprices.online';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 7995 + Math.floor(Math.random() * 4);
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/cdp-mn3-' + port, 'about:blank']);
chrome.stderr.on('data', () => {});
let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(400);
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = l.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null; } catch {}
}
const sock = new WebSocket(ws);
await new Promise((r) => (sock.onopen = r));
let id = 0; const pend = new Map(); const errs = [];
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails?.exception?.description || '').slice(0, 70));
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return '（异常）'; return r.result?.result?.value; };
const ck = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`    ${ok ? '✅' : '❌'} ${label}：${JSON.stringify(got)}`);
  return ok;
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
let pass = true;

// 三个页面 × 两档宽度：390 专门用来查导航会不会被挤溢出
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 3 : 1, mobile });
  for (const path of ['/', '/uniqlo/', '/decathlon/']) {
    await send('Page.navigate', { url: BASE + path + '?mn=' + Math.random().toString(36).slice(2) });
    await sleep(3600);
    const nav = await ev(`JSON.stringify((() => {
      const as=[...document.querySelectorAll('.masthead__eyebrow a')];
      const mine=as[as.length-1];
      return { 顺序: as.map(a=>a.textContent.trim()), 最后一条是我的: mine && mine.textContent.trim() === '我的',
               href: mine && mine.getAttribute('href'), 新开标签: mine && mine.getAttribute('target'),
               顺序与我的是最右: (() => { const m=mine.getBoundingClientRect(); return as.every(a=>a===mine||a.getBoundingClientRect().right<=m.right+1); })(),
               横向溢出: document.documentElement.scrollWidth > window.innerWidth + 1,
               导航行高: Math.round(document.querySelector('.masthead__eyebrow').getBoundingClientRect().height) };
    })())`);
    const o = JSON.parse(nav);
    console.log(`  【${w}px ${path}】${o.顺序.join(' / ')}`);
    pass = ck('最后一条是「我的」', o.最后一条是我的, true) && pass;
    pass = ck('href', o.href, '/market/?mine=1') && pass;
    pass = ck('不新开标签', o.新开标签, null) && pass;
    pass = ck('它在最右', o.顺序与我的是最右, true) && pass;
    pass = ck('没有横向溢出', o.横向溢出, false) && pass;
  }
}

// 点一下，确认真的落到「我的」视图
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send('Page.navigate', { url: BASE + '/uniqlo/?click=' + Math.random().toString(36).slice(2) });
await sleep(3800);
pass = ck('点「我的」之后', await ev(`(async () => { const as=[...document.querySelectorAll('.masthead__eyebrow a')]; as[as.length-1].click(); await new Promise(r=>setTimeout(r,4200)); return location.pathname + location.search + ' | 顶部按钮=' + (document.querySelector('#postToggle')||{}).textContent; })()`), '?mine=1 | 顶部按钮=我要出一件') && pass;

console.log('  报错: ' + (errs.length ? errs.join(' | ') : '（无）'));
pass = ck('控制台无报错', errs.length, 0) && pass;
sock.close(); chrome.kill();
console.log(pass ? '  全部通过 ✅' : '  有失败项 ❌');
process.exit(pass ? 0 : 1);
