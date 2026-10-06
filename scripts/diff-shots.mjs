/**
 * 比对重构前后的两套截图（scripts/shot.mjs 拍的）。
 *
 *   node scripts/diff-shots.mjs before after
 *
 * 两件事：
 *   1. index.json 里那些**量出来的盒子**逐项比 —— 图片看不出 2px，数字能
 *   2. PNG 逐像素比 —— sharp 把两张缩到同尺寸后算平均通道差与「明显不同的像素占比」
 *
 * 判定：盒子全等、且每张图的差异像素占比 < 0.5% 才算过。
 * （0.5% 不是 0，是因为字体渲染、图片解码在两次截图之间本身会有极小抖动。）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';

const [a, b] = process.argv.slice(2);
const PA = `/tmp/shots-${a}`;
const PB = `/tmp/shots-${b}`;
if (!existsSync(PA) || !existsSync(PB)) {
  console.error(`❌ 找不到 /tmp/shots-${a} 或 /tmp/shots-${b}（先跑 node scripts/shot.mjs ${a} / ${b}）`);
  process.exit(1);
}

const A = JSON.parse(readFileSync(`${PA}/index.json`, 'utf8'));
const B = JSON.parse(readFileSync(`${PB}/index.json`, 'utf8'));

let bad = 0;

console.log('【一、量出来的盒子】');
for (const k of Object.keys(A.boxes)) {
  const x = JSON.stringify(A.boxes[k]);
  const y = JSON.stringify(B.boxes[k]);
  if (x === y) {
    console.log('  ✅ ' + k);
  } else {
    bad++;
    console.log('  ❌ ' + k);
    console.log('       before ' + x.slice(0, 150));
    console.log('       after  ' + y.slice(0, 150));
  }
}

console.log('\n【二、逐像素】');
const pngs = (dir) => readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const filesA = pngs(PA);
const filesB = pngs(PB);
const keys = Object.keys(A.boxes);
for (let ki = 0; ki < keys.length; ki++) {
  const k = keys[ki];
  const fa = `${PA}/${filesA[ki]}`;
  const fb = `${PB}/${filesB[ki]}`;
  if (!existsSync(fa) || !existsSync(fb)) { console.log('  ⚠️  缺图 ' + k); continue; }
  const meta = await sharp(fa).metadata();
  const W = meta.width;
  const H = meta.height;
  // 缩到同一尺寸再比（万一哪天视口变了，也不至于直接崩）
  const raw = async (p) => sharp(p).ensureAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer();
  const [ra, rb] = await Promise.all([raw(fa), raw(fb)]);
  let diff = 0;
  let sum = 0;
  const px = W * H;
  for (let i = 0; i < ra.length; i += 4) {
    const d = Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]);
    sum += d;
    if (d > 24) diff++; // 单通道平均差 > 8 才算「明显不同」
  }
  const pct = (diff / px) * 100;
  const avg = sum / px / 3;
  const okk = pct < 0.5;
  if (!okk) bad++;
  console.log(`  ${okk ? '✅' : '❌'} ${k.padEnd(24)} 明显不同的像素 ${pct.toFixed(3)}%　平均通道差 ${avg.toFixed(2)}　${W}×${H}`);
}

console.log('\n  ' + (bad ? `❌ 有 ${bad} 项不一致` : '✅ 全部一致'));
process.exit(bad ? 1 : 0);
