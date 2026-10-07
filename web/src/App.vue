<script setup>
/**
 * 报告的根组件：报头 + 工具条 + 商品网格。
 *
 * 2026-10-06 从 React 翻成 Vue。这一份对应关系最多，但都是机械的：
 *   useMemo        → computed
 *   useState       → ref
 *   useCallback    → 普通函数（Vue 不需要稳定引用）
 *   useRef + useEffect(…, []) → ref + onMounted / onBeforeUnmount
 *   useEffect([x]) → watch(x, …)
 *   {cond && <A/>} → v-if
 *   .map(…JSX)     → v-for
 * 两处**不是**机械对应的，都写在用到的位置：`flushSync`（在 lib/use-incremental.js 里
 * 换成了 nextTick）和 `Empty`/`More` 两个小组件（Vue 一个文件一个组件，
 * 但它们各自只有十来行，直接摊在模板里比多开两个文件清楚）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Masthead from './components/Masthead.vue';
import Neko from './components/Neko.vue';
import Toolbar from './components/Toolbar.vue';
import ProductCard from './components/ProductCard.vue';
import MinePanel from './components/MinePanel.vue';
import CategoryMenu from './components/CategoryMenu.vue';
import { num } from './lib/format.js';
import { useWatch, FAVORITES_KEY } from './lib/use-watch.js';
import { useIncremental } from './lib/use-incremental.js';
import { loadProgress, saveProgress, clearProgress } from './lib/browse-memory.js';
import { ourSizes, sizeRank } from './lib/sizes.js';
import { CATEGORIES } from './lib/site.js';
import { DATA, DEALS, META } from './lib/site.js';

/**
 * 收藏快照：报告页点爱心时，把整件商品存进 localStorage（同源共享）。
 * 原来是发给独立的一页「我的」看；那页 2026-10-06 收进了报告本身（MinePanel），
 * 但存的内容没变 —— 整件商品的字段。
 *
 * 键从 lib/use-watch.js 拿（唯一出处），别在这里再写一遍字面量。
 */
