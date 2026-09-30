#!/usr/bin/env node
/**
 * deals —— 比价 / 捡漏命令行工具（优衣库 · 迪卡侬）
 *
 *   deals <站点> sync              抓取并记录历史（每天跑一次最好）
 *   deals <站点> list              捡漏榜
 *   deals <站点> new               只看这次新降价的
 *   deals <站点> track <编号>       盯一件还没打折的商品，记录它的上市价
 *   deals <站点> history <编号>     看一件商品的历史价格快照
 *   deals <站点> report            生成 HTML 报告并用浏览器打开
 *   deals <站点> stats             看看本地攒了多少数据
 *   deals <站点> dev               起 Vite 开发服务器调报告页面
 *   deals <站点> deploy            生成最新报告并推到 Vercel
 *   deals sites                    有哪些站点、各攒了多少
 *
 * 站点可以写 `all`（sync / report / deploy 支持一次做两家）：
 *
 *   deals all sync                 两家都抓一遍
 *
 * ── 合并说明 ──────────────────────────────────────────────────────────
 * 这个仓库是两个几乎同源的项目合起来的（优衣库 uniql / 迪卡侬 deca）。
 * 「两家都一样的」留在这一个文件 + src/core/ 里：「只有某家才这样」的
 * 全部收进 src/sites/<站点>.mjs。所以这里看不到一处 `if (站点 === …)`：
 * 表格列、提示语、报告文案、图片档位规则，都是从站点描述符里读的。
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync, symlinkSync, lstatSync, readlinkSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

import { C, pad, printTable, truncate } from './core/terminal.mjs';
import { openDb, saveSnapshot, listDeals, listTracked, listJustDropped, historyOf, startRun, finishRun, stats, discountRate } from './core/db.mjs';
import { buildPayload, writeData, ensureBuild, renderHtml } from './core/report.mjs';
import { ensureFontFiles, buildFontCss } from './core/fonts.mjs';
import { ensureImages } from './core/images.mjs';
import { findWranglerBundle, smallBatchBundle, pagesDeploy } from './core/cf-wrangler.mjs';
import { SITES, CLOUDFLARE, resolveTargets, siteList } from './sites/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'deals.db');
const reportDir = (site) => join(ROOT, 'reports', site.id);
const reportPath = (site) => join(reportDir(site), 'index.html');

/** 一个目录下所有文本文件拼成一个大字符串（只为收集字体要用到的字符） */
function readTree(dir, out = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = readTree(p, out);
    else if (/\.(jsx?|css)$/.test(e.name)) out += readFileSync(p, 'utf8');
  }
  return out;
}

// ---------- 参数 ----------

const cliArgs = process.argv.slice(2);
const flag = (name, def) => {
  const i = cliArgs.indexOf(`--${name}`);
  return i >= 0 && cliArgs[i + 1] ? cliArgs[i + 1] : def;
};
const has = (name) => cliArgs.includes(`--${name}`);

const COMMANDS = new Set(['sync', 'list', 'new', 'track', 'report', 'stats', 'history', 'dev', 'deploy', 'sites', 'backup', 'alert', 'help']);

/**
 * 这个项目里唯一**不可再生**的东西就是 data/deals.db：
 * 图片、字体、HTML 都能重新抓/重新生成，价格历史丢了就永远没有。
 * 而它开着 WAL（旁边有 -wal / -shm），**直接 cp 出来的副本可能是残缺的**，
 * 所以用 SQLite 官方的一致快照写法 `VACUUM INTO`。
 *
 * 本机那份备份挡不住硬盘挂掉，所以只要 iCloud Drive 在，就同时写一份进去
 * （零配置、自动同步到机器之外）。Dropbox 之类的同理，找到了也会写。
 */
const BACKUP_DIR = join(ROOT, 'data', 'backups');
const CLOUD_DIRS = [
  join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
  join(homedir(), 'Dropbox'),
].filter((d) => existsSync(d) && statSync(d).isDirectory());

