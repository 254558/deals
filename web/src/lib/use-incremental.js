import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 首屏只渲染前 INITIAL 件，往下滑到哨兵再一批一批补上（无限滚动）。
 *
 * 为什么需要：报告是自包含单文件，数据全在内存里，但**卡片是整批建的**。
 * 手机上实测（390 宽 + 4 倍 CPU 降速，2026-09-30）：
 *
 *   优衣库 877 件 → DOM 24,705 个节点，主线程长任务合计 1250ms
 *
 * 而图片本来就是懒加载的（首屏只请求 3～4 张），网络也不是瓶颈 —— 慢的是
 * **一次性建出几万个 DOM 节点**。本地双击打开（无网络）测得的长任务时间和线上
 * 几乎一样，正好说明这一点。
 *
 * 每批 10 件是用户指定的。桌面屏幕高，10 件填不满一屏，哨兵会连着触发几次 ——
 * 这不是问题：每次只多建 10 张卡片。`rootMargin` 给 800px，意思是「还没滑到底
 * 就先把下一批准备好」，滚起来才是连续的。
 *
 * 2026-10-06 从 React（App.jsx 里的 useIncremental）翻成 Vue，三处对应关系：
 *   useState          → ref
 *   useRef(哨兵)      → ref（模板里 ref="sentinelRef"，变量名即名字）
 *   useEffect(…, []) → onMounted / onBeforeUnmount
 *   useEffect([x])   → watch(x, …)
 *   flushSync        → nextTick()（见 beforeprint 那段注释）
 *
 * ⚠️ 顺手清掉了 React 版里的一处残留：resetKey 那个 effect 里
 * `window.scrollTo(0, 0)` 写了**两遍**，而且 `if (mounted.current)` 那行永远为真
 * （前面刚把它设成 true），是当初做「记住读到哪儿」时留下的。这里只做一次。
 */
const INITIAL = 10;
const STEP = 10;

/**
 * @param {import('vue').Ref<number>} total 当前筛选/搜索之后的总数
 * @param {import('vue').Ref<string>} resetKey 这个值一变就回到第一批（筛选、搜索、视图）
 * @param {number} [initialVisible] 首次挂载时先渲染多少张（恢复上次的浏览进度用）
 */
export function useIncremental(total, resetKey, initialVisible = INITIAL) {
  const visible = ref(Math.max(INITIAL, initialVisible || 0));
  const sentinelRef = ref(null);
  let io = null;

  function grow() {
    // 只增不减、且封顶：哨兵停留可见时会被反复回调，拿到同一个值就不再触发更新
    visible.value = Math.min(visible.value + STEP, total.value);
  }

  // 换了筛选/搜索就从头看：回到第一批，并滚回顶部 —— 否则你还停在
  // 「上一批结果」的滚动位置上，而列表已经换人了。
  // 首次挂载时**不**回顶：浏览器要自己恢复上次的滚动位置（browse-memory 那条路）。
  let mounted = false;
  watch(resetKey, () => {
    if (!mounted) { mounted = true; return; }
    visible.value = INITIAL;
    window.scrollTo(0, 0);
  });
  // watch 默认不在首次触发，所以这里补一次标记（等价于 React 那个 mounted ref）
  onMounted(() => { mounted = true; });

  onMounted(() => {
    const el = sentinelRef.value;
    if (!el || typeof IntersectionObserver !== 'function') return;
    io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) grow(); },
      // 提前 800px 就补——不等到真看见底，滚起来才是连续的
      { rootMargin: '800px 0px' }
    );
    io.observe(el);
  });

  /**
   * 兜底：直接跳到页面最底部时，哨兵可能被**一步跨过去**。
   *
   * 以前列表后面还跟着一屏页脚，拖到底、按 End、或者猛甩一下，视口会落在页脚之后 ——
   * 此时哨兵在视口**上方**，IO 的 800px 提前量也够不着，于是不再往下补（实测踩到）。
   * 页脚 2026-09-30 撤掉之后哨兵就在文档末尾，直达底部也能被 IO 看到，所以这条
   * **现在是保险**，成本只有几行。
   *
   * 会不会失控？不会——前提是**关掉了滚动锚定**（`html { overflow-anchor: none }`）。
   * 锚定开着的话，补完内容浏览器会把视口重新钉回底部，条件继续成立，实测一次
   * 「直达底部」连补 12 批。关掉之后，补进来的新卡片直接落到视口里，人就离开底部了。
   */
  function onScroll() {
    const doc = document.documentElement;
    if (doc.scrollHeight - (window.scrollY + window.innerHeight) <= 400) grow();
  }
  onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));

  /**
   * 打印要的是**全部**商品，而屏幕上只渲染了一部分。
   *
   * React 那边用 `flushSync` 逼一次同步渲染（普通 setState 是异步的，浏览器开始
   * 排版时可能还没画出来，打印就会缺内容）。Vue 里等价的东西是 `nextTick` ——
   * 它把更新排进微任务，而微任务一定在浏览器继续排版之前跑完。
   *
   * 打印完**不还原**：还原会让页面高度骤减、把滚动位置裁掉；打印本来就很少见，
   * 下次刷新自然回到「先渲染 10 件」的快路径。
   */
  function beforePrint() {
    visible.value = total.value;
    nextTick(() => { /* 等这一帧的 DOM 更新落定，浏览器随后才开始排版 */ });
  }
  onMounted(() => window.addEventListener('beforeprint', beforePrint));

  onBeforeUnmount(() => {
    io?.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('beforeprint', beforePrint);
  });

  return { visible, sentinelRef, grow };
}
