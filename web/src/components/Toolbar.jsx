import { META } from '../lib/site.js';

/**
 * 工具条：**只剩搜索框**。
 *
 * 2026-10-05 按用户要求把筛选页签整组删掉 —— 优衣库那套是 全部 / 限时特优 / 超值精选 /
 * 待拔草，迪卡侬那套是 全部 / 尾货 / 新品 / 待拔草，用户说「这些功能都不要了，只保留搜索框」。
 * 所以这里不再读 `META.filters`，props 里也没有 filter / onFilter / counts 了。
 *
 * 三层，各管一件事：
 *   .toolbar      整页宽、粘住（粘性元素只能在自己父元素的盒子里活动，
 *                 所以外壳必须高过整页内容，不能是 .wrap）
 *   .wrap         居中 + 左右内衬
 *   .toolbar__row flex 排布 + 下边那条发丝线（放在这层，线才跟报头、表头一样内缩）
 */
export function Toolbar({ query, onQuery }) {
  return (
    <div className="toolbar">
      <div className="wrap">
        <div className="toolbar__row">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={META.searchPlaceholder}
            aria-label={META.searchPlaceholder}
          />
        </div>
      </div>
    </div>
  );
}
