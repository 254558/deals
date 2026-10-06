/**
 * 查看 / 维护本地数据的命令：list（捡漏榜）、track（盯一件）、
 * stats（攒了多少）、history（一件的历史）、block / unblock / blocked（谢绝名单）。
 *
 * 2026-10-06 从 src/cli.mjs 里搬出来的（那个文件原本 878 行）。**只是搬家**，
 * 逻辑一行没动：连每段的注释都原样跟着走。搬到一起是因为它们都是
 * 「读本地数据库、打给人看」这一类，共用一个 `openDb(DB_PATH)` 的开头。
 */
import { join } from 'node:path';

import { DB_PATH, flag, has } from './common.mjs';
import { C, printTable } from '../core/terminal.mjs';
import {
  openDb,
  saveSnapshot,
  listDeals,
  historyOf,
  stats,
  discountRate,
  blockCode,
  unblockCode,
  listBlocked,
  resolveBlockTarget,
} from '../core/db.mjs';


export function cmdList(site) {
  const db = openDb(DB_PATH);
  const sort = flag('sort', 'rate');
  const limit = Number(flag('limit', 40));
  const minRate = Number(flag('min-rate', 0.3));
  const tag = flag('tag', '');

  const rows = listDeals(db, site.id, { sort, limit, minRate, trackedOnly: has('tracked'), tag });

  const label = { rate: '降幅', saving: '省钱金额', price: '现价', sales: '月销热度', newest: '新出现' }[sort] || '降幅';
  const tagName = tag ? site.tags[tag] || tag : '';
  console.log(C.bold(`\n${site.label}捡漏榜 · 按${label}排序 · 降幅 ≥${Math.round(minRate * 100)}%${tagName ? ` · ${tagName}` : ''}\n`));
  printTable(site.tableColumns, rows);
  console.log(
    C.dim(
      `\n共 ${rows.length} 条。--sort ${site.copy.sortHint}　--min-rate 0.3　--limit 60　--tag ${site.copy.tagHint}\n`
    )
  );
}


export async function cmdTrack(site, codeArg) {
  if (!codeArg) {
    throw new Error(`用法：deals ${site.id} track <商品编号>，${site.copy.trackUsage}`);
  }
  const code = site.parseCode(codeArg);
  const db = openDb(DB_PATH);
  console.log(C.dim(`\n查询 ${code} …`));

  const p = await site.findByCode(code);
  if (!p) {
    throw new Error(`没找到编号为 ${code} 的商品，确认一下编号是否正确。`);
  }

  const diff = saveSnapshot(db, site.id, [p], { tracked: true });
  // 手动盯的商品要标记 tracked = 1
  db.prepare('UPDATE products SET tracked = 1 WHERE site = ? AND product_code = ?').run(site.id, p.productCode);

  const off = discountRate(p.originPrice, p.price);
  const tagHit = site.copy.trackTags.find((t) => (p.tags || []).includes(t.tag));
  const tagLine = off <= 0 || !tagHit ? '' : `  标签         ${tagHit.text}\n`;
  const cur = site.report.currency.sym;

  console.log(`
  ${C.bold(p.name)}   ${C.dim(`${p.code}${p.season ? ' · ' + p.season : ''}${p.brand ? ' · ' + p.brand : ''}${p.sports ? ' · ' + p.sports : ''}`)}
  ${C.dim(p.url)}
  上市价/原价  ${C.dim(cur + p.originPrice)}
  当前价       ${C.bold(cur + p.price)}${off > 0 ? C.red(`  （已降 ${Math.round(off * 100)}%，省 ${cur}${p.originPrice - p.price}）`) : C.dim('  （暂无折扣，降价后这里会显示）')}
${tagLine}  ${diff.added.length ? C.green('已加入关注列表。') : C.dim('已在本地记录中，数据已更新。')}
`);
  console.log(C.dim(`  以后用 deals ${site.id} list --tracked 只看待拔草的商品，或 deals ${site.id} report 在网页里看。\n`));
}


/**
 * 谢绝名单：按**吊牌号**屏蔽一个款。
 *
 * 和报告里那个闭眼的区别：闭眼只能写那台浏览器的 localStorage，换设备、换域名
 * （goodprices.online 与 deals-pinouts.pages.dev 是两个 origin）、清缓存就都不作数；
 * 名单进了库，生成报告时直接不发出去，哪儿都看不到。
 */
