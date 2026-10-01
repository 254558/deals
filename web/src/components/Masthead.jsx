import { num } from '../lib/format.js';
import { META } from '../lib/site.js';

/**
 * 报头只有一行站点信息：不占首屏，紧跟其后的就是榜单 / 筛选页签。
 * 原来那排总账数字（在售降价 N 件 / 全部买下可省 ¥X / 降幅 ≥ 50% N 件）已经删了 ——
 * 它们的问题不是不准确，是对「这一件要不要买」没有任何帮助。
 *
 * 这一行里的每个词都来自 `META`，组件里没有一处站点判断：
 *
 * 报头的皮是**一套**（见 styles.css 的 .masthead 那段），不分站点——2026-10-01 之前两家各一套，
 * 换个页面导航栏就换个样子。
 *
 *   左上角那格       **固定写 GoodPrices**（2026-10-01 起）：它是这个站的名字，
 *                      四个页面（两份报告 + 市集 + 管理页）都一样，点它回首页（/ → 优衣库）。
 *                      页面自己的名字由 title、榜单小标题和 URL 说，不用报头再重复一遍。
 *                      `META.label`（优衣库/迪卡侬）仍然在 payload 里，只是报头不用它了。
 *   META.links         行尾那组入口（数组）：另一家的报告 + 尾货市集。核心拼好，两家一样；
 *                      没配就是空数组，一个都不渲染。
 *   META.showRecorded  是否显示「共记录 N 件」（迪卡侬有，优衣库没有）
 *
 * 「抓取于 2026/9/30 21:37」那一格 2026-10-01 删了：页面上多一行时间，对「这件要不要买」
 * 没有任何帮助，而且它每天都在变、看着像过期提示。数据层照记（`payload.generatedAt`），
 * 浏览器标签页标题里也还带着日期——翻书签时才知道这份是哪天的。
 *
 * `recorded` 是数据库里的累计记录数，不是这一期榜上的条数 ——
 * 所以它和榜上实际有多少件会对不上，这是对的：前者说库里攒了多少，
 * 后者说这一期筛出来多少。（工具栏右端那句「显示全部 N 件」2026-09-30 撤了。）契约里 `payload.recorded` 就是为这一格准备的。
 */
export function Masthead({ recorded }) {
  // 行尾那组入口：另一家的报告 + 尾货市集（核心拼好的数组，见 report.mjs 的 buildPayload）。
  // 老的 meta.crossLink 还兼容着——万一有旧 payload 进来，别把入口弄没了。
  const links = META.links?.length ? META.links : META.crossLink ? [META.crossLink] : [];
  return (
    <header className="masthead">
      <div className="masthead__eyebrow">
        <span className="masthead__dot" />
        <a className="masthead__text masthead__home" href="/" title="GoodPrices 首页（优衣库捡漏榜）">GoodPrices</a>
        {META.showRecorded && <span className="label">共记录 {num(recorded)} 件</span>}
        {/* 行尾右对齐的入口：兄弟报告 + 尾货市集（靠 margin-left: auto 顶到行尾） */}
        {links.map((l) => (
          <a
            className="masthead__text masthead__cross"
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            title={l.title}
          >
            {l.label}
          </a>
        ))}
      </div>
    </header>
  );
}
