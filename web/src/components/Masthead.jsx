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
 *   META.crossLink     行尾另一个站点的入口。两家都定义了（两份报告互相有入口），
 *                      但仍然是可选的：契约里它允许为 null，值为 null 时这一格不渲染
 *   META.showRecorded  是否显示「共记录 N 件」（迪卡侬有，优衣库没有）
 *
 * `recorded` 是数据库里的累计记录数，不是这一期榜上的条数 ——
 * 所以它和榜上实际有多少件会对不上，这是对的：前者说库里攒了多少，
 * 后者说这一期筛出来多少。（工具栏右端那句「显示全部 N 件」2026-09-30 撤了。）契约里 `payload.recorded` 就是为这一格准备的。
 */
export function Masthead({ recorded, generatedAt }) {
  const cross = META.crossLink;
  return (
    <header className="masthead">
      <div className="masthead__eyebrow">
        <span className="masthead__dot" />
        <span className="label">{META.label}</span>
        <span className="label">抓取于 {stamp(generatedAt)}</span>
        {META.showRecorded && <span className="label">共记录 {num(recorded)} 件</span>}
        {/* 行尾右对齐的兄弟报告入口：两份报告互认是一家工具做的（靠 margin-left: auto 顶到行尾） */}
        {cross && (
          <a
            className="label masthead__cross"
            href={cross.href}
            target="_blank"
            rel="noreferrer"
            title={cross.title}
          >
            {cross.label}
          </a>
        )}
      </div>
    </header>
  );
}
