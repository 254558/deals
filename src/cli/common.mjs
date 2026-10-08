/**
 * 命令行那一层的**共享底座**：路径、参数、命令集。
 *
 * 2026-10-06 从 src/cli.mjs 里抽出来的（那个文件原本 878 行，什么都挤在一处）。
 * 这里只放「每个命令都要用」的东西：仓库路径、database 路径、报告路径、
 * 命令行开关的读法、命令名集合、以及把 argv 解析成「站点 + 命令 + 余下参数」的那一小段。
 * 具体命令各自住 src/cli/*.mjs。
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


// ⚠️ 这个文件在 src/cli/ 下，所以要多退一层才是仓库根（原来它在 src/ 下）。
// 2026-10-06 从 src/cli.mjs 搬过来时这里少写了一层，后果不小：
//   · node_modules 找不到 → 报告构建被 ensureBuild 挡下（说「依赖没装」）
//   · DB_PATH 指到 src/data/deals.db → list / stats 于是在读一个刚被创建的空库，
//     命令"成功"退出、却什么都没读到（所以那几条验证是看内容才发现的，光看退出码会漏）
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DB_PATH = join(ROOT, 'data', 'deals.db');

export const reportDir = (site) => join(ROOT, 'reports', site.id);

export const reportPath = (site) => join(reportDir(site), 'index.html');


// ---------- 参数 ----------

const cliArgs = process.argv.slice(2);

export const flag = (name, def) => {
  const i = cliArgs.indexOf(`--${name}`);
  return i >= 0 && cliArgs[i + 1] ? cliArgs[i + 1] : def;
};

export const has = (name) => cliArgs.includes(`--${name}`);


export const COMMANDS = new Set(['sync', 'list', 'track', 'report', 'stats', 'history', 'dev', 'deploy', 'sites', 'backup', 'alert', 'help', 'block', 'unblock', 'blocked']);


/** 一次只对一个站点的命令 */
export const SINGLE = new Set(['list', 'new', 'track', 'stats', 'history', 'dev', 'block', 'unblock', 'blocked']);

/** 可以 all 的命令 */
export const MULTI = new Set(['sync', 'report', 'deploy']);

/** 本站支持的部署目标（只有一个） */
export const DEPLOY_TARGETS = new Set(['cloudflare']);




/**
 * 位置参数有两种写法，都认：
 *   deals uniqlo list --min-rate 0.5      （站点在前）
 *   deals list --min-rate 0.5              （省掉站点，就是 all）
 * `--site uniqlo` 也认。
 */
export function parseInvocation() {
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
