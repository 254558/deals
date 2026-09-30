import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Masthead } from './components/Masthead.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { RankBoard } from './components/RankBoard.jsx';
import { ProductCard } from './components/ProductCard.jsx';
import { num } from './lib/format.js';
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
 * 首屏只渲染前 INITIAL 件，往下滑到哨兵再一批一批补上（无限滚动）。
 *
 * 为什么需要：报告是自包含单文件，数据全在内存里，但**卡片是整批建的**。
 * 手机上实测（390 宽 + 4 倍 CPU 降速，2026-09-30）：
 *
 *   优衣库 877 件 → DOM 24,705 个节点，主线程长任务合计 1250ms
 *   迪卡侬 1307 件 → DOM 40,916 个节点，长任务合计 1515ms
 *
 * 而图片本来就是懒加载的（首屏只请求 3～4 张），网络也不是瓶颈（gzip 后
 * 377KB / 124KB）——慢的是**一次性建出几万个 DOM 节点**。本地双击打开（无网络）
 * 测得的长任务时间和线上几乎一样，正好说明这一点。
 *
 * 每批 10 件是用户指定的。桌面屏幕高，10 件填不满一屏，哨兵会连着触发几次
 * ——这不是问题：每次只多建 10 张卡片，比一次建 1300 张便宜得多。`rootMargin`
 * 给 800px，意思是「还没滑到底就先把下一批准备好」，滚起来才是连续的。
 */
const INITIAL = 10;
const STEP = 10;

/**
 * @param {number} total 当前筛选/搜索/排序之后的总数
 * @param {string} resetKey 这个值一变就回到第一批（筛选、搜索、排序、视图）
 */
function useIncremental(total, resetKey) {
  const [visible, setVisible] = useState(INITIAL);
  const sentinelRef = useRef(null);

  const grow = useCallback(() => {
    // 只增不减、且封顶：哨兵停留可见时会被反复回调，setVisible 拿到同一个值
    // 就不再触发重渲染，天然收敛
    setVisible((v) => Math.min(v + STEP, total));
  }, [total]);

  // 换了筛选/搜索/排序就从头看：回到第一批，并滚回顶部——否则你还停在
  // 「上一批结果」的滚动位置上，而列表已经换人了
  const mounted = useRef(false);
  useEffect(() => {
    setVisible(INITIAL);
    // 挂载时不要强制回顶：浏览器自己会恢复上次的滚动位置
    if (mounted.current) window.scrollTo(0, 0);
    mounted.current = true;
  }, [resetKey]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) grow();
      },
      // 提前 800px 就补——不等到真看见底，滚起来才是连续的
      { rootMargin: '800px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [grow, total]);

  /**
   * 兜底：直接跳到页面最底部时，哨兵可能被**一步跨过去**。
   *
   * 哨兵在列表末尾，而列表后面还有页脚（名词解释、数据来源，手机上七八百像素高）。
   * 拖滚动条到底、按 End、或者猛甩一下，视口会一下落在页脚之后——此时哨兵在视口
   * **上方**，IntersectionObserver 的 800px 提前量也够不着，于是它停在那儿不再往下补
   * （实测踩到；那行小字当时还写着「已显示 10 / 878」，现在只写「继续下滑加载更多」）。
   * 所以再加一条：离**文档**底部不足 400px 就补一批。
   *
   * 这条会不会失控？不会——前提是**关掉了滚动锚定**（`html { overflow-anchor: none }`，
   * 见 styles.css）。锚定开着的话，补完内容浏览器会把视口重新钉回底部，条件继续成立，
   * 实测一次「直达底部」连补 12 批（10 → 130 张）。关掉之后，补进来的新卡片会直接
   * 落到视口里，人也就离开底部了，条件自然不成立。这一条链路上三个东西缺一不可：
   * 哨兵管「滑到附近就提前补」，这一条管「一步跳到最底也补」，`overflow-anchor` 管
   * 「补完别把人钉在原地」。
   */
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      if (doc.scrollHeight - (window.scrollY + window.innerHeight) <= 400) grow();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [grow]);

  /**
   * 打印要的是**全部**商品，而屏幕上只渲染了一部分（见上面 useIncremental）。
   * 所以在 `beforeprint` 里一次性把总数补上，并用 `flushSync` 逼 React 同步渲染完
   * ——普通 setState 在 React 18 里是异步的，浏览器开始排版时可能还没画出来，
   * 打印就会缺内容（实测：不补的话迪卡侬只能印 18 页，补上之后是全部）。
   *
   * 打印完**不还原**：还原会让页面高度骤减、把滚动位置裁掉；打印本来就很少见，
   * 下次刷新自然回到「先渲染 10 件」的快路径。
   */
  useEffect(() => {
    const before = () => flushSync(() => setVisible(total));
    window.addEventListener('beforeprint', before);
    return () => window.removeEventListener('beforeprint', before);
  }, [total]);

  return { visible: Math.min(visible, total), sentinelRef };
}