function cmdBackup() {
  const keep = Number(flag('keep', 14));
  const db = openDb(DB_PATH);

  const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
  const name = `deals-${stamp}.db`;
  const targets = [BACKUP_DIR, ...CLOUD_DIRS.map((d) => join(d, 'deals-backups'))];

  console.log(C.bold('\n备份价格库'));
  const size = (statSync(DB_PATH).size / 1024 / 1024).toFixed(1);
  console.log(C.dim(`  源：${DB_PATH}（${size} MB，${orderCount(db)} 条价格快照）\n`));

  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    const out = join(dir, name);
    // 路径里的单引号要转义：SQL 字面量
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
    console.log(`  ${mb} MB  ${out}`);

    // 只留最近 keep 份。删除范围严格限定在这个目录里、且文件名必须完全长成
    // 我们自己生成的样子（`deals-<YYYY>-<MM>-<DD>-<HHMMSS>.db`）——
    // 正则写成 `\d{8}-\d{6}` 是错的：实际文件名里日期带横线，那样一条都匹配不上，
    // 于是「保留策略」会安静地失效、备份无限堆积（写完先测一遍就是这么发现的）。
    const olds = readdirSync(dir)
      .filter((f) => /^deals-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(f))
      .sort()
      .reverse()
      .slice(keep);
    for (const f of olds) {
      const p = join(dir, f);
      if (dirname(p) !== dir) continue; // 双保险：绝不动这个目录以外的东西
      unlinkSync(p);
    }
    if (olds.length) console.log(C.dim(`  （清掉 ${olds.length} 份旧的，保留最近 ${keep} 份）`));
  }

  if (CLOUD_DIRS.length === 0) {
    console.log(C.yellow('\n  注意：没找到 iCloud / Dropbox，备份只在这一块硬盘上，硬盘挂了就一起没了。'));
  }
  console.log();
}

const orderCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM price_history').get().n;

