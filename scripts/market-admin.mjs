#!/usr/bin/env node
/**
 * 尾货市集的站长工具：看列表、下架、放回、看被举报的。
 *
 * 用法：
 *   node scripts/market-admin.mjs list              # 在售的（带举报数）
 *   node scripts/market-admin.mjs reported          # 被举报过的
 *   node scripts/market-admin.mjs hide <id>         # 下架
 *   node scripts/market-admin.mjs unhide <id>       # 放回
 *   node scripts/market-admin.mjs remove <id>       # 连图一起真删（慎用）
 *
 * 为什么不做成网页里的管理后台：那得往线上放一个管理密钥，多一个能被撞的门。
 * 走本机 wrangler（已经登录过）只有你自己能用，也不用给网站加任何权限。
 */
import { spawnSync } from 'node:child_process';

const DB = 'deals-market';
const [cmd, arg] = process.argv.slice(2);

function sql(statement) {
  const r = spawnSync(
    'npx',
    ['--yes', 'wrangler@latest', 'd1', 'execute', DB, '--remote', '--json', '--command', statement],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }
  );
  if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-8).join('\n') || 'wrangler 执行失败');
    process.exit(1);
  }
  const start = r.stdout.indexOf('[');
  const rows = JSON.parse(r.stdout.slice(start));
  return rows[0]?.results ?? [];
}

const pad = (s, n) => [...String(s ?? '')].slice(0, n).join('').padEnd(n);
const fmt = (iso) => String(iso || '').replace('T', ' ').slice(5, 16);

function list(where, title) {
  const rows = sql(
    `SELECT id, created_at, title, price, size, store, contact, reports, hidden
       FROM listings ${where} ORDER BY created_at DESC LIMIT 100`
  );
  if (!rows.length) return console.log(`\n  ${title}：空的\n`);
  console.log(`\n  ${title}（${rows.length} 件）\n`);
  console.log('  id                时间          价格    尺码    举报  状态  商品 / 店 / 联系方式');
  for (const r of rows) {
    console.log(
      `  ${pad(r.id, 17)} ${pad(fmt(r.created_at), 14)} ${pad('¥' + r.price, 7)} ${pad(r.size || '-', 7)} ${pad(r.reports, 5)} ${pad(r.hidden ? '已下架' : '在售', 6)} ${r.title}　${r.store || '-'}　${r.contact}`
    );
  }
  console.log('');
}

switch (cmd) {
  case 'list':
    list('WHERE hidden = 0', '在售');
    break;
  case 'reported':
    list('WHERE reports > 0', '被举报过的');
    break;
  case 'hide':
  case 'unhide': {
    if (!arg) { console.error('要给 id'); process.exit(1); }
    const n = sql(`UPDATE listings SET hidden = ${cmd === 'hide' ? 1 : 0} WHERE id = '${arg.replace(/'/g, '')}' RETURNING id`);
    console.log(n.length ? `\n  已${cmd === 'hide' ? '下架' : '放回'} ${arg}\n` : `\n  没找到 ${arg}\n`);
    break;
  }
  case 'remove': {
    if (!arg) { console.error('要给 id'); process.exit(1); }
    const id = arg.replace(/'/g, '');
    sql(`DELETE FROM listings WHERE id = '${id}'`);
    console.log(`\n  真删了 ${id}（连图一起没了）\n`);
    break;
  }
  default:
    console.log(`
  尾货市集站长工具

    node scripts/market-admin.mjs list           在售的
    node scripts/market-admin.mjs reported       被举报过的
    node scripts/market-admin.mjs hide <id>      下架
    node scripts/market-admin.mjs unhide <id>    放回
    node scripts/market-admin.mjs remove <id>    连图真删
`);
}
