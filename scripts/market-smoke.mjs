#!/usr/bin/env node
/**
 * 尾货市集的端到端冒烟：发布 / 校验 / 列表 / 图片 / 删除 / 举报 / 限速 / 静态文件。
 *
 * 先起一个本地服务（用的是本地 D1，不碰线上数据）：
 *   npx wrangler d1 execute deals-market --local --file=market/schema.sql
 *   npx wrangler pages dev reports --port 8788
 * 然后：
 *   node scripts/market-smoke.mjs                    # 打本地
 *   node scripts/market-smoke.mjs https://goodprices.online   # 打线上（会真发真删）
 *
 * 注意：每 IP 每 24 小时只能发 5 件，跑第二遍之前先把限速记录清掉：
 *   npx wrangler d1 execute deals-market --local --command "DELETE FROM posts"
 */
const BASE = process.argv[2] || 'http://localhost:8788';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// 1×1 的透明 PNG，够用来充当「图片」
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const get = async (path) => {
  const r = await fetch(BASE + path);
  return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), bytes: new Uint8Array(await r.arrayBuffer()) };
};

console.log('── 发布');
const bad1 = await post('/api/listings', { title: '一', price: 10, contact: 'wx: a', image: PNG });
ok('商品名太短被挡住', bad1.status === 400 && /太短/.test(bad1.body?.error || ''), bad1.body?.error);
const bad2 = await post('/api/listings', { title: '尾货衬衫', price: 0, contact: 'wx: a', image: PNG });
ok('价格没填对被挡住', bad2.status === 400, bad2.body?.error);
const bad3 = await post('/api/listings', { title: '尾货衬衫', price: 39, contact: '', image: PNG });
ok('没留联系方式被挡住', bad3.status === 400 && /联系方式/.test(bad3.body?.error || ''), bad3.body?.error);
const bad4 = await post('/api/listings', { title: '尾货衬衫', price: 39, contact: 'wx: a', image: 'data:image/gif;base64,R0lGOD' });
ok('非白名单图片格式被挡住', bad4.status === 400, bad4.body?.error);
const big = 'data:image/jpeg;base64,' + 'A'.repeat(700 * 1024);
const bad5 = await post('/api/listings', { title: '尾货衬衫', price: 39, contact: 'wx: a', image: big });
ok('图片超 400KB 被挡住', bad5.status === 400 && /太大/.test(bad5.body?.error || ''), bad5.body?.error);
const honey = await post('/api/listings', { title: '机器人', price: 1, contact: 'x', image: PNG, website: 'http://spam' });
ok('蜜罐字段命中时静默丢弃', honey.status === 200 && honey.body?.id === null);

const good = await post('/api/listings', {
  title: '  尾货   羊毛混纺  大衣 ', price: 299, size: 'M', store: '上海 · 南京西路店',
  contact: 'wx: goodprices', note: '包邮，吊牌还在', image: PNG,
});
ok('正常发布成功', good.status === 200 && !!good.body?.id, JSON.stringify(good.body).slice(0, 60));
const id = good.body?.id, token = good.body?.token;
ok('回了删除凭据', typeof token === 'string' && token.length >= 32);

console.log('\n── 列表');
const list = await (await fetch(BASE + '/api/listings')).json();
const item = list.items?.find((x) => x.id === id);
ok('列表里能看到', !!item);
ok('标题里的多余空白被压平', item?.title === '尾货 羊毛混纺 大衣', item?.title);
ok('价格与尺码在', item?.price === 299 && item?.size === 'M');
ok('联系方式直接给出来（用户选的那条路）', item?.contact === 'wx: goodprices');
ok('列表里不带图片数据（图片另走接口）', item && item.image_bytes === undefined);

console.log('\n── 图片');
const img = await get('/api/img/' + id);
ok('图片能取到', img.status === 200 && img.type === 'image/png', `${img.type} ${img.bytes.length}B`);
ok('图片带长缓存', (img.cache || '').includes('immutable'), img.cache);
const noimg = await get('/api/img/nonexistent');
ok('不存在的图片 404', noimg.status === 404);

console.log('\n── 删除');
const wrong = await post('/api/delete', { id, token: 'wrong-token' });
ok('凭据不对删不掉', wrong.status === 403, wrong.body?.error);
const del = await post('/api/delete', { id, token });
ok('凭据对就能删', del.status === 200 && del.body?.ok);
const after = await (await fetch(BASE + '/api/listings')).json();
ok('删完不在列表里', !after.items?.some((x) => x.id === id));
const del2 = await post('/api/delete', { id, token });
ok('重复删是幂等的（不会报错）', del2.status === 200);

console.log('\n── 举报');
const a = await post('/api/listings', { title: '待举报的商品', price: 9, contact: 'wx: a', image: PNG });
let last = null;
for (let i = 0; i < 5; i++) last = await post('/api/report', { id: a.body.id });
ok('第 5 次举报触发自动下架', last?.body?.hidden === true, JSON.stringify(last?.body));
const after2 = await (await fetch(BASE + '/api/listings')).json();
ok('自动下架后不在列表里', !after2.items?.some((x) => x.id === a.body.id));

console.log('\n── 限速（每 IP 24 小时 5 件）');
let blocked = null;
for (let i = 0; i < 6; i++) {
  blocked = await post('/api/listings', { title: `限速测试 ${i}`, price: 1, contact: 'wx: a', image: PNG });
  if (blocked.status === 429) break;
}
ok('发到第 6 件被限速', blocked?.status === 429, blocked?.body?.error);

console.log('\n── 静态文件不受影响');
const home = await fetch(BASE + '/');
ok('落地页还是 200', home.status === 200);
const rep = await fetch(BASE + '/uniqlo/');
ok('报告还是 200', rep.status === 200);

console.log(`\n  ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