function saveFavorite(d, on) {
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { /* 没存过 */ }
    if (!Array.isArray(list)) list = [];
    list = list.filter((x) => x.id !== d.id);
    if (on) {
      list.unshift({
        id: d.id, code: d.code, name: d.name, price: d.price,
        currency: META.currency?.sym || '¥',
        image: `/${DATA.site}/${d.image}`,
        url: d.url, site: DATA.site, prefix: META.storagePrefix, savedAt: Date.now(),
      });
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch { /* 存不下就算了 */ }
}

/**
 * 上次读到哪儿的**快照**。只读一次：之后本地状态往前走，快照等页面被收起时才重新写。
 * `DATA.site` 在这里只当 localStorage 的命名空间用，不做任何版面判断。
 */
const saved = loadProgress(DATA.site, DATA.generatedAt);

// 支持 ?q= 深链（/uniqlo/?q=488089 这类直接进搜索）。
// **URL 优先于「上次读到哪儿」** —— 你点的是一条明确的深链，就该看那一条。
const query = ref(new URLSearchParams(location.search).get('q') || saved?.query || '');
const size = ref(saved?.size ?? '');
/** 分类筛选：空串 = 全部。值是分类码（顶层 1111WOMEN 这种，或二层的子类码） */
const cat = ref('');
/** 站名下面的分类菜单开没开 */
const catsOpen = ref(false);
/**
 * 选了分类：记下来，并**收起整块菜单**（用户 2026-10-06：「当我选了之后，这个树
 * 自动收起来，回到没有点 goodprices 的样式」）。筛选结果留着，只是把面板关掉。
 */
function pickCat(code) {
  // 只筛，不关面板。关闭交给 close 事件 —— 分类树要先播完「温度计」红线动画
  // 才 emit('close')，面板这才收起（约 1.2 秒）。
  cat.value = code;
}

function closeCat() {
  // 收起面板，并退出「我的」（用户：「在我的里点分类没反应」——
  // 「我的」盖着榜单，只改 cat 看不见，所以选中分类后要跳回榜单）。
  catsOpen.value = false;
  mineOpen.value = false;
}

function toggleCats() {
  catsOpen.value = !catsOpen.value;
  // 菜单在**文档流顶部**（报头下面）。深滚时点开它落在视口上方、看不见 ——
  // 用户 2026-10-07 报「滑到很下面点 GoodPrices 弹不出来，要滑到最顶才看到」。
  // 于是点开就滚回顶部：报头 sticky 归位，菜单正好露在下面。
  if (catsOpen.value) window.scrollTo({ top: 0, behavior: 'smooth' });
}
// 「我的」：一块视图，只有 收藏 / 转移码 两块（用户 2026-10-06）
const mineOpen = ref(false);

const { watch: watchBooks, togglePick, hide } = useWatch();

/**
 * 点过闭眼（不再出现）的直接从榜上拿掉；「待拔草」= 终端 track 进来的 ∪
 * 报告里收藏的 − 报告里取消的。
 */
const deals = computed(() =>
  DEALS
    // 名单里可能存着两张键：product_code（这一张卡片）和吊牌号（整个款），两个都要比
    .filter((d) => !watchBooks.hidden.has(d.id) && !watchBooks.hidden.has(d.code))
    .map((d) => ({
      ...d,
      // 终端 track 是单向的（CLI 里还没有 untrack），报告里要取消它，
      // 得在 dropped 里记一笔才压得住，否则刷新又从数据库冒回来
      dbTracked: d.tracked,
      tracked: (d.tracked || watchBooks.picks.has(d.id)) && !watchBooks.dropped.has(d.id),
    }))
);

/** 尺码表：**就是 XS/S/M/L/XL 五个**，从当前可见的商品里现算「真有哪些」 */
const sizeOptions = computed(() => {
  const all = new Set();
  for (const d of deals.value) for (const l of ourSizes(d.sizes?.labels ?? [])) all.add(l);
  return [...all].sort((a, b) => sizeRank(a) - sizeRank(b));
});

/* 这里原来有个 sizeNote，算「尺码是 N 分钟前的快照，以官网为准」摆给用户看
   （起因是 2026-10-05 「筛 XS 点进去没有」那一报）。2026-10-06 用户要求
   「也不要有尺码是两分钟前的快照这个提示」，整条删掉 —— 连带 Toolbar 的 note
   prop 和那个 <p>。 */
function pick(d) {
  const currentlyOn = d.dbTracked ? !watchBooks.dropped.has(d.id) : watchBooks.picks.has(d.id);
  togglePick(d.id, d.dbTracked);
  saveFavorite(d, !currentlyOn);
}
function hideDeal(d) {
  hide(d.id, d.code);
}

/**
 * 这件商品属不属于某个分类。
 * 顶层码存在 d.category 上（每件恰好一个）；二层码存在 d.tags 里 ——
 * ⚠️ 二层**会重复命中**（一件衬衫同时挂在「衬衫·POLO衫」「衬衫」「长款」…），
 *    所以筛选以顶层为主，二层是给菜单看的枝杈。
 */
function matchesCat(d, code) {
  if (!code) return true;
  if (d.category === code) return true;
  return (d.tags ?? []).includes(code);
}

/** 菜单上每个分类的件数（跟着当前榜单算，不是全库） */
const catCounts = computed(() => {
  const out = {};
  for (const c of CATEGORIES) {
    // 顶层/子类都用 matchesCat 数：男女同款带两个顶层码（一个在 category、一个在 tags），
    // 这样它在男女两个分类的件数都算得进去（用户 2026-10-06 要求）。
    out[c.code] = deals.value.filter((d) => matchesCat(d, c.code)).length;
  }
  // 「未分类」：整棵树都没认出来的那些（接口确实没给 1111xxxx 码的）
  out.__none = deals.value.filter((d) => !d.category).length;
  return out;
});

const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  // 搜索认哪几个字段也是站点差异，只能从 searchLabel 反推（契约里没有单独的开关）。
  const brandSearchable = META.searchLabel.includes('品牌');
  const hay = (d) => [d.name, d.code, brandSearchable ? d.brand : ''].filter(Boolean).join(' ').toLowerCase();
  return deals.value
    .filter((d) => !q || hay(d).includes(q))
    .filter((d) => !size.value || ourSizes(d.sizes?.labels ?? []).includes(size.value))
    .filter((d) => matchesCat(d, cat.value))
    /**
     * 只按降幅从大到小排。比的是 payload 里的精确 `rate`，不是四舍五入后的整数 ——
     * 三件都显示 `-74%` 时顺序仍由真实值决定。Array.prototype.sort 是稳定的，
     * 所以降幅完全相同的那些保持 SQL 那边的顺序。
     */
    .sort((a, b) => b.rate - a.rate);
});

// 首屏只建前 INITIAL 张卡片，往下滑再一批批补（理由见 lib/use-incremental.js）
const rowsCount = computed(() => rows.value.length);
const resetKey = computed(() => `${size.value}|${cat.value}|q|${query.value}`);
const { visible, sentinelRef } = useIncremental(rowsCount, resetKey, saved?.visible);

