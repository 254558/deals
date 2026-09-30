import { num, stamp } from '../lib/format.js';
import { META } from '../lib/site.js';

/**
 * 报头只有一行站点信息：不占首屏，紧跟其后的就是榜单 / 筛选页签。
 * 原来那排总账数字（在售降价 N 件 / 全部买下可省 ¥X / 降幅 ≥ 50% N 件）已经删了 ——
 * 它们的问题不是不准确，是对「这一件要不要买」没有任何帮助。
 *
 * 这一行里的每个词都来自 `META`，组件里没有一处站点判断：
 *
 *   META.label         站点名（优衣库 / 迪卡侬 · 中国官网）—— 两家的写法不一样，
 *                      所以连「· 中国官网」这个后缀也归数据，不在这里拼
 *   META.links         行尾那组入口（数组）：另一家的报告 + 尾货市集。核心拼好，两家一样；
 *                      没配就是空数组，一个都不渲染。
 *   META.showRecorded  是否显示「共记录 N 件」（迪卡侬有，优衣库没有）
 *
 * `recorded` 是数据库里的累计记录数，不是这一期榜上的条数 ——
 * 所以它和榜上实际有多少件会对不上，这是对的：前者说库里攒了多少，
 * 后者说这一期筛出来多少。（工具栏右端那句「显示全部 N 件」2026-09-30 撤了。）契约里 `payload.recorded` 就是为这一格准备的。
 */
export function Masthead({ recorded, generatedAt }) {
  // 行尾那组入口：另一家的报告 + 尾货市集（核心拼好的数组，见 report.mjs 的 buildPayload）。
  // 老的 meta.crossLink 还兼容着——万一有旧 payload 进来，别把入口弄没了。
  const links = META.links?.length ? META.links : META.crossLink ? [META.crossLink] : [];
  return (
    <header className="masthead">
      <div className="masthead__eyebrow">
        <span className="masthead__dot" />
        <span className="label">{META.label}</span>
        <span className="label">抓取于 {stamp(generatedAt)}</span>
        {META.showRecorded && <span className="label">共记录 {num(recorded)} 件</span>}
        {/* 行尾右对齐的入口：兄弟报告 + 尾货市集（靠 margin-left: auto 顶到行尾） */}
        {links.map((l) => (
          <a
            className="label masthead__cross"
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
