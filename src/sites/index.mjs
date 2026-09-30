/**
 * 站点注册表。
 *
 * 一个站点适配器要提供什么（全部是可选的，除 id/label/sync 外）：
 *
 *   id / label / aliases      站点标识与命令行别名（u / deca / d…）
 *   sync({onPage,onTagDone})  抓取 → { fetched, products }，products 用**规范形状**
 *   findByCode(code)          按编号查单件（track 用），返回规范形状或 null
 *   parseCode(input)          从用户输入里抠编号（允许直接贴商品页地址）
 *   tableColumns[]            终端那张表的列定义（head/w/align/get/trunc）
 *   sizeVariant(url,size)     图片档位怎么写（两家的规则完全不同，见各自文件）
 *   imageSize                 存哪一档的图
 *   tags / report / copy      站点口味：标签文案、报告的 meta、终端提示语
 *   fonts                     要内嵌的中文字体；null = 走系统字体栈
 *   statsExtra[]              站点私有的统计行
 *   vercelProject             `deals <站点> deploy` 推到哪个 Vercel 项目
 *
 * 规范形状（适配器 → 核心）：
 *   { productCode, code, name, brand, sports, season, sizeRange, url,
 *     image, images[], tags[], extra{}, originPrice, price, monthlySales, inStock }
 * 核心负责把它写进历史库、缓图、组 payload —— 所以适配器里**不许**碰 SQL、
 * 不许拼 HTML、不许决定报告长什么样。
 */

import uniqlo from './uniqlo.mjs';
import decathlon from './decathlon.mjs';

export const SITES = [uniqlo, decathlon];

/**
 * Cloudflare Pages 的配置。
 *
 * 和 Vercel 那边不一样：Vercel 是**每站一个项目**（站点描述符里的 `vercelProject`），
 * Cloudflare 这边是**一个项目装两份报告**，各占一个子目录 —— 把整个 `reports/`
 * 目录发上去，得到 `<host>/uniqlo/` 与 `<host>/decathlon/`。
 * 所以项目名/域名属于「一次部署」，不属于某个站点，放在这里而不是站点描述符里。
 */
export const CLOUDFLARE = {
  project: 'deals-pinouts',
  // 正式入口用裸域（用户在阿里云给 @ 加了一条 CNAME 指过来）。
  // 另外两个是同一份部署的别名，一直有效，但**各自是一本独立的浏览器收藏账**
  // （localStorage 按 origin 隔离），所以对外只提这一个。
  host: 'https://goodprices.online',
  aliases: ['https://deals.goodprices.online', 'https://deals-pinouts.pages.dev'],
  pagesDev: 'https://deals-pinouts.pages.dev',
};

/**
 * 部署根目录（`/`）默认跳到哪个站点。
 *
 * 部署上去的是整个 `reports/`，两份报告各占一个子目录，所以根路径本来没有东西、
 * 打开就是 404。生成报告时会顺手在 `reports/` 里放一个落地页，把 `/` 送到这里
 * 声明的这一站（用户要的是「打开默认看优衣库」）。
 */
export const DEFAULT_SITE = 'uniqlo';

export const byId = (id) => SITES.find((s) => s.id === id) ?? null;

/** 'u' / 'uniql' / 'uniqlo' 都指向同一个站点；认不出来返回 null */
export function resolveSite(token) {
  const t = String(token ?? '').toLowerCase();
  return SITES.find((s) => s.id === t || s.aliases.includes(t)) ?? null;
}

/**
 * 命令行第一个位置参数可以是站点、也可以是 `all`（sync / report / deploy 支持全站）。
 * @returns {{sites: object[]}|{error: string}}
 */
export function resolveTargets(token) {
  if (token === 'all' || token === '*') return { sites: SITES };
  const site = resolveSite(token);
  if (!site) return { error: `没有「${token}」这个站点。可用：${SITES.map((s) => s.id).join(' / ')}，或 all` };
  return { sites: [site] };
}

export const siteList = () => SITES.map((s) => s.id).join(' / ');
