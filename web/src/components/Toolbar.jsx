import { num } from '../lib/format.js';
import { META } from '../lib/site.js';

/**
 * 视图开关。它和站点无关（两家都有大图 / 列表两个视图），所以直接写在这里；
 * 契约里也没有对应字段 —— `features` 那组开关管的是**内容**（角标、chips、
 * 标尺布局…），不是这两个按钮。
 */
const VIEWS = [
  { key: 'grid', label: '大图' },
  { key: 'table', label: '列表' },
];

/**
 * 筛选页签。
 *
 * 两家的页签不一样（优衣库：全部/限时特优/超值精选/待拔草；迪卡侬：全部/尾货/新品/待拔草），
 * 所以整组从 `META.filters` 读，组件里一个中文字都不写。
 * 匹配语义是固定的「标签成员」，`tracked` 除外（它是终端 track 进来的布尔位，
 * 不是标签）—— 这条规则两家一样，所以它是代码而不是数据。
 */
export function Toolbar({
  filter, onFilter, query, onQuery, counts, shown, total,
  hiddenCount, onRestoreHidden,
  view, onView, sort, asc, onSort, onDir,
}) {
  return (
    /* 三层，各管一件事：
       .toolbar      整页宽、粘住（粘性元素只能在自己父元素的盒子里活动，
                     所以外壳必须高过整页内容，不能是 .wrap）
       .wrap         居中 + 左右内衬
       .toolbar__row flex 排布 + 下边那条发丝线（放在这层，线才跟报头、表头一样内缩） */
    <div className="toolbar">
      <div className="wrap">
        <div className="toolbar__row">
          <div className="tabs" role="group" aria-label="筛选">
            {META.filters.map((f) => (
              <button
                key={f.key}
                className="tab"
                aria-pressed={filter === f.key}
                onClick={() => onFilter(f.key)}
              >
                {f.label}
                {/* 计数为 0 的页签不挂那个小数字：挂一个 0 只是噪音 */}
                {counts[f.key] > 0 && <span className="tab__n n">{num(counts[f.key])}</span>}
              </button>
            ))}
          </div>

          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={META.searchPlaceholder}
            aria-label={META.searchPlaceholder}
          />

          {/* 大图视图里没有表头可点，排序得有个独立入口；列表视图里也一并能用。
              排序下拉框的选项就是列表视图那几列，一份声明两处用 */}
          <div className="sortctl">
            <label className="sortctl__label" htmlFor="sortsel">
              排序
            </label>
            <select
              id="sortsel"
              className="sortctl__sel"
              value={sort}
              onChange={(e) => onSort(e.target.value)}
            >
              {META.columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              className="sortctl__dir"
              onClick={onDir}
              aria-label={asc ? '当前升序，点击改为降序' : '当前降序，点击改为升序'}
              title={asc ? '升序 ↑' : '降序 ↓'}
            >
              {asc ? '↑' : '↓'}
            </button>
          </div>

          <div className="viewtabs" role="group" aria-label="视图">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className="tab viewtab"
                aria-pressed={view === v.key}
                onClick={() => onView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <span className="toolbar__count">
            {shown === total ? `显示全部 ${num(total)} 件` : `筛出 ${num(shown)} / ${num(total)} 件`}
          </span>

          {/* 「不再出现」是个一键到底的动作，误点了得有地方回头，否则只能去清浏览器存储 */}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="hiddenctl"
              onClick={onRestoreHidden}
              title="把点过闭眼的商品全部放回榜上"
            >
              已隐藏 {num(hiddenCount)} 件 · 放回
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
