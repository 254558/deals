<script setup>
/**
 * 报头只有一行站点信息：不占首屏，紧跟其后的就是筛选页签。
 *
 * 这一行里的每个词都来自 `META`，组件里没有一处站点判断：
 *
 *   左上角那格       **固定写 GoodPrices**（2026-10-01 起）：它是这个站的名字，
 *                      所有页面都一样，点它回首页（/ → 优衣库）。
 *                      `META.label`（优衣库）仍然在 payload 里，只是报头不用它了。
 *   META.links         行尾那组入口（数组）：另一家的报告。核心拼好；
 *                      没配就是空数组，一个都不渲染。
 *   META.showRecorded  是否显示「共记录 N 件」
 *
 * 「抓取于 2026/9/30 21:37」那一格 2026-10-01 删了：页面上多一行时间对「这件要不要买」
 * 没有帮助，而且每天都在变、看着像过期提示。数据层照记（`payload.generatedAt`）。
 *
 * `recorded` 是数据库里的累计记录数，不是这一期榜上的条数。
 *
 * 2026-10-06 从 React 翻成 Vue，两处值得记：
 *   · `useRef` + `useEffect(..., [])` → `ref` + `onMounted` / `onBeforeUnmount`。
 *     ResizeObserver 那段一字未改，只是挂载与卸载的钩子换了名字。
 *   · `ref="navRef"` 在 Vue 3.5+ 的 script setup 里，**变量名就是模板 ref 的名字**，
 *     不用再写 `ref={navRef}`。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { num } from '../lib/format.js';
import { META } from '../lib/site.js';
/**
 * 「我的」那一格里的一排像素小人（2026-10-06 用户给的 11 张 40×40 图，
 * 已清掉网格和背景）。每张都只有几百字节 —— Vite 对 4KB 以内的资源直接转成
 * data URI，所以报告仍是单文件、一个请求都不多。
 * 用 glob 而不是写 11 行 import：文件名是 pal-01…pal-11，glob 天然按名排序。
 */
const palIcons = Object.entries(
  import.meta.glob('../assets/pal-*.png', { eager: true, import: 'default' })
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

/**
 * 每次打开**随机拿一个**（2026-10-06 用户先要两个、后改成一个：「每次随机从里面取一个」）。
 *
 * 随机发生在浏览器里（报告是静态页、Vue 在客户端渲染），所以每个访客、每次刷新
 * 抽到的组合都不一样。
 *
 * ⚠️ 用 Fisher–Yates，不要写成 sort(() => Math.random() - 0.5)：
 *    那个看着像打乱，实际每种排列的概率并不相等（引擎不同结果还不同）。
 *    这里只有 11 个元素，写正规的也就几行。
 */
const shuffled = [...palIcons];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
// 只取一个（2026-10-06 用户：「每次随机从里面取一个，后面加上我的两个字」）
const shownPal = shuffled[0];

/** 点站名 = 展开/收起分类菜单（不再是回首页） */
const emit = defineEmits(['categories']);

const props = defineProps({
  recorded: { type: Number, default: 0 },
  /** 往下滚时收上去（判断在 App.vue，和工具条共用一份，保证同步） */
  hidden: { type: Boolean, default: false },
  /** 点「我的」：切到那块视图（没给就不渲染这一条） */
  onMine: { type: Function, default: null },
  /** 现在是不是在「我的」那块（决定右边那条是「我的」还是「优衣库」） */
  mineOpen: { type: Boolean, default: false },
  /** 站名下面的分类菜单是不是开着（决定站名要不要标成"已展开"） */
  catsOpen: { type: Boolean, default: false },
});

// 报头自己量高度，写成 --nav-h：下面那条工具条也是粘性的，它的 top 得正好接在报头下沿。
// 写死一个数会在窄屏/字体不同时错位，所以交给 ResizeObserver 一直盯着。
const navRef = ref(null);
let ro = null;

function measure() {
  const el = navRef.value;
  if (!el) return;
  document.documentElement.style.setProperty('--nav-h', Math.ceil(el.getBoundingClientRect().height) + 'px');
}

onMounted(() => {
  measure();
  ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  ro?.observe(navRef.value);
  window.addEventListener('resize', measure);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener('resize', measure);
});

// 行尾那组入口：另一家的报告（核心拼好的数组，见 report.mjs 的 buildPayload）。
// 老的 meta.crossLink 还兼容着——万一有旧 payload 进来，别把入口弄没了。
const links = META.links?.length ? META.links : META.crossLink ? [META.crossLink] : [];
</script>

<template>
  <header ref="navRef" class="masthead" :class="{ 'masthead--up': props.hidden }">
    <div class="wrap">
      <div class="masthead__eyebrow">
        <!-- 站名**中间**那格：Good[小人]Prices（2026-10-06 用户：
             「图片放在 good 和 prices 中间，和文字几乎不要有间距」）。
             更早这里放的是 9×9 的方块点阵，先是挪到站名前面，现在挪进站名里。
             ⚠️ Alt+「Good」「Prices」和 img 之间**不能有换行/空格**，
                否则模板会渲染出一个空白，那就有缝了。
             ⚠️ 它是装饰，alt=""；站名本身（GoodPrices）才是可读的文字。 -->
        <button class="masthead__text masthead__home" type="button" :class="{ 'is-open': props.catsOpen }" title="按分类看（点这里展开）" :aria-expanded="props.catsOpen ? 'true' : 'false'" @click="emit('categories')">Good<img class="masthead__pal" :src="shownPal" alt="" />Prices</button>
        <span v-if="META.showRecorded" class="label">共记录 {{ num(props.recorded) }} 件</span>

        <!-- 行尾固定那一条，**跟着视图换**（用户 2026-10-06）：
              在榜单上 →「我的」（进收藏 / 转移码）；
              进了「我的」→「优衣库」（回榜单）。
            于是在「我的」里，导航栏是「左 GoodPrices，右 优衣库」。 -->
        <a v-if="props.mineOpen" class="masthead__text masthead__cross" href="./">优衣库</a>
        <!-- 2026-10-06 用户：「我希望用这个替换导航栏中的我的两个字」——
             换成一张 40×40 的像素小人（图由用户提供，已清掉网格和背景）。
             40×40 只有 721 字节，走 Vite 的 4KB 内联阈值 → 直接变成 data URI，
             报告仍是单文件、不多一个请求。
             ⚠️ 文字没了，所以补了 aria-label="我的"：
             否则读屏器念到这个按钮只会说"按钮"。
             （隔壁「优衣库」那条按用户要求**保持文字**，没动。） -->
        <button
          v-else-if="props.onMine"
          class="masthead__text masthead__cross"
          type="button"
          @click="props.onMine()"
        >
          我的
        </button>

        <!-- 行尾那组入口：另一家的报告（靠 margin-left: auto 顶到行尾） -->
        <a
          v-for="l in links"
          :key="l.href"
          class="masthead__text masthead__cross"
          :href="l.href"
          target="_blank"
          rel="noreferrer"
          :title="l.title"
        >
          {{ l.label }}
        </a>
      </div>
    </div>
  </header>
</template>
