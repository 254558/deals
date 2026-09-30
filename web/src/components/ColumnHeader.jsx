import { META } from '../lib/site.js';

/**
 * 列表视图的列 = **表头 + 排序入口 + 行内单元格**，一份声明三处共用。
 *
 * 合并前这一份声明在两个仓库里各写了一遍，而且同名不同内容：优衣库尾列是
 * 月销（数字、紧凑写法），迪卡侬尾列是运动（纯文本）。现在它只写在 payload 的
 * `meta.columns` 里（契约第三节），组件照单渲染：
 *
 *   key     排序列名，同时也是 DealRow 取单元格数据的键
 *   label   表头文字与排序下拉框的选项文字
 *   align   'r' 右对齐（价格列）
 *   kind    DealRow 拿它决定画哪种格子：name / was / now / scale / cell
 *   format  'compact' 走月销的「万」写法，纯文本列不写
 *   headCls / cellCls  额外的样式钩子。窄屏下要整列撤掉的那两列就靠它
 *                      （优衣库的月销、迪卡侬的运动都挂在 1180/900 那两档）
 *
 * 组件里一处站点判断都没有：**换一个 payload，列就换一套**。
 */
export function ColumnHeader({ sort, asc, onSort }) {
  return (
    <div className="head" role="row">
      {/* 商品图那一列没有表头文字，放一个空的 columnheader 占位。
          它必须占住第一格：表头和数据行共用同一份 grid-template-columns，
          少了这一格，后面每列的文字都会左移一列 —— 而数据行里第一格确实是图，
          所以这一格不是「多出来的」，是把首格对齐到图片列上 */}
      <span role="columnheader" aria-label="商品图" />
      {META.columns.map((c) => {
        const active = sort === c.key;
        return (
          <div
            key={c.key}
            role="columnheader"
            // aria-sort 只对 role="columnheader" 生效，挂在 button 上等于没写，
            // 所以每个表头格是一个 columnheader，排序按钮放在里面
            aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
            className={`head__cell${c.align === 'r' ? ' head__cell--r' : ''}${c.headCls ? ` ${c.headCls}` : ''}`}
          >
            <button className="head__btn" onClick={() => onSort(c.key)}>
              {c.label}
              <span className="head__arrow" aria-hidden="true">
                {active ? (asc ? '↑' : '↓') : ''}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
