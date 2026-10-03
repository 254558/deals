/**
 * 对账（走生产路径）：用适配器自己的 sync() 抓一遍实时数据，
 * 和库里存着的 size_codes 比 —— 量的是「我们的快照有多旧」。
 */
import { DatabaseSync } from 'node:sqlite';
import site from '../src/sites/uniqlo.mjs';

console.log('  正在用适配器抓实时数据（约 1 分钟）…');
let pages = 0;
const result = await site.sync({ onPage: () => { pages++; if (pages % 5 === 0) process.stdout.write(' 已抓 ' + pages + ' 页\r'); } });
const live = result.products;
console.log('  抓到 ' + live.length + ' 件（' + pages + ' 页）        ');

const db = new DatabaseSync('/Users/zhangshuai/deals/data/deals.db');
const stored = new Map(
  db.prepare("SELECT product_code, size_codes FROM products WHERE site = 'uniqlo' AND size_codes IS NOT NULL AND size_codes != '[]'")
    .all()
    .map((r) => [r.product_code, r.size_codes])
);
db.close();

let same = 0, diff = 0, onlyLive = 0;
const samples = [];
for (const p of live) {
  const mine = stored.get(p.productCode);
  const now = JSON.stringify((p.sizeCodes || []).slice().sort());
  if (!mine) { onlyLive++; continue; }
  const was = JSON.stringify(JSON.parse(mine).slice().sort());
  if (was === now) same++;
  else {
    diff++;
    if (samples.length < 12) samples.push({ code: p.productCode, name: p.name.slice(0, 16), was: JSON.parse(mine), now: p.sizeCodes || [] });
  }
}

console.log('\n  对得上的（库里 == 现在）：' + same);
console.log('  对不上的：' + diff);
console.log('  只在实时结果里、库里没有的：' + onlyLive + '（新商品，正常）\n');
if (samples.length) {
  console.log('  不一致的样例：');
  for (const s of samples) {
    console.log('    ' + s.code + '  ' + s.name.padEnd(18) + ' 库里[' + s.was.join(' ') + ']  现在[' + s.now.join(' ') + ']');
  }
}
const pct = same + diff ? Math.round((diff / (same + diff)) * 100) : 0;
console.log('\n  不一致占比：' + pct + '%');