/** macOS 通知。launchd 那个任务跑在用户的图形会话里，所以能弹出来 */
function notify(title, body) {
  if (process.platform !== 'darwin') return;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawnSync('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`]);
}

/**
 * 每天跑完之后该不该吱一声。两类事情值得打断你：
 *
 *  1. **盯着的商品降价了**（`track` 的全部意义就在这一条）。判定直接查库，
 *     不去解析 `new` 的输出：`prev_price` 是上一次抓到的现价，比现在低就是降了。
 *  2. **数据不新鲜**（超过 36 小时没抓成功）。这台机器是笔记本，launchd 只在
 *     开机且登录时跑；万一抓取连续失败、或者你出差一周，历史就断档了——
 *     而断档这件事在看报告时是看不出来的，只会觉得「怎么最近没降价」。
 */
function cmdAlert() {
  const db = openDb(DB_PATH);
  const messages = [];

  for (const site of SITES) {
    const drops = db
      .prepare(`
      SELECT code, name, prev_price, last_price FROM products
      WHERE site = ? AND tracked = 1 AND prev_price IS NOT NULL AND last_price < prev_price
      ORDER BY (prev_price - last_price) DESC
    `)
      .all(site.id);
    for (const d of drops) {
      messages.push({
        title: `${site.label}：盯着的商品降价了`,
        body: `${d.name}　¥${d.prev_price} → ¥${d.last_price}`,
        log: `${site.id}  ${d.code}  ${d.name}  ¥${d.prev_price} → ¥${d.last_price}`,
      });
    }

    const last = stats(db, site.id).lastRun?.finished_at;
    const hours = last ? (Date.now() - new Date(last).getTime()) / 3_600_000 : Infinity;
    if (hours > 36) {
      const how = last ? `${Math.floor(hours / 24)} 天没抓到新数据了` : '还从来没抓成功过';
      messages.push({
        title: 'deals：数据断档了',
        body: `${site.label} ${how}`,
        log: `${site.id}  最后一次成功抓取：${last ? new Date(last).toLocaleString('zh-CN') : '无'}`,
      });
    }
  }

  if (messages.length === 0) {
    console.log(C.dim('\n没有需要提醒的：盯着的商品没降价，数据也是新的。\n'));
    return;
  }

  console.log(C.bold(`\n▍要提醒的 ${messages.length} 条`));
  for (const m of messages) {
    console.log(`  ${m.title}　${C.dim(m.body)}`);
    notify(m.title, m.body);
  }
  console.log();
}

/**
 * 位置参数有两种写法，都认：
 *   deals uniqlo list --min-rate 0.5      （站点在前）
 *   deals list --min-rate 0.5              （省掉站点，就是 all）
 * `--site uniqlo` 也认。
 */
function parseInvocation() {
  const args = [...cliArgs];
  const siteFlagIdx = args.indexOf('--site');
  let target = null;

  if (siteFlagIdx >= 0) {
    target = args[siteFlagIdx + 1] ?? null;
    args.splice(siteFlagIdx, 2);
  } else if (args[0] && !COMMANDS.has(args[0]) && !args[0].startsWith('-')) {
    target = args.shift();
  }

  const cmd = args[0] && COMMANDS.has(args[0]) ? args.shift() : 'help';
  return { target, cmd, rest: args };
}

/** 站点的商品 → 终端表格要的那种行（跟 listDeals 出来的行同形） */
const asRow = (p) => ({
  code: p.code,
  name: p.name,
  brand: p.brand,
  sports: p.sports,
  origin_price: p.originPrice,
  last_price: p.price,
  monthly_sales: p.monthlySales,
  tags: p.tags || [],
  rate: discountRate(p.originPrice, p.price),
});

// ---------- 命令 ----------

async function cmdSync(site) {
  const db = openDb(DB_PATH);
  const runId = startRun(db, site.id, 'sync');
  console.log(C.bold(`\n${site.copy.syncTitle}\n`));

  const clearLine = () => process.stdout.write('\r' + ' '.repeat(60) + '\r');

  const { fetched, products } = await site.sync({
    onPage: ({ label, page, have, total }) =>
      process.stdout.write(`\r  ${label ? `${label}：` : ''}${have}/${total}（第 ${page} 页）        `),
    onTagDone: ({ label, count }) => {
      clearLine();
      console.log(`  ${label}：${count} 件`);
    },
  });
  clearLine();

  const diff = saveSnapshot(db, site.id, products);
  finishRun(db, runId, { fetched, discounted: products.length });

  const copy = site.copy;
  console.log(`  ${C.dim('去重后')} ${products.length} 件在售特价商品`);
  console.log(
    `  ${C.green(copy.addedWord)} ${diff.added.length} 件　${C.red('又降价')} ${diff.dropped.length} 件　` +
      `${C.yellow(copy.raisedWord)} ${diff.raised.length} 件　${C.cyan(copy.permanentWord)} ${diff.permanent.length} 件\n`
  );

  if (diff.dropped.length) {
    console.log(C.bold(C.red(`▍${copy.dropped}`)));
    const rows = diff.dropped
      .map(asRow)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 15);
    printTable(site.tableColumns, rows);
    console.log();
  }
  if (diff.permanent.length) {
    console.log(C.bold(C.cyan(`▍${copy.permanent}`)));
    for (const p of diff.permanent.slice(0, 10))
      console.log(`  ${pad(p.code, site.tableColumns[0].w)} ${truncate(p.name, 30)}  原价 ¥${p.from} → ¥${p.originPrice}  现价 ¥${p.price}`);
    console.log();
  }
  if (diff.added.length && diff.added.length <= copy.addedLimit) {
    console.log(C.bold(C.green(`▍${copy.added}`)));
    for (const p of diff.added.slice(0, 15))
      console.log(
        `  ${pad(p.code, site.tableColumns[0].w)} ${truncate(p.name, 30)}  ¥${p.originPrice} → ¥${p.price}  ${C.dim(`-${Math.round(discountRate(p.originPrice, p.price) * 100)}%`)}`
      );
    console.log();
  }
  console.log(C.dim(`提示：跑 deals ${site.id} list 看完整捡漏榜，deals ${site.id} report 生成网页版。\n`));
}

