/**
 * 「双十一指南」那块内容的**组装**：人工整理的内容 + 机器每天能确定的事实。
 *
 * 三块拼起来（页面上的三种成色标注，就是按这三块的出处分的）：
 *
 *   ① 编辑层 —— `content/double11.json`（人工维护：时间表 / 领券入口 / 凑单规则 / 避坑 /
 *      **往年经验**）。这里只负责**读进来 + 校验**，不负责事实。页面上标「人工整理于 X 月 X 日」。
 *      「往年经验」那一块是官方口径还没公布时先顶上的参考（`reference`），页面上单独标
 *      「往年经验 · 未经核实」，**绝不混进官方说法里**。
 *   ② 抓取层 —— 生成报告时**探测一遍**那些官方入口能不能打开（不是抓内容，见下）。
 *      页面上标「今天可达」/「今天没抓到，点这里自己去查」。
 *   ③ 新鲜度 —— 价格库最后一次成功抓取是多久以前（口径与 `deals alert` 的断档判定
 *      共用同一个常量 STALE_HOURS，别让两处漂移）。
 *
 * ⚠️ 「等官方公布了就换成准确版」这件事**是人工改 JSON**，不是这边自动抓来的：
 *    报告能自动拿到的只有入口可达性（②）。别在页面上把这句话写成承诺
 *    —— wording 由 content/double11.json 的 `reference.headline` 控制。
 *
 * 另外有一块「今日实况」（在榜多少件打折 / 限时特优多少件 / 降得最狠的几件）**不在这里**
 * —— 那些数字前端从报告本来就带着的 `deals` 里现算即可，比塞进 payload 更省、也永不过期。
 *
 * ── 为什么只探测"可达性"、不去解析页面 ──
 * 2026-10-12 实测：京东搜索页返回的是「京东验证」拦截页，天猫 / 优衣库首页都是 JS 空壳
 * （6KB、正文里没有"限时特优/双十一/预售"任何一个词）。所以"抓券面额"这件事在这些站点上
 * 做不成 —— 与其写一个假装能抓到、实际永远返回空的解析器，不如老实只报"入口今天通不通"，
 * 券的档位继续走人工整理那一层。**这是刻意的边界，不是没做完。**
 *
 * ⚠️ 探测结果只说明**域名/入口页能打开**，不等于券还在发。页面上那句「以官方页为准」
 * 不能省 —— 别让一个 200 被读成"券还在"。
 */

import { readFileSync } from 'node:fs';
import { UA } from './http.mjs';
import { stats } from './db.mjs';

/**
 * 多久没抓到新数据就算「断档」。**与 src/cli.mjs 的 cmdAlert 共用这一个数**
 * （那边判要不要弹"数据断档了"的通知，这里判指南页要不要挂"数据可能不准"的提示）。
 */
export const STALE_HOURS = 36;

/** 探测单个入口的超时。比抓取用的 30 秒短得多 —— 报告生成不该被一个打不开的站点拖住。 */
const PROBE_TIMEOUT = 8_000;

/** 探测时带上真实浏览器 UA（这些站点前面都有 WAF，见 core/http.mjs） */
const PROBE_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' };

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * 读并校验人工整理的那份内容。
 *
 * 坏 JSON / 字段不全一律**返回 null 而不是抛**：报告该照常生成，指南那一页显示
 * 「内容没准备好」就行（用户 2026-10-12：抓不到就写清楚让用户自己去查 —— 同一个思路，
 * 内容层坏了也不该把整份报告带下去）。
 *
 * @returns {{ content: object|null, warn: string|null }}
 */
export function loadContent(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { content: null, warn: `指南内容读不到（${path}），这一页会显示"内容没准备好"` };
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch (err) {
    return { content: null, warn: `指南内容不是合法 JSON（${path}）：${err.message}` };
  }
  if (!c || typeof c !== 'object') return { content: null, warn: `指南内容不是一个对象（${path}）` };

  // 必备字段：缺了就当没准备好，别渲染出半页空洞的版面
  const missing = ['updatedAt', 'schedule', 'sources'].filter((k) => !c[k]);
  if (missing.length) return { content: null, warn: `指南内容缺字段：${missing.join('、')}` };
  if (!Array.isArray(c.schedule) || !c.schedule.length) return { content: null, warn: '指南内容的 schedule 是空的' };
  if (!Array.isArray(c.sources)) return { content: null, warn: '指南内容的 sources 不是数组' };

  // 逐条drop掉写残的，剩下的照常渲染（一条写错不该让整页没了）
  const schedule = c.schedule.filter((s) => s && isStr(s.when) && isStr(s.what));
  const sources = c.sources.filter((s) => s && isStr(s.name) && isStr(s.how));
  if (!schedule.length) return { content: null, warn: '指南内容的 schedule 里没有一条是完整的（至少要 when / what）' };

  return { content: { ...c, schedule, sources }, warn: null };
}

/**
 * 探测一个入口。**永不抛** —— 超时、DNS 没了、被 WAF 拦，都只是 ok:false。
 *
 * 只从响应里取一个 `<title>`（好让日志和页面能看出"打到了哪个页面"），不解析正文。
 */