/**
 * 列表末尾那行小字：只回答「还有没有」——还没到底就说「继续下滑加载更多」，
 * 到底了就说「已经到底了」。**不报总数**（用户不关心总共有多少，见 2026-09-30）。
 * 件数本来就少（不超过一批）时不画，那种情况下一句「到底了」只是噪音。
 */
function More({ visible, total, sentinelRef }) {
  if (total <= INITIAL) return null;
  return (
    <div className="more" ref={sentinelRef}>
      {visible >= total ? '已经到底了' : '继续下滑加载更多'}
    </div>
  );
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
  const { watch, togglePick, hide } = useWatch();

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
      // 名单里可能存着两张键：product_code（这一张卡片）和吊牌号（整个款）。
      // 两个都要比——详见 lib/watch.js 里 hide() 那段
      DEALS.filter((d) => !watch.hidden.has(d.id) && !watch.hidden.has(d.code)).map((d) => ({
        ...d,
        // 终端 track 是单向的（CLI 里还没有 untrack），报告里要取消它，
        // 得在 dropped 里记一笔才压得住，否则刷新又从数据库冒回来
        dbTracked: d.tracked,
        tracked: (d.tracked || watch.picks.has(d.id)) && !watch.dropped.has(d.id),
      })),
    [watch]
  );

  const pick = useCallback((d) => togglePick(d.id, d.dbTracked), [togglePick]);
  const hideDeal = useCallback((d) => hide(d.id, d.code), [hide]);

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
        /**
         * 只按降幅从大到小排（2026-09-30 撤掉了排序入口）。
         *
         * 比的是 payload 里的精确 `rate`，不是四舍五入后的整数百分比——三件都显示
         * `-74%` 时顺序仍由真实值决定。`Array.prototype.sort` 是稳定的，所以降幅
         * 完全相同的那些保持 SQL 那边的顺序（`max_discount DESC`）。
         */
        .sort((a, b) => b.rate - a.rate)
    );
  }, [deals, filter, query]);

  // 首屏只建前 INITIAL 张卡片，往下滑再一批批补（理由见 useIncremental 的注释）。
  // resetKey 里放的是「会让结果换一批」的两个状态：筛选与搜索。
  const { visible, sentinelRef } = useIncremental(rows.length, `${filter}|${query}`);

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
      />

      <div className="wrap">
        {rows.length === 0 ? (
          <Empty query={query} filter={filter} onReset={reset} />
        ) : (
          <>
            <div className="grid" role="list" aria-label={META.pageTitle}>
              {rows.slice(0, visible).map((deal, i) => (
                <ProductCard
                  key={deal.id}
                  deal={deal}
                  index={i}
                  onPick={() => pick(deal)}
                  onHide={() => hideDeal(deal)}
                />
              ))}
            </div>
            <More visible={visible} total={rows.length} sentinelRef={sentinelRef} />
          </>
        )}
      </div>

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
