import { META } from '../lib/site.js';

/**
 * 筛选页签。
 *
 * 两家的页签不一样（优衣库：全部/限时特优/超值精选/待拔草；迪卡侬：全部/尾货/新品/待拔草），
 * 所以整组从 `META.filters` 读，组件里一个中文字都不写。
 * 匹配语义是固定的「标签成员」，`tracked` 除外（它是终端 track 进来的布尔位，
 * 不是标签）—— 这条规则两家一样，所以它是代码而不是数据。
 */
export function Toolbar({
  filter, onFilter, query, onQuery, counts,
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
                {/* 页签只留名字，**不挂件数**：用户 2026-10-01 明确说「这些后面不要加数字，
                    我不关心这个」。计数照样算（`counts` 还在，留给 aria 与以后要用时取），
                    只是不往界面上摆。 */}
                {f.label}
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

        </div>
      </div>
    </div>
  );
}
