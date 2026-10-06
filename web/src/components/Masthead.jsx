import { useEffect, useRef } from 'react';
import { num } from '../lib/format.js';
import { META } from '../lib/site.js';

/**
 * 报头只有一行站点信息：不占首屏，紧跟其后的就是筛选页签。
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
 *                      页面自己的名字由 title 和 URL 说，不用报头再重复一遍。
 *                      `META.label`（优衣库/迪卡侬）仍然在 payload 里，只是报头不用它了。
 *   META.links         行尾那组入口（数组）：另一家的报告 + 有品。核心拼好，两家一样；
 *                      没配就是空数组，一个都不渲染。
 *                      它不走 META.links —— 那一组是「去看别人的」，会新开标签；
 *                      这条是「回自己的地盘」，同标签打开。市集页导航里也是这一项。
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
export function Masthead({ recorded = 0, onMine }) {
  // 报头自己量高度，写成 --nav-h：下面那条工具条也是粘性的，它的 top 得正好接在报头下沿。
  // 写死一个数会在窄屏/字体不同时错位，所以交给 ResizeObserver 一直盯着。
  const navRef = useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const set = () =>
      document.documentElement.style.setProperty('--nav-h', Math.ceil(el.getBoundingClientRect().height) + 'px');
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', set);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', set); };
  }, []);
  // 行尾那组入口：另一家的报告（核心拼好的数组，见 report.mjs 的 buildPayload）。
  // 老的 meta.crossLink 还兼容着——万一有旧 payload 进来，别把入口弄没了。
  const links = META.links?.length ? META.links : META.crossLink ? [META.crossLink] : [];
  return (
    <header className="masthead" ref={navRef}>
      <div className="wrap">
        <div className="masthead__eyebrow">
        <span className="masthead__dot" />
        <a className="masthead__text masthead__home" href="/" title="GoodPrices 首页（优衣库捡漏榜）">GoodPrices</a>
        {META.showRecorded && <span className="label">共记录 {num(recorded)} 件</span>}
        {/* 行尾右对齐的入口：另一家的报告（靠 margin-left: auto 顶到行尾） */}
        {/* 「我的」固定放在最右边。它和上面那组不一样：那组是「去看别人整理的」
            （另一家的报告），会新开标签；这一条是「回我自己的地盘」。
            2026-10-06：它原来指向独立的一页 /market/?mine=1，那页跟着市集删了，
            现在改成报告内的整屏视图（收藏 / 转移码）。 */}
        {onMine && (
          <button className="masthead__text masthead__cross" type="button" onClick={onMine}>我的</button>
        )}
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
      </div>
    </header>
  );
}
