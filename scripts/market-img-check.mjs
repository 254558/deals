import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:8788';
const dir = '/Users/zhangshuai/deals/reports/uniqlo/img';
const file = readdirSync(dir).filter((f) => f.endsWith('.jpg'))[0];
const src = readFileSync(`${dir}/${file}`);
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
console.log(`  源图 ${file}　${(src.length / 1024).toFixed(1)}KB　sha=${sha(src)}`);

const r = await fetch(BASE + '/api/listings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '图片往返测试', price: 1, contact: 'wx: t',
    image: 'data:image/jpeg;base64,' + src.toString('base64'),
  }),
});
const j = await r.json();
console.log('  发布:', JSON.stringify(j).slice(0, 80));

const got = new Uint8Array(await (await fetch(`${BASE}/api/img/${j.id}`)).arrayBuffer());
console.log(`  取回 ${(got.length / 1024).toFixed(1)}KB　sha=${sha(got)}`);
console.log(got.length === src.length && sha(got) === sha(src) ? '  ✅ 图片一个字都没变' : '  ❌ 图片对不上（长度或内容变了）');
process.exit(got.length === src.length && sha(got) === sha(src) ? 0 : 1);
