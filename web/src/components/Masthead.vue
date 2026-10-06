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

const props = defineProps({
  recorded: { type: Number, default: 0 },
  /** 往下滚时收上去（判断在 App.vue，和工具条共用一份，保证同步） */
  hidden: { type: Boolean, default: false },
  /** 点「我的」：切到那块视图（没给就不渲染这一条） */
  onMine: { type: Function, default: null },
  /** 现在是不是在「我的」那块（决定右边那条是「我的」还是「优衣库」） */
  mineOpen: { type: Boolean, default: false },
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
        <!-- 品牌标记：**细密的方块点阵**（2026-10-06 用户：「改回前面是方块点阵，
             后面是普通字体那种」）。图案和颜色都在 styles.css 的 .masthead__dot 里。 -->
        <span class="masthead__dot" aria-hidden="true" />
        <a class="masthead__text masthead__home" href="/" title="GoodPrices 首页（优衣库捡漏榜）">GoodPrices</a>
        <span v-if="META.showRecorded" class="label">共记录 {{ num(props.recorded) }} 件</span>

        <!-- 行尾固定那一条，**跟着视图换**（用户 2026-10-06）：
              在榜单上 →「我的」（进收藏 / 转移码）；
              进了「我的」→「优衣库」（回榜单）。
            于是在「我的」里，导航栏是「左 GoodPrices，右 优衣库」。 -->
        <a v-if="props.mineOpen" class="masthead__text masthead__cross" href="./">优衣库</a>
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