export function cmdBlock(site, arg) {
  if (!arg) {
    throw new Error(
      `用法：deals ${site.id} block <吊牌号 | 商品编号 | 商品名>。进名单的款在报告里永久不出现。`
    );
  }
  const db = openDb(DB_PATH);
  const r = resolveBlockTarget(db, site.id, arg);

  if (!r.ok && r.reason === 'notfound') {
    throw new Error(`没找到「${arg}」。可以给吊牌号（如 488089）、商品编号（如 u0000000072656）或商品名的一部分。`);
  }
  if (!r.ok && r.reason === 'ambiguous') {
    console.log(C.yellow(`\n「${arg}」命中 ${r.candidates.length} 个款，换个更准的名字、或直接给吊牌号：\n`));
    for (const c of r.candidates.slice(0, 12)) {
      console.log(`  ${c.code}  ${c.name}${c.n > 1 ? C.dim(`　（${c.n} 个颜色）`) : ''}`);
    }
    if (r.candidates.length > 12) console.log(C.dim(`  …另外 ${r.candidates.length - 12} 个`));
    console.log();
    throw new Error('名字有歧义，什么都没改。');
  }

  blockCode(db, site.id, r.code, r.name);
  console.log(`
  ${C.bold(r.name || r.code)}${r.name ? '  ' + C.dim(r.code) : ''}${r.ids.length > 1 ? C.dim(`　（这个款有 ${r.ids.length} 个颜色，一起屏蔽）`) : ''}
  ${C.green('已加入谢绝名单')}——生成报告时直接不发出去，换设备、换域名、清缓存都看不到。
  ${C.dim(`想让它回来：deals ${site.id} unblock ${r.code}`)}
`);
}


/** 从谢绝名单里去掉一个款 */
export function cmdUnblock(site, arg) {
  if (!arg) throw new Error(`用法：deals ${site.id} unblock <吊牌号>`);
  const db = openDb(DB_PATH);
  const q = String(arg).trim();
  let n = unblockCode(db, site.id, q);

  // 也允许给商品编号或名字：解析出吊牌号再删
  if (!n) {
    const r = resolveBlockTarget(db, site.id, q);
    if (r.ok) n = unblockCode(db, site.id, r.code);
  }
  if (!n) {
    const list = listBlocked(db, site.id);
    if (!list.length) throw new Error(`${site.label} 的谢绝名单是空的，没有 ${q} 可删。`);
    console.log(C.yellow(`\n名单里没有 ${q}。现在名单上是：\n`));
    for (const b of list.slice(0, 20)) console.log(`  ${b.code}  ${b.name || ''}`);
    if (list.length > 20) console.log(C.dim(`  …另外 ${list.length - 20} 个`));
    console.log();
    throw new Error('什么都没改。');
  }
  console.log(`\n  已从谢绝名单里去掉 ${q}，下次生成报告它就回来了。\n`);
}


/** 列出现在屏蔽了哪些款 */
export function cmdBlocked(site) {
  const db = openDb(DB_PATH);
  const list = listBlocked(db, site.id);
  if (!list.length) {
    console.log(C.dim(`\n  ${site.label} 的谢绝名单是空的。加一个：deals ${site.id} block <吊牌号>\n`));
    return;
  }
  console.log(`\n  ${C.bold(`${site.label} 的谢绝名单`)}　${list.length} 个款。这些不会出现在报告里：\n`);
  for (const b of list) {
    console.log(`  ${b.code}  ${b.name || C.dim('（库里没有这个名字）')}　${C.dim((b.blocked_at || '').slice(0, 10))}`);
  }
  console.log(C.dim(`\n  去掉一个：deals ${site.id} unblock <吊牌号>\n`));
}


export function cmdStats(site) {
  const db = openDb(DB_PATH);
  const s = stats(db, site.id, { extraStats: site.statsExtra });
  const hist = db.prepare('SELECT COUNT(*) AS n, MIN(observed_on) AS since FROM price_history WHERE site = ?').get(site.id);

  const extraLines = site.statsExtra.map((e) => `  ${e.label}      ${s.extras[e.tag]} 件\n`).join('');
  // 「已不在特价」在报告里是**不说的**（用户要的是：榜上只剩现在真在卖的），
  // 但终端这边要能看见——不然你会以为商品凭空消失了。
  const goneLine = `  已不在特价        ${s.gone || 0} 件${s.missing_once ? C.dim(`（另有 ${s.missing_once} 件本轮没见到）`) : ''}\n`;
  const blockedLine = `  谢绝名单          ${s.blocked || 0} 个款\n`;
  console.log(`
  ${C.bold(`${site.label} · 本地数据`)}
  累计记录商品      ${s.total} 件
  当前有折扣        ${s.discounted} 件
${goneLine}${blockedLine}${extraLines}  手动关注          ${s.tracked} 件
  价格快照          ${hist.n} 条${hist.since ? C.dim(`（自 ${hist.since} 起）`) : ''}
  最近一次抓取      ${s.lastRun?.finished_at ? new Date(s.lastRun.finished_at).toLocaleString('zh-CN') : C.yellow(`还没抓过，先跑 deals ${site.id} sync`)}
  数据库            ${DB_PATH}

  ${C.dim(`价格快照攒得越久，「上市价」越准。建议每天跑一次 deals ${site.id} sync。`)}
`);
}


export function cmdHistory(site, codeArg) {
  // 只读本地快照，**不**去接口核对：能查历史的多半是已经下架、或者早就不在
  // 特惠区里的商品——正是接口查不到、而本地还留着记录的那些
  const code = site.parseCode(codeArg);
  if (!codeArg) {
    throw new Error(`用法：deals ${site.id} history <商品编号>`);
  }
  const rows = historyOf(openDb(DB_PATH), site.id, code);
  if (!rows.length) {
    throw new Error(`本地没有 ${code} 的价格快照`);
  }
  console.log(C.dim(`\n${code} 的价格快照（一天一条，价格取当天最低）\n`));
  console.table(rows);
}
