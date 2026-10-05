import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Masthead } from './components/Masthead.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { ProductCard } from './components/ProductCard.jsx';
import { num } from './lib/format.js';
import { useWatch } from './lib/watch.js';
import { loadProgress, saveProgress, clearProgress } from './lib/browse-memory.js';
import { CATS, categoryOf, sizeRank } from './lib/size-groups.js';
import { DATA, DEALS, META } from './lib/site.js';


/** 空结果提示，两个视图共用。搜索的措辞里那一串「名称或编号…」来自
 *  `meta.searchLabel`：迪卡侬的编号旁边还有品牌可搜，优衣库只有名称和吊牌编号 */
function Empty({ query, onReset }) {
  return (
    <div className="empty">
      <div className="empty__title">没有符合条件的商品</div>
      <div className="empty__hint">
        {query
          ? `没有「${META.searchLabel}」包含「${query}」的降价商品。`
          : '榜上暂时没有商品（可能都被你点过「不再出现」了）。'}
      </div>
      <button className="empty__reset" onClick={onReset}>
        清除搜索
      </button>
    </div>
  );
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
 * @param {number} [initialVisible] 首次挂载时先渲染多少张（恢复上次的浏览进度用，见 browse-memory.js）
 */
function useIncremental(total, resetKey, initialVisible = INITIAL) {
  const [visible, setVisible] = useState(() => Math.max(INITIAL, initialVisible));
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
    // 首次挂载：保留恢复出来的进度（browse-memory），只把「换筛选/搜索」这条路留在这里
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setVisible(INITIAL);
    window.scrollTo(0, 0);
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
   * 这条的来历：以前列表后面还跟着一屏页脚（名词解释、数据来源），拖滚动条到底、
   * 按 End、或者猛甩一下，视口会一下落在页脚之后——此时哨兵在视口**上方**，
   * IntersectionObserver 的 800px 提前量也够不着，于是它停在那儿不再往下补（实测踩到）。
   * 页脚 2026-09-30 撤掉之后哨兵就在文档末尾，直达底部也能被 IO 看到，所以这条
   * **现在是保险**（挡「视口落在文档最底部、而哨兵在视口上方」这一类情况），成本只有几行。
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
 * 页面到商品网格就结束了：**没有页脚**（2026-09-30 应要求删掉——名词解释、数据来源、
 * 版面说明、字体署名那几段用户都不看）。内嵌字体的授权署名仍然随文件走，但落在
 * 内嵌 CSS 的注释里（`buildFontCss` 的 notice，见 core/fonts.mjs），页面上不显示。
 */
export default function App() {
  /**
   * 上次读到哪儿的**快照**（见 lib/browse-memory.js）。
   * 只读一次：之后本地状态往前走，快照等页面被收起时才重新写。
   * `DATA.site` 在这里只当 localStorage 的命名空间用，不做任何版面判断（契约第三节）。
   */
  const saved = useMemo(() => loadProgress(DATA.site, DATA.generatedAt), []);
  const [query, setQuery] = useState(saved?.query ?? '');
  const [size, setSize] = useState(saved?.size ?? '');
  const [cat, setCat] = useState(saved?.cat ?? '');
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

  /**
   * 尺码**按品类分组**：每堆各自列出自己真有的尺码（现算，不写死清单）。
   * 分组与排序规则见 lib/size-groups.js。空组不画 —— 优衣库没有鞋就不显示「鞋子」。
   */
  const sizeGroups = useMemo(() => {
    const byCat = new Map(CATS.map((c) => [c, new Set()]));
    for (const d of deals) {
      const c = categoryOf(d.name);
      for (const l of d.sizes?.labels ?? []) byCat.get(c).add(l);
    }
    return CATS.map((c) => ({
      cat: c,
      sizes: [...byCat.get(c)].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, 'zh')),
    })).filter((g) => g.sizes.length > 0);
  }, [deals]);

  const pick = useCallback((d) => togglePick(d.id, d.dbTracked), [togglePick]);
  const hideDeal = useCallback((d) => hide(d.id, d.code), [hide]);


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
        .filter((d) => !q || hay(d).includes(q))
        .filter((d) => !cat || categoryOf(d.name) === cat)
        .filter((d) => !size || (d.sizes?.labels ?? []).includes(size))
        /**
         * 只按降幅从大到小排（2026-09-30 撤掉了排序入口）。
         *
         * 比的是 payload 里的精确 `rate`，不是四舍五入后的整数百分比——三件都显示
         * `-74%` 时顺序仍由真实值决定。`Array.prototype.sort` 是稳定的，所以降幅
         * 完全相同的那些保持 SQL 那边的顺序（`max_discount DESC`）。
         */
        .sort((a, b) => b.rate - a.rate)
    );
  }, [deals, query, size, cat]);

  // 首屏只建前 INITIAL 张卡片，往下滑再一批批补（理由见 useIncremental 的注释）。
  // resetKey 用搜索词：它一变，结果就换一批，滚动位置要跟着重来。
  const { visible, sentinelRef } = useIncremental(rows.length, `${cat}|${size}|q|${query}`, saved?.visible);
  // 回来时把滚动位置接上：**必须在卡片渲染之后**（文档够高才滚得过去），
  // 所以放 useEffect 而不是 useLayoutEffect 之外的地方都不行 —— effect 跑在 DOM 提交后。
  useEffect(() => {
    if (!saved || !saved.scrollY) return;
    // 浏览器自己的还原会和我们打架（它不知道我们恢复了多少张卡片），交给这里接管
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const put = () => window.scrollTo(0, saved.scrollY);
    put();
    // 图片是懒加载的，布局可能还会动一下，再对一次
    const t = setTimeout(put, 300);
    return () => clearTimeout(t);
  }, []);

  // 页面被收起 / 离开时把进度写下来。用 ref 取当前值，免得为了拿到最新的
  // visible/query 而反复重挂监听。
  const live = useRef({ visible: 0, query: "", size: "", cat: "" });
  useEffect(() => { live.current = { visible, query, size, cat }; }, [visible, query, size, cat]);
  useEffect(() => {
    const save = () => saveProgress(DATA.site, DATA.generatedAt, {
      cat: live.current.cat,
      size: live.current.size,
      visible: live.current.visible,
      scrollY: Math.round(window.scrollY),
      query: live.current.query,
    });
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);


  function reset() {
    setQuery('');
    setSize('');
    setCat('');
    clearProgress(DATA.site);
  }


  return (
    <>
      <Masthead recorded={DATA.recorded ?? deals.length} />

      <Toolbar
        query={query}
        onQuery={setQuery}
        cat={cat}
        size={size}
        onPick={(c, s) => { setCat(c); setSize(s); }}
        groups={sizeGroups}
      />

      <div className="wrap">
        {rows.length === 0 ? (
          <Empty query={query} onReset={reset} />
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

    </>
  );
}
