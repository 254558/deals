/**
 * 做一张「免费压缩体」的对比图 —— 用来挑「GoodPrices」那个字。
 *
 * 为什么要有这个：字体是口味问题，列名字没用（"Archivo Narrow" 和
 * "Barlow Condensed" 光看名字分不出差在哪）。这里把几个候选真的下下来、
 * 内联成 base64、用站里那行真实的字排版，再截图。
 *
 * 候选都是 **OFL 开源**（SIL Open Font License）：免费、可商用、可嵌入、
 * 可改 —— 和上一轮那个 Blaze Type 的商业字体完全是两回事。
 *
 * 用法：node scripts/font-preview.mjs   → /tmp/font-preview.html + 截图
 */
import { writeFileSync } from 'node:fs';
import { UA } from '../src/core/http.mjs';

const FONTS = [
  { name: 'Archivo Narrow', q: 'Archivo+Narrow:wght@600;700' },
  { name: 'Oswald', q: 'Oswald:wght@500;600' },
  { name: 'Barlow Condensed', q: 'Barlow+Condensed:wght@600;700' },
  { name: 'Saira Semi Condensed', q: 'Saira+Semi+Condensed:wght@600;700' },
  { name: 'Fjalla One', q: 'Fjalla+One' },
  { name: 'Roboto Condensed', q: 'Roboto+Condensed:wght@700' },
];

/** 把 Google Fonts 的 CSS 拿回来，取 basic-latin 那一档的 woff2 */
async function faceOf(f) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${f.q}&display=swap`, { headers: { 'User-Agent': UA } })).text();
  const blocks = css.split('@font-face').slice(1);
  // 最后一块通常是 basic latin（unicode-range 覆盖 U+0000-00FF），前面的是各语言子集
  const latin = blocks.filter((b) => /unicode-range:\s*U\+0000-00FF/i.test(b));
  const pick = (latin.length ? latin : blocks).slice(-1)[0] || '';
  const url = (pick.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { name: f.name, b64: buf.toString('base64'), bytes: buf.length };
}

const got = [];
for (const f of FONTS) {
  try {
    const face = await faceOf(f);
    if (face) { got.push(face); console.log('  ✅ ' + f.name.padEnd(24) + (face.bytes / 1024).toFixed(1) + ' KB'); }
    else console.log('  ⚠️  ' + f.name + ' 没拿到 woff2');
  } catch (e) {
    console.log('  ❌ ' + f.name + '：' + e.message);
  }
}

const faces = got.map((g) => `@font-face{font-family:'P';src:url(data:font/woff2;base64,${g.b64}) format('woff2');font-weight:400 900;font-display:block}`).join('\n');
const rows = got.map((g, i) => `
  <div class="row">
    <div class="meta">${g.name}</div>
    <div class="word" style="font-family:'P${i}'">GoodPrices</div>
    <div class="sub" style="font-family:'P${i}'">优衣库捡漏榜 · 降 190 元</div>
  </div>`).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
${got.map((g, i) => `@font-face{font-family:'P${i}';src:url(data:font/woff2;base64,${g.b64}) format('woff2');font-weight:400 900;font-display:block}`).join('\n')}
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 32px; background: #fff; color: #000f17;
       font-family: "Helvetica Neue", Arial, sans-serif; }
h1 { font-size: 13px; font-weight: 400; letter-spacing: .12em; color: #6b7780; margin: 0 0 4px; }
.row { display: flex; align-items: baseline; gap: 20px; padding: 16px 0 14px; border-bottom: 1px solid #eef1f3; }
.meta { flex: none; width: 190px; font-size: 12px; color: #6b7780; }
.word { font-size: 30px; font-weight: 700; letter-spacing: .01em; color: #e20c18; line-height: 1.1; }
.sub  { font-size: 13px; color: #4a555e; }
.now .meta::after { content: " ← 现在这个"; color: #3643ba; }
</style></head><body>
<h1>「GoodPrices」候选字体（都是 OFL 开源，可商用、可嵌入）</h1>
<div class="row now">
  <div class="meta">系统字体（现在）</div>
  <div class="word" style="font-family:'Helvetica Neue',Arial,sans-serif">GoodPrices</div>
  <div class="sub">优衣库捡漏榜 · 降 190 元</div>
</div>
${rows}
</body></html>`;

writeFileSync('/tmp/font-preview.html', html);
console.log('\n  ✅ /tmp/font-preview.html（' + (html.length / 1024).toFixed(0) + ' KB，字体已内联）');
