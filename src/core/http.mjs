/**
 * 抓取这一层共用的三件小事：一个 UA、一个 `sleep`、一个「把 URL 变成字节」。
 *
 * 为什么值得单独一个文件：UA 原来在四个地方各抄了一份 —— `core/images.mjs`、
 * `core/fonts.mjs`、`sites/uniqlo.mjs`、`scripts/font-preview.mjs`，而且
 * images 那份已经悄悄变成了 Chrome/131，其余三份还是 120。同一个"浏览器"
 * 在四个地方有四个版本号，改一处永远改不全。退避用的 `sleep` 也是三份。
 *
 * UA 必须是**真实浏览器**的：站点前面挂着 WAF，会拦明显的爬虫 UA（见 uniqlo 的注释）。
 * 所以它归一，是所有请求共用一条 —— 想换浏览器版本，只改这里。
 *
 * 只放"和网络有关"的东西：截图脚本（scripts/shot.mjs 那几个）自己那个 `sleep`
 * 是等 Chrome 的，跟这里不是一回事，那些留在原地。
 */

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 退避用。`sleep(ms)` 之后继续。 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET 一个 URL，把响应体读成 Buffer。非 2xx、超时、内容太短都**抛错**，
 * 由调用方决定「换下一个候选」还是「同一张再试一次」。
 *
 * 错误信息里的 `HTTP <状态码>` 是调用方在用的约定：`/HTTP 4/` 表示
 * 「这东西不存在」，重试没意义（见 images.mjs 的 download）。
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout] 毫秒，默认 30 秒
 * @param {number} [opts.minBytes] 小于这个字节数就当成错误页 —— 中文那份字体是 8MB 起步，
 *   拉丁字体只有几十 KB，所以下限只能由调用方给（2026-10-06 加 Fjalla One 时踩到：
 *   40KB 被这条挡下过）
 * @param {Record<string,string>} [opts.headers] 额外请求头（会盖在 UA 之上）
 * @returns {Promise<Buffer>}
 */
export async function fetchBytes(url, { timeout = 30_000, minBytes = 100, headers } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`返回内容异常（${buf.length} 字节）`);
  return buf;
}
