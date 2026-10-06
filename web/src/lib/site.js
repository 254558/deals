/**
 * 唯一的取数口：从 `window.__DEALS_DATA__` 里把 payload 拆成三块。
 *
 * 报告是**自包含单文件**（`file://` 双击就能看），所以数据不能 fetch，
 * 只能是另一个 `<script>` 内联进来的全局变量，再由同一份 IIFE bundle 读出来
 * —— 详见 docs/REPORT-CONTRACT.md 第一节。
 *
 * 合并前两个仓库各用各的全局变量名（各自带站点前缀，见契约第一节），
 * 合并后统一成 `__DEALS_DATA__` 这一个：一次构建只有**一个**站点的数据，
 * 「两份报告」靠的是构建两次、各带各的 payload，而不是一个页面里切两家。
 *
 * 这里只负责拆包，不做任何站点判断 —— 站点差异一律读 `META`（见下）。
 */
export const DATA = window.__DEALS_DATA__ ?? { deals: [] };

/** 站点描述符：文案、货币、列定义、开关的唯一来源（见契约第三节） */
export const META = DATA.meta ?? {};

/** 全部商品，未经筛选/排序/隐藏。App 里再按 localStorage 那两本账过一遍 */
export const DEALS = DATA.deals ?? [];

/**
 * 站点标识。它只做一件事：写进 `<html data-site>`，也就是 styles.css 里
 * `[data-site="…"]` 那些专有作用域的挂钩。
 *
 * **组件里不许拿站点名做版面判断** —— 契约第三节：`data-site` 是版面差异的唯一开关，
 * 而组件里的差异一律走 `META.features.*`。`DATA.site` 只在 main.js 里落一次
 * `<html data-site>`；任何 `site === 'uniqlo' ? … : …` 都是错的。
 */
// （原先这里还导出一个 SITE = DATA.site，全仓库没人引用，2026-09-30 删掉）
