import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Masthead } from './components/Masthead.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { RankBoard } from './components/RankBoard.jsx';
import { ColumnHeader } from './components/ColumnHeader.jsx';
import { DealRow } from './components/DealRow.jsx';
import { ProductCard } from './components/ProductCard.jsx';
import { useWatch } from './lib/watch.js';
import { DATA, DEALS, META } from './lib/site.js';

/** 页签 key → 中文，给空状态那句「这个筛选（…）下暂时没有商品」用 */
const filterLabel = (key) => META.filters.find((f) => f.key === key)?.label ?? '';

/** 空结果提示，两个视图共用。搜索的措辞里那一串「名称或编号…」来自
 *  `meta.searchLabel`：迪卡侬的编号旁边还有品牌可搜，优衣库只有名称和吊牌编号 */
function Empty({ query, filter, onReset }) {
  return (
    <div className="empty">
      <div className="empty__title">没有符合条件的商品</div>
      <div className="empty__hint">
        {query
          ? `没有「${META.searchLabel}」包含「${query}」的降价商品。`
          : `这个筛选（${filterLabel(filter)}）下暂时没有商品。`}
      </div>
      <button className="empty__reset" onClick={onReset}>
        清除筛选条件
      </button>
    </div>
  );
}

/**
 * 页签的匹配语义**固定是「标签成员」**，`tracked` 除外（契约第三节）。
 * 所以这里不写死四个键，而是照 `META.filters` 现造：
 *   优衣库  全部 / 限时特优(time_doptimal) / 超值精选(concessional_rate) / 待拔草
 *   迪卡侬  全部 / 尾货(endlife) / 新品(new_arrival) / 待拔草
 * `all` 是「全部都算」，它不是一个标签名，所以单独放行。
 */
function matcher(key) {
  if (key === 'all') return () => true;
  if (key === 'tracked') return (d) => d.tracked;
  return (d) => d.tags.includes(key);
}

/**
 * 中文列按 `localeCompare` 排，其余按数字。
 * 哪些列是文本列由 payload 的 `meta.textKeys` 给（优衣库只有 name，
 * 迪卡侬还多一个 sports），组件里不猜。
 */
function compare(key, asc) {
  const dir = asc ? 1 : -1;
  const textKeys = new Set(META.textKeys ?? []);
  if (textKeys.has(key)) {
    return (a, b) => dir * String(a[key] || '').localeCompare(String(b[key] || ''), 'zh');
  }
  return (a, b) => dir * ((a[key] ?? 0) - (b[key] ?? 0));
}

/**
 * 表头要粘在工具栏正下方，所以它的 top 必须等于「工具栏此刻的高度」。
 * 工具栏是 flex-wrap 的，换行数随宽度变（实测：1440/1280/1100 一档 57px，
 * 900/761 两行 109px，760/620/480 三行 157.5px，380 四行 226px），
 * 写死一个断点值总会有几档对不上，于是干脆让浏览器自己量。
 * 量的时机：挂载、工具栏尺寸变化、切换视图（两家的工具栏行数不同，同一份代码照样量得准）。
 */
function useStickyHeadOffset(view) {
  useEffect(() => {
    const tb = document.querySelector('.toolbar');
    if (!tb) return;
    const set = () =>
      document.documentElement.style.setProperty(
        '--headtop',
        `${Math.round(tb.getBoundingClientRect().height)}px`
      );
    set();
    const ro = new ResizeObserver(set);
    ro.observe(tb);
    return () => ro.disconnect();
  }, [view]);
}

/**
 * 页脚、空状态这些整块的文案都在 `META.foot` / `META` 里（契约第三节）：
 * 名词解释是 `foot.terms` 的数组（迪卡侬那份是空的，因为它的原价不是「上市价」
 * 这个概念，而是官网直接给的折扣价），数据来源是 `foot.source`，
 * 版面说明是 `foot.notes`（可能有多条），字体署名是单独的 `fontNotice`。
 * 组件只负责把数组摊开，一个字都不写死。
 */