function cmdList(site) {
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

function cmdNew(site) {
  const db = openDb(DB_PATH);
  const rows = listJustDropped(db, site.id);

  if (!rows.length) {
    console.log(C.dim(`\n最近一次抓取没有商品降价。跑 deals ${site.id} sync 更新数据。\n`));
    return;
  }
  const codeW = site.tableColumns[0].w;
  console.log(C.bold(`\n▍最近一次抓取新降价的 ${rows.length} 件商品\n`));
  for (const r of rows) {
    console.log(
      `  ${pad(r.code, codeW)} ${pad(truncate(r.name, 30), 32)} ` +
        `${C.dim(`¥${r.prev_price}`)} → ${C.bold(`¥${r.last_price}`)}  ` +
        `${C.red(`-${Math.round(r.rate * 100)}%`)}  ${C.dim(`省 ¥${r.origin_price - r.last_price}`)}`
    );
  }
  console.log();
}

async function cmdTrack(site, codeArg) {
  if (!codeArg) {
    console.error(`用法：deals ${site.id} track <商品编号>，${site.copy.trackUsage}`);
    process.exit(1);
  }
  const code = site.parseCode(codeArg);
  const db = openDb(DB_PATH);
  console.log(C.dim(`\n查询 ${code} …`));

  const p = await site.findByCode(code);
  if (!p) {
    console.error(`没找到编号为 ${code} 的商品，确认一下编号是否正确。`);
    process.exit(1);
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

async function cmdReport(site, { open = true, withImages = true, rebuild = false, withFont = true, crossLinkHref = null } = {}) {
  const db = openDb(DB_PATH);

  const build = ensureBuild(ROOT, { force: rebuild });
  if (!build.ok) {
    if (build.reason === 'missing-deps') {
      console.error(C.red('\n报告页面依赖 React，还没装。先跑一次：'));
      console.error(C.bold('  npm install\n'));
    } else {
      console.error(C.red('\n报告页面构建失败，看上面的 Vite 报错。\n'));
    }
    process.exit(1);
  }

  const outDir = reportDir(site);

  let images;
  if (withImages) {
    // 下图这一趟要 CDN 候选地址（remote: true）；下面渲染用的那趟就不带了
    const all = buildPayload(db, site, null, { remote: true }).deals;
    process.stdout.write(C.dim(`\n缓存商品图片（${all.length} 件）…`));
    const res = await ensureImages(all, join(outDir, 'img'), {
      size: site.imageSize,
      sizeVariant: site.sizeVariant,
      onProgress: ({ done, total }) => process.stdout.write(`\r缓存商品图片 ${done}/${total}…            `),
    });
    images = res.images;
    process.stdout.write(`\r${' '.repeat(48)}\r`);
    console.log(C.dim(`图片：新下载 ${res.downloaded} 张，已有缓存 ${res.cached} 张${res.failed ? `，失败 ${res.failed} 张` : ''}`));
    if (res.failed) {
      // 候选链全挂＝这个商品所有图在 CDN 上都没了，报告里会留白框
      console.log(C.yellow(`  ${res.failed} 张的候选图全部取不到，报告里这几件是空占位。`));
      for (const d of res.dead.slice(0, 5)) console.log(C.dim(`    ${d.code} ${truncate(d.name, 24)} 试了 ${d.tried} 张：${d.error}`));
      if (res.dead.length > 5) console.log(C.dim(`    …另外 ${res.dead.length - 5} 件`));
    }
  }

  const js = readFileSync(build.js, 'utf8');

  // 内嵌中文字体（只有声明了 fonts 的站点有）。按「页面真正会渲染到的字符」裁剪：
  // 数据里的商品名 + 整个前端包（UI 文案都在里面），这样不会漏字，也不用手工维护字符表。
  let fontCss = null;
  if (withFont && site.fonts) {
    const files = await ensureFontFiles(join(ROOT, 'data', 'fonts'), site.fonts, { onStatus: (m) => console.log(C.dim(`\n${m}`)) });
    if (files) {
      const payloadText = JSON.stringify(buildPayload(db, site, images, { crossLinkHref }));
      fontCss = await buildFontCss({ files, text: js + payloadText, family: site.fonts.family, notice: site.fonts.notice });
    } else console.log(C.yellow('\n字体下载失败，报告改用系统字体栈（版面不受影响）。'));
  }

  const payload = buildPayload(db, site, images, { fontNotice: fontCss ? site.fonts?.notice ?? null : null, crossLinkHref });
  writeFileSync(reportPath(site), renderHtml({ js, css: readFileSync(build.css, 'utf8'), fontCss, payload }), 'utf8');

  // 报告目录里放一份三行的 vercel.json（framework / installCommand / buildCommand 全置空）：
  // 这个目录里没有 package.json，Vercel 只该原样收下这些文件。旧的优衣库那份报告就是靠它
  // 避免被识别成 Vite 预设、在部署机上白跑一遍 vite build。生成器从不清 reports/ 目录，
  // 所以这份配置不会被下次生成冲掉；已存在就不覆盖。
  const vercelCfg = join(outDir, 'vercel.json');
  if (!existsSync(vercelCfg)) {
    writeFileSync(vercelCfg, JSON.stringify({ framework: null, installCommand: null, buildCommand: null }, null, 2) + '\n', 'utf8');
  }

  const size = (statSync(reportPath(site)).size / 1024 / 1024).toFixed(1);
  console.log(`\n报告已生成：${C.bold(reportPath(site))}`);
  console.log(
    C.dim(
      `  ${payload.deals.length} 件商品 · 单文件 ${size}MB · ` +
        (withImages ? '商品图在 reports/' + site.id + '/img/ · ' : '本次不含商品图（--no-images） · ') +
        (fontCss ? '已内嵌中文字体子集 · ' : '未内嵌字体 · ') +
        (build.built ? '本次重新构建了页面' : '页面无需重建')
    )
  );
  console.log();
  if (open) execFile('open', [reportPath(site)], () => {});

  const tracked = listTracked(db, site.id);
  if (tracked.length) {
    console.log(C.bold('▍待拔草'));
    for (const t of tracked)
      console.log(
        `  ${pad(t.code, site.tableColumns[0].w)} ${pad(truncate(t.name, 30), 32)} 上市价 ¥${t.origin_price}  现价 ${C.bold(`¥${t.last_price}`)}${t.rate > 0 ? C.red(`  -${Math.round(t.rate * 100)}%`) : ''}`
      );
    console.log();
  }
}

function cmdStats(site) {
  const db = openDb(DB_PATH);
  const s = stats(db, site.id, { extraStats: site.statsExtra });
  const hist = db.prepare('SELECT COUNT(*) AS n, MIN(observed_on) AS since FROM price_history WHERE site = ?').get(site.id);

  const extraLines = site.statsExtra.map((e) => `  ${e.label}      ${s.extras[e.tag]} 件\n`).join('');
  console.log(`
  ${C.bold(`${site.label} · 本地数据`)}
  累计记录商品      ${s.total} 件
  当前有折扣        ${s.discounted} 件
${extraLines}  手动关注          ${s.tracked} 件
  价格快照          ${hist.n} 条${hist.since ? C.dim(`（自 ${hist.since} 起）`) : ''}
  最近一次抓取      ${s.lastRun?.finished_at ? new Date(s.lastRun.finished_at).toLocaleString('zh-CN') : C.yellow(`还没抓过，先跑 deals ${site.id} sync`)}
  数据库            ${DB_PATH}

  ${C.dim(`价格快照攒得越久，「上市价」越准。建议每天跑一次 deals ${site.id} sync。`)}
`);
}

function cmdHistory(site, codeArg) {
  // 只读本地快照，**不**去接口核对：能查历史的多半是已经下架、或者早就不在
  // 特惠区里的商品——正是接口查不到、而本地还留着记录的那些
  const code = site.parseCode(codeArg);
  if (!codeArg) {
    console.error(`用法：deals ${site.id} history <商品编号>`);
    process.exit(1);
  }
  const rows = historyOf(openDb(DB_PATH), site.id, code);
  if (!rows.length) {
    console.error(`本地没有 ${code} 的价格快照。`);
    process.exit(1);
  }
  console.log(C.dim(`\n${code} 的价格快照（一天一条，价格取当天最低）\n`));
  console.table(rows);
}

async function cmdDev(site) {
  // 调页面用：把真实数据写进 web/public/data.js，然后起 Vite 开发服务器
  const db = openDb(DB_PATH);
  const deals = buildPayload(db, site, null, { remote: true }).deals;

  // 复用 report 缓存好的商品图，缺的也不去下载 —— 开发服务器只做预览
  const imgDir = join(reportDir(site), 'img');
  const { images } = await ensureImages(deals, imgDir, { size: site.imageSize, sizeVariant: site.sizeVariant, offline: true });

  // Vite 只从 web/public/ 提供静态资源，软链过去，省得复制上百 MB
  const link = join(ROOT, 'web', 'public', 'img');
  try {
    // existsSync 会跟随软链，指向坏目标的旧链接会被判为不存在，先清掉再建
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) !== imgDir) unlinkSync(link);
  } catch {}
  if (existsSync(imgDir) && !existsSync(link)) {
    try {
      symlinkSync(imgDir, link, 'dir');
    } catch {}
  }

  const dataPath = join(ROOT, 'web', 'public', 'data.js');
  writeData(buildPayload(db, site, images), dataPath);

  // 开发页也要看到真实字体，否则调出来的版式是用错的字量出来的。
  // 字符集取 web/src 全部源码 + 刚写的数据：组件文案和数据都在里面。
  let fontCss = null;
  if (site.fonts) {
    const files = await ensureFontFiles(join(ROOT, 'data', 'fonts'), site.fonts, { onStatus: (m) => console.log(C.dim(m)) });
    if (files) {
      fontCss = await buildFontCss({
        files,
        text: readTree(join(ROOT, 'web', 'src')) + readFileSync(dataPath, 'utf8') + site.report.pageTitle,
        family: site.fonts.family,
        notice: site.fonts.notice,
      });
    }
  }
  // 没有字体的站点也写一个空文件：开发页那份 <link> 是共用的，缺文件会 404
  writeFileSync(join(ROOT, 'web', 'public', 'font.css'), fontCss ?? '', 'utf8');

  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  if (!existsSync(vite)) {
    console.error(C.red('\n要先装依赖：npm install\n'));
    process.exit(1);
  }
  console.log(C.dim(`\n${site.label} 的数据已写入 web/public/data.js（含 ${images.size} 张已缓存商品图），启动开发服务器…\n`));
  spawnSync(vite, ['--open'], { cwd: ROOT, stdio: 'inherit' });
}

async function cmdDeployVercel(site) {
  console.log(C.dim(`\n先重新生成 ${site.label} 的报告…`));
  await cmdReport(site, { open: false });

  const dir = reportDir(site);
  const args = ['deploy', dir, '--project', site.vercelProject, '--prod', '--yes'];
  console.log(C.bold(`\nvercel ${args.join(' ')}\n`));
  const res = spawnSync('vercel', args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) {
    console.error(C.red(`\n部署失败：${res.error.message}`));
    console.error(C.dim('  要装 Vercel CLI 并先登录一次：npm i -g vercel && vercel login\n'));
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

/**
 * 两份报告互相指路的链接：Cloudflare 上它们是同一个域名的兄弟目录，
 * 所以用相对路径 `../<另一个站点>/` —— 换域名、换本地双击都对。
 */
const cfCrossLink = (site) => {
  const other = SITES.find((s) => s.id !== site.id);
  return other ? `../${other.id}/` : null;
};

/**
 * Cloudflare Pages。
 *
 * 和 Vercel 那边的关键差别：**一个项目装两份报告**。所以这个命令与「对哪个站点做」
 * 无关 —— 从哪一站触发都会把两份报告一起刷新，再把整个 `reports/` 目录发上去，
 * 得到 `<host>/uniqlo/` 与 `<host>/decathlon/`。
 *
 * 报告目录里那两个 `vercel.json` 会跟着一起传上去，当成普通静态文件放着（无害）；
 * wrangler 没有 exclude 之类的开关，不为它专门绕路。
 */
async function cmdDeployCloudflare() {
  const { project, host } = CLOUDFLARE;

  console.log(C.bold(`\nCloudflare Pages · 项目 ${project}`));
  console.log(C.dim(`  一个项目装两份：${host}/uniqlo/ 与 ${host}/decathlon/`));
  console.log(C.dim('  所以两份报告都会重新生成一遍，报头那个交叉入口改成同域的相对路径。\n'));

  for (const site of SITES) await cmdReport(site, { open: false, crossLinkHref: cfCrossLink(site) });

  // 第一次部署时项目还不存在，而 `pages deploy` 遇到不存在的项目会反过来问你一句
  // （非交互环境下就卡住了），所以先确保项目在。已经存在时这条会失败，属正常。
  const create = spawnSync('npx', ['--yes', 'wrangler@latest', 'pages', 'project', 'create', project, '--production-branch', 'main'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (create.status === 0) {
    console.log(C.dim(`  已创建 Pages 项目 ${project}（生产分支 main）`));
  } else if (!/already exists|existed/i.test(`${create.stdout || ''}${create.stderr || ''}`)) {
    console.error(C.red('\n创建 Pages 项目失败：'));
    console.error(C.dim(`${(create.stderr || create.stdout || '').trim().slice(0, 600)}\n`));
    process.exit(1);
  }

  // --commit-dirty=true：这个「工作区」不是 git 仓库的干净状态（报告是刚生成的），
  // 不让 wrangler 因为这点小事停下来问
  let ok = pagesDeploy({ root: ROOT, project });

  if (!ok) {
    // 标准 wrangler 按 40MB 一批发请求，这条网络扛不住（见 cf-wrangler.mjs 里的实测）。
    // 改成 2MB 一批的副本再跑一次：传得慢一点，但传得完。
    console.log(C.yellow('\n上传失败（大请求体在这条网络上会被掐断）。改用 2MB 小批次重试…'));
    const bundle = findWranglerBundle(ROOT);
    const small = bundle ? smallBatchBundle(bundle) : null;
    if (!small) {
      console.error(C.red('\n找不到可用的 wrangler，或者它的批次常量变了，没法打小批次补丁。'));
      console.error(C.dim('  先装一份 wrangler 再试：npm i -D wrangler\n'));
      process.exit(1);
    }
    ok = pagesDeploy({ root: ROOT, project, bundle: small });
  }

  if (!ok) {
    console.error(C.red('\n部署失败。'));
    console.error(C.dim('  没登录过或凭据过期的话先跑一次：npx wrangler login\n'));
    process.exit(1);
  }
  console.log(`\n已发布：${C.bold(`${host}/uniqlo/`)} 与 ${C.bold(`${host}/decathlon/`)}\n`);
}

function cmdSites() {
  const db = existsSync(DB_PATH) ? openDb(DB_PATH) : null;
  console.log(`\n${C.bold('可用站点')}\n`);
  for (const s of SITES) {
    let line = `  ${C.bold(s.id.padEnd(10))} ${s.label}`;
    if (db) {
      const st = stats(db, s.id);
      line += C.dim(`　已记录 ${st.total} 件 · 有折扣 ${st.discounted} 件` + (st.lastRun?.finished_at ? ` · 上次抓取 ${new Date(st.lastRun.finished_at).toLocaleString('zh-CN')}` : ' · 还没抓过'));
    }
    console.log(line);
    console.log(
      C.dim(
        `    ${s.aliases.join(' / ')}　图片档位 ${s.imageSize}${s.fonts ? '　内嵌中文字体' : ''}` +
          `　Vercel 项目 ${s.vercelProject}　Cloudflare ${CLOUDFLARE.project}/${s.id}/`
      )
    );
  }
  console.log(C.dim(`\n用法：deals <站点> sync|list|new|track|report|stats|history|dev|deploy，站点也可以写 all。\n`));
}

function cmdHelp(site) {
  const s = site ?? SITES[0];
  const id = site ? site.id : '<站点>';
  console.log(`
${C.bold('deals')} —— 比价与捡漏工具（${siteList()}）

  ${C.bold(`deals ${id} sync`)}              抓取商品并记录历史（每天跑一次最好）
  ${C.bold(`deals ${id} list`)}              捡漏榜
       --sort ${s.copy.sortHint}   排序方式（默认降幅）
       --min-rate 0.3                    只看降幅 ≥30% 的
       --limit 60                        显示条数
       --tag ${s.copy.tagHint}
       --tracked                         只看待拔草的商品
  ${C.bold(`deals ${id} new`)}               只看最近一次抓取里新降价的
  ${C.bold(`deals ${id} track <编号>`)}       盯一件商品，降价了在报告里标出来
  ${C.bold(`deals ${id} history <编号>`)}     看一件商品的价格快照，一天一条
  ${C.bold(`deals ${id} report`)}            生成 HTML 报告并打开浏览器
       --no-images                       不缓存商品图（更快，但报告里没图）
       --no-font                         不内嵌中文字体（用系统字体栈）
       --no-open                         只生成不打开
       --rebuild                         强制重新构建 React 页面
  ${C.bold(`deals ${id} stats`)}             本地数据概览
  ${C.bold(`deals ${id} dev`)}               起 Vite 开发服务器调报告页面
  ${C.bold(`deals ${id} deploy`)}            生成最新报告并推到 Vercel（每站一个项目）
       --target cloudflare               改推 Cloudflare Pages
                                          （一个项目装两份，与站点无关）

  ${C.bold('deals sites')}               有哪些站点、各攒了多少
  ${C.bold('deals all sync')}            两家一起抓
  ${C.bold('deals backup')}              把价格库做一份一致性快照（默认留最近 14 份）
        --keep 30                         改保留份数
                                          有 iCloud / Dropbox 就同时写一份进去
  ${C.bold('deals alert')}               盯着的商品降价了、或数据断档了，弹系统通知
                                          （每天的定时任务跑完会自己调它）

${site ? C.dim(s.copy.sourceNote) : C.dim('站点：' + SITES.map((x) => `${x.id}（${x.aliases.join('/')}）`).join('　'))}
`);
}

// ---------- 入口 ----------

const { target, cmd, rest } = parseInvocation();

/** 一次只对一个站点的命令 */
const SINGLE = new Set(['list', 'new', 'track', 'stats', 'history', 'dev']);
/** 可以 all 的命令 */
const MULTI = new Set(['sync', 'report', 'deploy']);

/** 部署目标。默认 Vercel（每站一个项目）；`--target cloudflare` 走一个 Pages 项目装两份 */
const DEPLOY_TARGETS = new Set(['vercel', 'cloudflare']);

try {
  if (cmd === 'help' && !target) {
    cmdHelp(null);
  } else if (cmd === 'sites') {
    cmdSites();
  } else if (cmd === 'backup') {
    cmdBackup(); // 与站点无关：一个库装两家，备份就是备份整个库
  } else if (cmd === 'alert') {
    cmdAlert(); // 同上，它自己遍历两家
  } else {
    if (!target) {
      if (SINGLE.has(cmd)) {
        console.error(C.red(`\n要指明站点：deals <${siteList()}> ${cmd}${rest.length ? ' ' + rest.join(' ') : ''}\n`));
        process.exit(1);
      }
      target = 'all'; // sync / report / deploy 省掉站点时默认两家都做
    }

    const resolved = resolveTargets(target);
    if (resolved.error) {
      console.error(C.red(`\n${resolved.error}\n`));
      process.exit(1);
    }
    const sites = resolved.sites;

    const deployTo = flag('target', 'vercel').toLowerCase();
    if (cmd === 'deploy' && !DEPLOY_TARGETS.has(deployTo)) {
      console.error(C.red(`\n没有「${deployTo}」这个部署目标。可用：${[...DEPLOY_TARGETS].join(' / ')}\n`));
      process.exit(1);
    }

    if (cmd === 'help') {
      cmdHelp(sites.length === 1 ? sites[0] : null);
    } else if (cmd === 'deploy' && deployTo === 'cloudflare') {
      // 与「对哪个站点做」无关：一个 Pages 项目装两份报告，所以这里不进站点循环
      await cmdDeployCloudflare();
    } else if (SINGLE.has(cmd) && sites.length > 1) {
      console.error(C.red(`\n${cmd} 一次只能对一个站点做，请指明：deals ${siteList()} ${cmd}\n`));
      process.exit(1);
    } else {
      for (const site of sites) {
        switch (cmd) {
          case 'sync': await cmdSync(site); break;
          case 'list': cmdList(site); break;
          case 'new': cmdNew(site); break;
          case 'track': await cmdTrack(site, rest[0] || flag('code')); break;
          case 'report':
            await cmdReport(site, {
              open: !has('no-open') && sites.length === 1, // 两家一起生成时不要连开两个窗口
              withImages: !has('no-images'),
              rebuild: has('rebuild'),
              withFont: !has('no-font'),
            });
            break;
          case 'stats': cmdStats(site); break;
          case 'history': cmdHistory(site, rest[0] || flag('code')); break;
          case 'dev': await cmdDev(site); break;
          case 'deploy': await cmdDeployVercel(site); break;
          default: cmdHelp(sites.length === 1 ? sites[0] : null);
        }
      }
    }
  }
} catch (err) {
  console.error(C.red(`\n出错：${err.message}\n`));
  if (process.env.DEALS_DEBUG) console.error(err);
  process.exit(1);
}
