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
import { onBeforeUnmount, ref, watch } from 'vue';
import { META } from '../lib/site.js';

const props = defineProps({
  query: { type: String, default: '' },
  onQuery: { type: Function, default: null },
  size: { type: String, default: '' },
  onSize: { type: Function, default: null },
  sizes: { type: Array, default: () => [] },
  note: { type: String, default: '' },
});

const open = ref(false);
const boxRef = ref(null);

const onDocClick = (e) => {
  if (boxRef.value && !boxRef.value.contains(e.target)) open.value = false;
};

// 点别处就收起（面板展开着却关不掉最烦人）——只有开着的时候才挂监听
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('click', onDocClick);
  else document.removeEventListener('click', onDocClick);
});

onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function pick(s) {
  props.onSize?.(s);
  open.value = false;
}
</script>

<template>
  <div class="toolbar">
    <div class="wrap">
      <div class="toolbar__row">
        <input
          class="search"
          type="search"
          :value="props.query"
          :placeholder="META.searchPlaceholder"
          :aria-label="META.searchPlaceholder"
          @input="props.onQuery?.($event.target.value)"
        />

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
          <div v-if="open" class="sizefilter__pop" role="group" aria-label="按尺码筛选">
            <button
              class="sizechip sizechip--all"
              :class="{ 'sizechip--on': !props.size }"
              type="button"
              @click="pick('')"
            >
              不限
            </button>
            <button
              v-for="s in props.sizes"
              :key="s"
              class="sizechip sizechip--all"
              :class="{ 'sizechip--on': props.size === s }"
              type="button"
              :aria-pressed="props.size === s"
              @click="pick(props.size === s ? '' : s)"
            >
              {{ s }}
            </button>
            <p v-if="props.note" class="sizefilter__note">{{ props.note }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
