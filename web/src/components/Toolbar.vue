<script setup>
/**
 * 工具条：搜索框 + 尺码筛选。
 *
 * 页签（全部/限时特优/超值精选/待拔草 那两组）2026-10-05 按用户要求整组删掉了；
 * 同一天又要「在搜索框旁边加个尺码筛选按钮」。
 *
 * 尺码**只有 XS/S/M/L/XL 五个**（用户：「只要这五个，不要大码的，
 * 不需要区分衣服裤子等等」）。一件东西的尺码里没有这五个之一就不进这张表 ——
 * 理由见 lib/sizes.js：那些 cm 是腰围/裤长/身高/脚长，换算成 S/M/L 就是编数据。
 *
 * 三层，各管一件事：
 *   .toolbar      整页宽、粘住（粘性元素只能在自己父元素的盒子里活动，
 *                 所以外壳必须高过整页内容，不能是 .wrap）
 *   .wrap         居中 + 左右内衬
 *   .toolbar__row flex 排布 + 下边那条发丝线（放在这层，线才跟报头、表头一样内缩）
 *
 * 2026-10-06 从 React 翻成 Vue，两处值得记：
 *   · 受控输入框从 `value=` + `onChange=` 变成 `:value=` + `@input=`（**不是 v-model**）——
 *     因为值的唯一出处是父组件的 query，这里只负责把输入报上去。
 *     用 v-model 会变成组件自己持有一份，和父组件抢所有权。
 *   · 点别处收起：useEffect 的监听器换成 onMounted/onBeforeUnmount，
 *     而且**只在打开时才挂**（打开状态一变的 watch）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Search } from 'lucide-vue-next';
import { META } from '../lib/site.js';
import JellyChips from './JellyChips.vue';

const props = defineProps({
  query: { type: String, default: '' },
  onQuery: { type: Function, default: null },
  size: { type: String, default: '' },
  onSize: { type: Function, default: null },
  sizes: { type: Array, default: () => [] },
});

const open = ref(false);
const boxRef = ref(null);

/**
 * 往下滚（内容往上走）时把工具条收起来，往上滚时放下来。
 * 用户 2026-10-06：「我希望上滑的时候，搜索框和尺码也会滑上去，
 * 但我往下一滑动，搜索框和尺码又能滑下来」—— 就是经典的 hide-on-scroll。
 *
 * 两个阈值都是为了**别太神经质**：
 *   · 每次滚动位移小于 6px 不算 —— 手指的微小抖动、惯性回弹、iOS 地址栏收起
 *     都会产生一两像素的来回，不管它；
 *   · 页面顶部 60px 以内永远露着 —— 在顶上还藏起来会让人以为工具条没了。
 * （144 那条线是"要滚得足够深才值得收"，比 b 站那种一滚就收的手感稳。）
 */
const hidden = ref(false);
let lastY = 0;
function onScrollDir() {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const dy = y - lastY;
  if (Math.abs(dy) < 6) return;
  if (y < 60) hidden.value = false;
  else if (dy > 0 && y > 144) hidden.value = true;
  else if (dy < 0) hidden.value = false;
  lastY = y;
}

/**
 * 尺码那一排：「不限」+ 五个尺码。
 * 「不限」的 value 是空串 —— 和 props.size 的"没选"是同一个值，所以点它等于取消筛选。
 */
const jellyItems = computed(() => [
  { value: '', label: '不限' },
  ...props.sizes.map((s) => ({ value: s, label: s })),
]);

const onDocClick = (e) => {
  if (boxRef.value && !boxRef.value.contains(e.target)) open.value = false;
};

// 点别处就收起（面板展开着却关不掉最烦人）——只有开着的时候才挂监听
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('click', onDocClick);
  else document.removeEventListener('click', onDocClick);
});

onMounted(() => {
  lastY = window.scrollY || 0;
  window.addEventListener('scroll', onScrollDir, { passive: true });
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('scroll', onScrollDir);
});

/**
 * 挑尺码。**延迟 320ms 再收起面板** —— 果冻动画大约 300ms，立刻关掉就白做了。
 * （再点一次同一个不会触发：JellyChips 里挡掉了，和单选框语义一致。取消筛选点「不限」。）
 */
function pickSize(v) {
  props.onSize?.(v);
  setTimeout(() => { open.value = false; }, 320);
}
</script>

<template>
  <div class="toolbar" :class="{ 'toolbar--up': hidden }">
    <div class="wrap">
      <div class="toolbar__row">
        <!-- 搜索框前面加个放大镜（2026-10-06 用户指定 lucide 的 search）。
             外层用 <label> 而不是 <div>：点图标那一片也能聚焦到输入框，
             不用去点中缝。白底和边框也跟着挪到这一层 —— 见 styles.css 里那段说明。 -->
        <label class="searchbox">
          <Search class="searchbox__icon" :size="16" :stroke-width="2" aria-hidden="true" />
          <input
            class="search"
            type="search"
            :value="props.query"
            :placeholder="META.searchPlaceholder"
            :aria-label="META.searchPlaceholder"
            @input="props.onQuery?.($event.target.value)"
          />
        </label>

        <div v-if="props.sizes.length > 0" ref="boxRef" class="sizefilter">
          <button
            class="sizefilter__btn"
            type="button"
            :aria-expanded="open"
            :aria-pressed="!!props.size"
            @click="open = !open"
          >
            尺码{{ props.size ? ' · ' + props.size : '' }}
          </button>
        </div>
      </div>
      <!-- 尺码那一排：**整行展开**，不是浮层。
           2026-10-06 用户：「我点尺码的时候，我希望搜索框下面能空出一些空间，
           容纳选尺码的 xs，xl 这些按钮，而不是单开一个框框」。
           原来它 absolute 定位在按钮下面、自带边框和阴影，像个小弹窗；
           现在挪到 .toolbar__row 外面、下面 —— 工具条因此变高，
           内容自然被往下推，正好"空出一些空间"。 -->
      <div v-if="open" class="sizefilter__pop">
      <!-- 2026-10-06 用户：「选尺码的换成这种风格」（vue-bits 的 jelly-radio）。
      原来每个尺码占满一整行（竖排），果冻效果必须让它们**并排**才推得开。 -->
        <JellyChips :items="jellyItems" :value="props.size" @pick="pickSize" />
      </div>
    </div>
  </div>
</template>