async function probeOne(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: PROBE_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    const body = await res.text();
    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    // ok 只表示"这个 HTTP 请求成功了"，不代表券还在发（有些站点会拿 200 回一个验证页）
    return { ok: res.ok, status: res.status, title, ms: Date.now() - t0 };
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? `超时（${PROBE_TIMEOUT / 1000}s）` : String(err?.message || err);
    return { ok: false, status: 0, error: why.slice(0, 80), ms: Date.now() - t0 };
  }
}

/**
 * 并发探测所有入口，**同一个 URL 只打一次**（内容里淘宝那条和 88VIP 那条指向同一个域名）。
 * @returns {Map<string, object>} url → 探测结果
 */
async function probeAll(urls) {
  const uniq = [...new Set(urls)];
  const results = await Promise.all(uniq.map(probeOne));
  return new Map(uniq.map((u, i) => [u, results[i]]));
}

/** 价格库最后一次成功抓取到现在多久了（口径与 cmdAlert 一致：取 runs 表最后一行） */
function syncInfo(db, site, now) {
  const last = stats(db, site.id).lastRun?.finished_at || null;
  const hours = last ? (now.getTime() - new Date(last).getTime()) / 3_600_000 : Infinity;
  return {
    lastAt: last,
    hoursAgo: Number.isFinite(hours) ? Math.round(hours * 10) / 10 : null,
    stale: !(hours <= STALE_HOURS), // 没有记录（Infinity）也算断档，和 cmdAlert 一致
    staleHours: STALE_HOURS,
  };
}

/**
 * 组装 payload 里的 `guide` 块。
 *
 * @param {object} db   已打开的库（只用来读 runs 的抓取时间）
 * @param {object} site 站点描述符
 * @param {object} opts
 * @param {string} opts.contentPath 人工整理那份 JSON 的路径
 * @param {boolean} [opts.probe] 要不要联网探测入口。`deals dev` / 离线生成时传 false，
 *   那一趟每条入口的 probe 是 null，页面上显示「本次没探测」而不是假装失败。
 * @param {Date} [opts.now]
 * @returns {Promise<{ guide: object|null, warn: string|null }>}
 */
export async function buildGuide(db, site, { contentPath, probe = true, now = new Date() } = {}) {
  const { content, warn } = loadContent(contentPath);
  if (!content) return { guide: null, warn };

  let probed = new Map();
  if (probe && content.sources.length) {
    // 探测失败已经在 probeOne 里吃掉了，这里不会抛
    probed = await probeAll(content.sources.map((s) => s.url).filter(isStr));
  }

  const guide = {
    updatedAt: content.updatedAt,
    expiresAt: content.expiresAt ?? null,
    intro: content.intro ?? '',
    // 生成这一刻的量，页面拿它和读的人的时钟比，判"这份内容多久没更新了"
    generatedAt: now.toISOString(),
    probedAt: probe ? now.toISOString() : null,
    sync: syncInfo(db, site, now),
    // 倒计时**不在这里算**：报告可能是几天前生成的，用生成时刻算出来的"还有 3 天"到时候就是错的。
    // 只把 at 原样带过去，由页面按读者自己的时钟算（见 MineDouble11.vue）。
    schedule: content.schedule.map((s) => ({ when: s.when, at: s.at ?? null, what: s.what, todo: s.todo ?? '' })),
    timeNotes: Array.isArray(content.timeNotes) ? content.timeNotes : [],
    /**
     * 「往年经验」那一层：官方口径还没公布时先顶上用的参考建议。
     *
     * **可以为 null**（内容里没写 / 写空了）—— 页面据此不渲染那一整段，而不是渲染半页。
     * 这一层是**编辑内容**，不是抓来的：报告这边拿不到准确的档期与券面额
     * （理由见文件头那段实测），所以「等官方公布再换准确版」的换法就是人改这份 JSON。
     * 文案里不许把它写成"官方信息"——它标的是「往年经验 · 未经核实」。
     */
    reference: (() => {
      const r = content.reference;
      if (!r || !Array.isArray(r.items)) return null;
      const items = r.items.filter((x) => x && isStr(x.t) && isStr(x.d)).map((x) => ({ t: x.t, d: x.d }));
      if (!items.length) return null;
      return { headline: r.headline ?? '', items, note: r.note ?? '' };
    })(),
    sources: content.sources.map((s) => ({
      name: s.name,
      how: s.how,
      url: isStr(s.url) ? s.url : null,
      // null = 本次没探测（probe: false）；{ ok:false } = 探测了但没打通。两者页面上的说法不一样
      probe: isStr(s.url) && probe ? probed.get(s.url) ?? null : null,
    })),
    formula: content.formula ?? '',
    formulaTips: Array.isArray(content.formulaTips) ? content.formulaTips : [],
    stackOrder: Array.isArray(content.stackOrder) ? content.stackOrder : [],
    stackNote: content.stackNote ?? '',
    byCategory: Array.isArray(content.byCategory) ? content.byCategory : [],
    pitfalls: Array.isArray(content.pitfalls) ? content.pitfalls : [],
    summary: content.summary ?? '',
  };

  return { guide, warn: null };
}
