/**
 * Cloudflare Pages 部署：正常走 wrangler，这条网络扛不住时自动改用「小批次」。
 *
 * ── 为什么需要这个模块 ────────────────────────────────────────────────
 *
 * `wrangler pages deploy` 会把待上传的文件**按 40MB 打包成几个请求**并发发出
 * （bundle 里那个编译进去的常量 `MAX_BUCKET_SIZE = 40 * 1024 * 1024`，
 * `BULK_UPLOAD_CONCURRENCY = 3`）。在这台机器上，这条链路（Clash Verge 的
 * TUN）传大请求体时会断流，实测：
 *
 *     1MB × 10 并发 → 10/10 成功
 *     2MB ×  3 并发 →  9/9 成功（三轮各 3 个）
 *     5MB × 10 并发 →  6/10
 *    13MB × 10 并发 →  5/10
 *    40MB ×  3 并发 →  2/3   ← wrangler 就是这个量级
 *
 * 报错是 `write EPIPE` / `ERR_HTTP2_STREAM_ERROR`（Node 的 fetch 走 HTTP/2）。
 * 同一个 13MB 请求体换成 `node:https`（HTTP/1.1）或 curl 都 100% 成功，
 * 所以不是网络彻底不通，是 HTTP/2 大请求体在这条路上不稳。
 * 结论：**用标准 wrangler 在这台机器上永远传不完**（每次都在 `Uploading... (0/N)` 挂掉，
 * 而且 `check-missing` 不会因为失败的上传而改变，重试不收敛）。
 *
 * ── 怎么办 ────────────────────────────────────────────────────────────
 *
 * 不改网络的前提下，唯一要改的就是那个 40MB：把 wrangler 的 bundle 复制一份、
 * 只把 `MAX_BUCKET_SIZE` 改成 2MB，用 node 直接跑这份副本。为什么是「复制一份到
 * 同目录」而不是别处：那个 bundle 里有 `require('blake3-wasm')` 这类裸模块引用，
 * 换个目录就解析不到依赖了，所以副本必须和原文件同目录、同扩展名（模块类型一致）。
 *
 * 顺序是「先试标准 wrangler，失败再上小批次」：网络正常的地方走原路，不背这个补丁；
 * 这里失败一次也就多花十几秒。补丁匹配不到（wrangler 换版本改了常量写法）会明确报错，
 * 不会悄悄用一个坏掉的副本。
 */

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

/** 每个上传请求装多少字节。实测这条链路上 2MB 稳、5MB 起就开始掉 */
const SMALL_BATCH_BYTES = 2 * 1024 * 1024;
const PATCHED_NAME = 'cli-small-batches.js';

/** 找 wrangler 的 bundle：本地装了就用本地的，否则用 npx 缓存里最新那份 */
export function findWranglerBundle(root) {
  const local = join(root, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
  if (existsSync(local)) return local;

  const cache = join(homedir(), '.npm', '_npx');
  if (!existsSync(cache)) return null;

  let best = null;
  let bestTime = 0;
  for (const dir of readdirSync(cache)) {
    const p = join(cache, dir, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
    if (!existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (t > bestTime) {
      bestTime = t;
      best = p;
    }
  }
  return best;
}

/**
 * 生成（或复用）改了批次大小的副本。
 * @returns {string|null} 副本路径；bundle 里找不到那个常量时返回 null
 */
export function smallBatchBundle(bundle) {
  const src = readFileSync(bundle, 'utf8');
  const patched = src.replace(
    /MAX_BUCKET_SIZE\s*=\s*40\s*\*\s*1024\s*\*\s*1024/g,
    `MAX_BUCKET_SIZE = ${SMALL_BATCH_BYTES}`
  );
  if (patched === src) return null; // 版本变了，别用坏副本

  const out = join(dirname(bundle), PATCHED_NAME);
  // 副本比源文件旧就重新生成一次（wrangler 升级后要跟上）
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(bundle).mtimeMs) return out;
  writeFileSync(out, patched, 'utf8');
  return out;
}

/**
 * 跑一次 `pages deploy`。
 * @param {object} opts
 * @param {string} opts.root 仓库根（`reports/` 在这里面）
 * @param {string} opts.project Pages 项目名
 * @param {string} [opts.bundle] 给定时直接用 `node <bundle>` 跑，否则 `npx wrangler@latest`
 * @returns {boolean} 是否成功
 */
export function pagesDeploy({ root, project, bundle = null }) {
  const args = ['pages', 'deploy', 'reports', '--project-name', project, '--branch', 'main', '--commit-dirty=true'];
  const [cmd, argv] = bundle ? [process.execPath, [bundle, ...args]] : ['npx', ['--yes', 'wrangler@latest', ...args]];
  console.log(`\n${cmd === 'npx' ? 'npx' : 'node'} ${[cmd === 'npx' ? 'wrangler@latest' : bundle, ...args].join(' ')}\n`);
  const res = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit' });
  return !res.error && res.status === 0;
}
