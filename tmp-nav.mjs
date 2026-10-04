import { spawn } from 'node:child_process';
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function probe(w,h,mobile){
  const port = 7800 + Math.floor(Math.random()*150);
  const chrome = spawn(CH, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${port}`,'--user-data-dir=/tmp/cdp-nv-'+port,'about:blank']);
  chrome.stderr.on('data',()=>{});
  let ws=null;
  for (let i=0;i<60&&!ws;i++){ await sleep(400); try { const l=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws=l.find(t=>t.type==='page')?.webSocketDebuggerUrl||null; } catch {} }
  const sock=new WebSocket(ws); await new Promise(r=>sock.onopen=r);
  let id=0; const pend=new Map();
  sock.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);sock.send(JSON.stringify({id:i,method:m,params:p}))});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) return '（异常）'; return r.result?.result?.value;};
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:mobile?3:1,mobile});
  await send('Page.navigate',{url:'https://goodprices.online/market/?nv='+Math.random().toString(36).slice(2)}); await sleep(4200);
  const out = await ev(`JSON.stringify((() => {
    const items=[...document.querySelectorAll('.masthead__eyebrow > *')].filter(e=>e.tagName==='A');
    return {
      顺序: items.map(a=>a.textContent.trim()),
      各自左边界: items.map(a=>Math.round(a.getBoundingClientRect().left)),
      我的在最右吗: (() => { const m=document.getElementById('navMine').getBoundingClientRect(); return items.every(a => a.id==='navMine' || a.getBoundingClientRect().right <= m.right + 1); })(),
      我的右边界: Math.round(document.getElementById('navMine').getBoundingClientRect().right),
      视口宽: window.innerWidth,
      导航有没有横向溢出: document.documentElement.scrollWidth > window.innerWidth + 1,
      导航行高: Math.round(document.querySelector('.masthead__eyebrow').getBoundingClientRect().height),
    };
  })())`);
  sock.close(); chrome.kill();
  return out;
}
const a = JSON.parse(await probe(390,844,true));
const b = JSON.parse(await probe(1440,900,false));
console.log('  【390】' + JSON.stringify(a));
console.log('  【1440】' + JSON.stringify(b));
const ok = a.我的在最右吗 && b.我的在最右吗 && !a.导航有没有横向溢出 && !b.导航有没有横向溢出;
console.log(ok ? '  ✅ 两档宽度下「我的」都在最右，且导航没有溢出' : '  ❌ 有问题');
process.exit(ok ? 0 : 1);