/**
 * 回来时把位置接上：**必须在卡片渲染之后**（文档够高才滚得过去），所以放 onMounted。
 *
 * 优先用**锚点商品**（2026-10-06 改的）：找到上次压着工具条下沿的那一件，
 * 把它放回原来的位置。这样报告重建过也照样对 —— 认的是商品，不是像素。
 * 它掉榜了就**退回顶部**（把一个错位置硬塞给用户比从头开始更糟）。
 * 老快照没锚点，才退回 scrollY。
 */
onMounted(() => {
  if (!saved) return;
  lastNavY = window.scrollY || 0;
  const hasAnchor = Boolean(saved.anchor);
  if (!hasAnchor && !saved.scrollY) return;
  // 浏览器自己的还原会和我们打架（它不知道我们恢复了多少张卡片），交给这里接管
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const put = () => {
    if (hasAnchor) {
      const el = document.querySelector('.card[data-id="' + CSS.escape(saved.anchor) + '"]');
      if (el) {
        const y = window.scrollY + el.getBoundingClientRect().top - stickyBottom() - saved.anchorOffset;
        window.scrollTo(0, Math.max(0, Math.round(y)));
        // 恢复位置是一次跳转，别让它被当成"往下滚"（否则一回来导航栏就是收着的）
        lastNavY = window.scrollY || 0;
        return true;
      }
    }
    if (saved.scrollY) {
      window.scrollTo(0, saved.scrollY);
      lastNavY = window.scrollY || 0;
      return true;
    }
    return false; // 锚点那件已经不在榜上了 —— 停在顶部
  };

  put();
  // 图片是懒加载的，布局可能还会动一下，再对两次
  const t1 = setTimeout(put, 300);
  const t2 = setTimeout(put, 1200);
  return () => { clearTimeout(t1); clearTimeout(t2); };
});

/**
 * 列表**可见时**的最后滚动位置。
 *
 * ⚠️ 为什么不直接用 `window.scrollY`：进了「我的」之后榜单那一块是 `hidden` 的，
 * 文档变短，`window.scrollY` 必然是 0。而进度是在 `pagehide` 那一刻读它——
 * 于是「在『我的』里点『优衣库』回榜单」会把读到哪儿覆盖成 0，回来就停在顶部
 * （用户 2026-10-06 报的正是这个：「点导航栏的 GoodPrices 或优衣库，停不到刚才浏览的位置」。
 *  实测：从榜单上点 GoodPrices 能回到原处，从「我的」里点优衣库就回到顶部）。
 * 所以滚动位置只在榜单可见时记，保存时用它。
 */
const lastListY = ref(0);
/** 上一次在榜单上记下的锚点（进「我的」之后要沿用它，别被覆盖成空） */
const lastAnchor = ref({ anchor: '', anchorOffset: 0 });

/**
 * 报头和工具条**一起收放**（2026-10-06 用户：「上滑的时候，导航栏也要能滑上去，
 * 下滑的时候滑下来」）。
 *
 * 原来这套逻辑在 Toolbar.vue 里，只管工具条自己。但那两个都是 position: sticky，
 * 而且**工具条的 top 正好是报头高度**（--nav-h，由 Masthead 的 ResizeObserver 实测写入）——
 * 也就是说工具条是"躲到报头背后"来实现收起的。报头一旦也跟着收走，
 * 这个位移就不够了（会剩二十几像素露在视口顶上），CSS 那边因此改成了
 * `translateY(calc(-100% - var(--nav-h)))`：整条移出视口，不再依赖谁挡在前面。
 *
 * 放这里是为了**只有一个滚动监听、一份判断** —— 两个都收才叫同步，
 * 各算各的迟早在某个方向上错开。
 */
const navHidden = ref(false);
/** 上一次用于判断方向的滚动位置 */
let lastNavY = 0;
function onScrollRemember() {
  /**
   * 收放判断。阈值和原来 Toolbar 里那套一模一样（那套是调过手感的），
   * 只是现在同时管报头和工具条：
   *   · 位移小于 6px 不算 —— 手指抖动、惯性回弹、iOS 地址栏收起都会产生一两像素；
   *   · 顶部 60px 以内永远露着；
   *   · 往下滚且滚过 144px 才收；往上滚立刻放（收放是"让位"，放要跟手）。
   */
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const dy = y - lastNavY;
  if (Math.abs(dy) >= 6) {
    if (y < 60) navHidden.value = false;
    else if (dy > 0 && y > 144) navHidden.value = true;
    else if (dy < 0) navHidden.value = false;
    lastNavY = y;
  }

  // 「我的」里导航栏必须露着（用户 2026-10-06：「点了我的之后，最上面的导航栏别消失」），
  // 而且那一页没有工具条、榜单也是 hidden 的，下面记进度的部分要跳过。
  if (mineOpen.value) {
    navHidden.value = false;
    return;
  }
  lastListY.value = Math.round(window.scrollY);
  lastAnchor.value = currentAnchor();
}