export default function App() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('rate');
  const [asc, setAsc] = useState(false);
  // 默认大图浏览：捡漏要先看得见东西（衣服 / 装备），价格对比可以切到列表
  const [view, setView] = useState('grid');

  useStickyHeadOffset(view);

  const { watch, togglePick, hide, restoreHidden } = useWatch();

  /**
   * 点过闭眼（不再出现）的直接从榜上拿掉——榜单和计数都看不到它，所以先从源头上滤一遍；
   * 「待拔草」= 终端 `deals <站点> track` 进来的 ∪ 报告里收藏的 − 报告里取消的。
   *
   * id 是 localStorage 里存的那个键（契约第四、五节）：合并前两家各叫各的编号字段名，
   * payload 统一改名成 id、值原样沿用，所以两个旧报告里已经点过的收藏和隐藏，
   * 在新报告里还在。
   */
  const deals = useMemo(
    () =>
      DEALS.filter((d) => !watch.hidden.has(d.id)).map((d) => ({
        ...d,
        // 终端 track 是单向的（CLI 里还没有 untrack），报告里要取消它，
        // 得在 dropped 里记一笔才压得住，否则刷新又从数据库冒回来
        dbTracked: d.tracked,
        tracked: (d.tracked || watch.picks.has(d.id)) && !watch.dropped.has(d.id),
      })),
    [watch]
  );

  const pick = useCallback((d) => togglePick(d.id, d.dbTracked), [togglePick]);
  const hideDeal = useCallback((d) => hide(d.id), [hide]);

  /** 每个页签各挂一个计数（只算没被闭眼的那批） */
  const counts = useMemo(
    () => Object.fromEntries(META.filters.map((f) => [f.key, deals.filter(matcher(f.key)).length])),
    [deals]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    /**
     * 搜索认哪几个字段也是站点差异：迪卡侬的名称是「箭侧垫」这种，不认品牌就找不着。
     * 这件事契约里没有单独的开关，只能从 `searchLabel` 反推 ——
     * 那一行写的是「名称或编号」还是「名称、编号或品牌」（见最终汇报里的契约缺口）。
     */
    const brandSearchable = META.searchLabel.includes('品牌');
    const hay = (d) =>
      [d.name, d.code, brandSearchable ? d.brand : ''].filter(Boolean).join(' ').toLowerCase();
    return (
      deals
        .filter(matcher(filter))
        .filter((d) => !q || hay(d).includes(q))
        // 排序键就是 meta.columns 里的 key；降幅那一列比的是 payload 里的 rate（精确值），
        // 不是四舍五入后的整数百分比——三件都显示 -74% 时顺序仍由真实值决定
        .sort(compare(sort, asc))
    );
  }, [deals, filter, query, sort, asc]);

  function handleSort(key) {
    if (key === sort) setAsc((v) => !v);
    // 切到一个新列时：文本列升序读起来顺（拼音序），数字列降序才有意义（先看降得最狠的）
    else {
      setSort(key);
      setAsc((META.textKeys ?? []).includes(key));
    }
  }

  function reset() {
    setFilter('all');
    setQuery('');
  }

  return (
    <>
      <div className="wrap">
        <Masthead recorded={DATA.recorded ?? deals.length} generatedAt={DATA.generatedAt} />
      </div>

      {/* 榜单在整页最上面：报头之下、筛选页签之上，打开就先看见这一期哪儿在塌。
          它在粘性盒子外面，所以往下滚时它走掉、页签留在顶上。
          `features.rankBoard` 关掉的那一站（迪卡侬）一点也不渲染——
          它的首屏第一个元素就是筛选页签 */}
      {META.features.rankBoard && (
        <div className="wrap">
          <RankBoard deals={deals} />
        </div>
      )}

      <Toolbar
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        counts={counts}
        shown={rows.length}
        total={deals.length}
        hiddenCount={watch.hidden.size}
        onRestoreHidden={restoreHidden}
        view={view}
        onView={setView}
        sort={sort}
        asc={asc}
        onSort={handleSort}
        onDir={() => setAsc((v) => !v)}
      />

      {view === 'grid' ? (
        <div className="wrap">
          {rows.length === 0 ? (
            <Empty query={query} filter={filter} onReset={reset} />
          ) : (
            <div className="grid" role="list" aria-label={META.pageTitle}>
              {rows.map((deal, i) => (
                <ProductCard
                  key={deal.id}
                  deal={deal}
                  index={i}
                  onPick={() => pick(deal)}
                  onHide={() => hideDeal(deal)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 表头和数据行必须在同一个 rowgroup 里：一是 role="columnheader"/aria-sort
           需要有 table 祖先，二是 sticky 表头只有在父容器比它高时才能粘住。
           `.table` 那层只是 ARIA 容器（迪卡侬那份顺手给了它一点下边距），没有版面 */
        <div className="table" role="table" aria-label={META.pageTitle}>
          <div className="wrap" role="rowgroup">
            {rows.length > 0 && <ColumnHeader sort={sort} asc={asc} onSort={handleSort} />}

            {rows.length === 0 ? (
              <Empty query={query} filter={filter} onReset={reset} />
            ) : (
              rows.map((deal, i) => (
                <DealRow
                  key={deal.id}
                  deal={deal}
                  index={i}
                  onPick={() => pick(deal)}
                  onHide={() => hideDeal(deal)}
                />
              ))
            )}
          </div>
        </div>
      )}

      <div className="wrap">
        <footer className="foot">
          {/* 名词解释是 dl：dt 和 dd 必须**直接**是 dl 的孩子，
              否则 .foot dl 那套两列 grid 就接不到它们身上。
              迪卡侬那份的 terms 是空数组：旧迪卡侬报告本来就刻意不摆这一块名词解释，
              页脚只有数据来源那一行；合并后也没给它补，所以整个 dl 直接不画。
              （不是因为「上市价」这个概念在迪卡侬不成立 —— 两家的 launchPrice
              取的是同一件事：历次 list_price 的最高值） */}
          {META.foot.terms.length > 0 && (
            <dl>
              {META.foot.terms.map((t) => (
                <Fragment key={t.t}>
                  <dt>{t.t}</dt>
                  <dd>{t.d}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          <div>{META.foot.source}</div>
          {META.foot.notes.length > 0 && <div className="foot__note">{META.foot.notes.join(' ')}</div>}

          {/* 内嵌字体是一站的事（优衣库内嵌思源黑体子集，迪卡侬走系统字体栈），
              所以这条署名是 payload 里的 `fontNotice`，没有内嵌字体就是 null。
              授权署名不能省：那份子集是 Apache-2.0 的 */}
          {META.fontNotice && <div className="foot__note">{META.fontNotice}</div>}
        </footer>
      </div>
    </>
  );
}