/** 工具条（粘性）的下沿在视口里的位置 —— 锚点就是相对它的 */
function stickyBottom() {
  const tb = document.querySelector('.toolbar');
  return tb ? tb.getBoundingClientRect().bottom : 0;
}

/**
 * 找到「压着工具条下沿的那件商品」—— 位置就锚在它身上。
 * 顺带记下它当时相对工具条下沿的偏移，回来才能放回一模一样的地方。
 */
function currentAnchor() {
  const top = stickyBottom();
  for (const el of document.querySelectorAll('.card')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top) return { anchor: el.dataset.id || '', anchorOffset: Math.round(r.top - top) };
  }
  return { anchor: '', anchorOffset: 0 };
}

// 页面被收起 / 离开时把进度写下来
function saveNow() {
  // 在「我的」里的话，榜单是 hidden 的：window.scrollY 是 0、卡片也量不到，
  // 这时候**不要**动锚点 —— 沿用上一次在榜单上记下的那份。
  const here = mineOpen.value ? { anchor: lastAnchor.anchor, anchorOffset: lastAnchor.anchorOffset } : currentAnchor();
  saveProgress(DATA.site, DATA.generatedAt, {
    size: size.value,
    visible: visible.value,
    scrollY: mineOpen.value ? lastListY.value : Math.round(window.scrollY),
    anchor: here.anchor,
    anchorOffset: here.anchorOffset,
    query: query.value,
  });
}
function onVisibility() {
  if (document.visibilityState === 'hidden') saveNow();
}
onMounted(() => {
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('scroll', onScrollRemember, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', saveNow);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('scroll', onScrollRemember);
});

/** 进「我的」之前先记一下当前位置 —— 进去之后 mineOpen 就挡着不再更新了 */
function openMine() {
  lastListY.value = Math.round(window.scrollY);
  mineOpen.value = true;
}

function reset() {
  query.value = '';
  size.value = '';
  clearProgress(DATA.site);
}
</script>

<template>
  <Masthead
    :recorded="DATA.recorded ?? deals.length"
    :mine-open="mineOpen"
    :hidden="navHidden"
    :on-mine="openMine"
    :cats-open="catsOpen"
  @categories="toggleCats"
/>
  <!-- 站名下面展开的分类菜单：**在正常文档流里**（把榜单往下推），不是浮层。
       关掉时整块不渲染，所以报告里那 50 条分类不占运行时的力气。 -->
  <CategoryMenu
    v-if="catsOpen"
    :categories="CATEGORIES"
    :counts="catCounts"
    :value="cat"
    @pick="pickCat"
    @close="closeCat"
  />

  <!-- 「我的」是**一块视图**，不是盖住全屏的浮层 —— 导航栏必须一直在
       （用户 2026-10-06：「点了我的之后，最上面的导航栏别消失」）。 -->
  <MinePanel v-if="mineOpen" />

  <Toolbar
    v-if="!mineOpen"
    :query="query"
    :on-query="(v) => (query = v)"
    :size="size"
    :on-size="(v) => (size = v)"
    :sizes="sizeOptions"
    :hidden="navHidden"
  />

  <!-- 猫（2026-10-06）。fixed 定位，在视口里跑，和页面结构无关 -->
  <Neko v-if="!mineOpen" />

  <div class="wrap" :hidden="mineOpen">
    <!-- 空结果提示，两个视图共用。搜索的措辞里那一串「名称或编号…」来自
         meta.searchLabel：优衣库只有名称和吊牌编号可搜 -->
    <div v-if="rows.length === 0" class="empty">
      <div class="empty__title">没有符合条件的商品</div>
      <div class="empty__hint">
        {{ query
          ? `没有「${META.searchLabel}」包含「${query}」的降价商品。`
          : '榜上暂时没有商品（可能都被你点过「不再出现」了）。' }}
      </div>
      <button class="empty__reset" @click="reset">清除搜索</button>
    </div>

    <template v-else>
      <div class="grid" role="list" :aria-label="META.pageTitle">
        <ProductCard
          v-for="(deal, i) in rows.slice(0, visible)"
          :key="deal.id"
          :deal="deal"
          :index="i"
          :on-pick="() => pick(deal)"
          :on-hide="() => hideDeal(deal)"
        />
      </div>

      <!-- 列表末尾那行小字：只回答「还有没有」。**不报总数**（用户不关心总共有多少）。
           件数本来就少（不超过一批）时不画，那种情况下一句「到底了」只是噪音。 -->
      <div v-if="rows.length > 10" ref="sentinelRef" class="more">
        {{ visible >= rows.length ? '已经到底了' : '继续下滑加载更多' }}
      </div>
    </template>
  </div>
</template>
