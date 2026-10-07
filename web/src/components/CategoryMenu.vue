<script setup>
/**
 * 站名下面展开的分类菜单。
 *
 * 2026-10-06 重写：前一版照 vue-bits BranchedMenu 移植了 SVG 枝杈，
 * 坐标几轮改下来互相打架，用户要求「删了重写一个好的」，于是先回到纯 CSS 树。
 * 后来用户又嫌"温度计"动画不够丝滑、点名参考 vue-bits 的 BranchedMenu ——
 * 所以这一版把树的线画回 SVG，照它的做法：一根**连续路径**（竖线顶端 → 圆角 →
 * 横向），用 stroke-dashoffset 一笔画出来，才那么顺。
 *
 * ── 行为 ──
 *   · 点顶层 → 只展开/收起（不算选中）
 *   · 点「全部」（每支第一条，合成项）→ 选中整类
 *   · 点某个子类 → 选中它
 *   · 再点已选中的那一项 → 取消筛选
 *   · **0 件商品的类目（顶层或子类）不渲染**
 *   · 默认展开第一支（女装）
 *
 * ── 动画（照 BranchedMenu）──
 *   reach 路径 = `M 竖线 0 V … A …（圆角）H …`，从竖线顶端一路到子项。
 *   点中某子项 → 该路径 dashoffset 从全长过渡到 0，一笔"流"过去；
 *   画完停一拍 → 淡出 → 面板收起。先竖线后横线是路径顺序天然决定的，不是两段拼的。
 *
 * 参考：vue-bits BranchedMenu（MIT + Commons Clause, Copyright 2025 David Haz）。
 * 本项目不复用其代码，仅几何/动画思路相似，声明留档。
 */
import { computed, ref } from 'vue';

const props = defineProps({
  /** 分类树（只带前两层）：[{ code, name, parent, level, ord }] */
  categories: { type: Array, default: () => [] },
  /** 每个分类码的件数：code -> number（App 里按当前榜单算好） */
  counts: { type: Object, default: () => ({}) },
  /** 当前选中的分类码；空串 = 没筛选 */
  value: { type: String, default: '' },
});
const emit = defineEmits(['pick', 'close']);

/**
 * 当前展开的顶层码（同时只展开一支）。
 * 默认展开第一支（女装）—— 用户 2026-10-06：「女装商品默认展开」。
 */
const open = ref(
  props.categories.find((c) => c.level === 0 && (props.counts[c.code] ?? 0) > 0)?.code ?? ''
);

const n = (code) => props.counts[code] ?? 0;

/** 顶层：只留 >0 件的 */
const tops = computed(() =>
  props.categories.filter((c) => c.level === 0 && n(c.code) > 0)
);

/** 某支的子类：前面合成一条「全部」（code 复用顶层码），只留 >0 件的 */
const kidsOf = (code) => [
  { code, name: '全部', synthetic: true },
  ...props.categories.filter((c) => c.parent === code && n(c.code) > 0),
];

function toggle(code) {
  open.value = open.value === code ? '' : code;
}

/* ═══════════════ SVG 几何（照 BranchedMenu）═══════════════
   所有坐标都在 [0, SVG_W] × [0, SVG_H] 之内，无负值、不靠 overflow:visible。 */
const ROW = 30;   // 子项行高（必须和 CSS 里 .catmenu__kid 的 height 一致）
const TRUNK = 1;  // 竖线 x
const END = 13;   // 横线末端 x（文字缩进前）
const SVG_W = END + 1;
const rowY = (k) => ROW / 2 + k * ROW;
/** 分支：从竖线处**直角**拐到横线（用户 2026-10-06：「我要直角的」） */
const branchD = (k) => `M ${TRUNK} ${rowY(k)} H ${END}`;
/** 主干：从顶端竖到最后一支 */
const trunkD = (count) => `M ${TRUNK} 0 V ${rowY(count - 1)}`;
/** 红线：从顶端竖下 → 直角 → 横向（连续一笔） */
const reachD = (k) => `M ${TRUNK} 0 V ${rowY(k)} H ${END}`;
const lenOf = (k) => rowY(k) + (END - TRUNK);

const anim = ref(false);    // 点没点过（决定红线是否画出来）
const fading = ref(false);  // 画完淡出
let tFade = 0;
let tClose = 0;

function pick(code) {
  // 筛选立刻生效（榜单先变，面板还开着）
  emit('pick', props.value === code ? '' : code);
  // 240ms 一笔画完 → 淡出 → 收起（用户 2026-10-06：「动画快一点，别顿一下才出结果」）
  anim.value = true;
  fading.value = false;
  clearTimeout(tFade);
  clearTimeout(tClose);
  tFade = setTimeout(() => { fading.value = true; }, 340);
  tClose = setTimeout(() => { emit('close'); }, 620);
}
</script>

<template>
  <nav class="catmenu">
    <ul class="catmenu__list">
      <li
        v-for="t in tops"
        :key="t.code"
        class="catmenu__branch"
        :class="{ 'is-open': open === t.code }"
      >
        <button
          class="catmenu__top"
          type="button"
          :aria-expanded="open === t.code ? 'true' : 'false'"
          @click="toggle(t.code)"
        >
          <span class="catmenu__name">{{ t.name }}</span>
          <span class="catmenu__n">{{ n(t.code) }}</span>
        </button>

        <div class="catmenu__fold">
          <ul class="catmenu__kids">
            <!-- 树线：主干 + 每个子项的分支（灰）+ 红线（选中时一笔画出来） -->
            <svg
              class="kids__svg"
              :width="SVG_W"
              :height="kidsOf(t.code).length * ROW"
              :viewBox="`0 0 ${SVG_W} ${kidsOf(t.code).length * ROW}`"
              aria-hidden="true"
            >
              <path class="kids__wire" :d="trunkD(kidsOf(t.code).length)" />
              <path
                v-for="(k, ki) in kidsOf(t.code)"
                :key="'b' + k.code"
                class="kids__wire"
                :d="branchD(ki)"
              />
              <path
                v-for="(k, ki) in kidsOf(t.code)"
                :key="'r' + k.code"
                class="kids__reach"
                :class="{ fading }"
                :d="reachD(ki)"
                :style="{
                  strokeDasharray: lenOf(ki),
                  strokeDashoffset: (anim && props.value === k.code) ? 0 : lenOf(ki),
                }"
              />
            </svg>
            <li v-for="k in kidsOf(t.code)" :key="k.code">
              <button
                class="catmenu__kid"
                type="button"
                :class="{ 'is-on': props.value === k.code, 'is-all': k.synthetic }"
                @click="pick(k.code)"
              >
                {{ k.name }}
              </button>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.catmenu {
  padding: 6px var(--pad, 20px) 10px;
  background: var(--white);
}

.catmenu__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.catmenu__top {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 8px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  color: var(--ink);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.catmenu__name { flex: 1; min-width: 0; }
.catmenu__n { flex: none; font-size: 11px; color: var(--ink-4); font-variant-numeric: tabular-nums; }

/* 展开箭头（纯 CSS） */
.catmenu__top::after {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--ink-4);
  border-bottom: 2px solid var(--ink-4);
  transform: rotate(45deg);
  transition: transform 200ms ease;
}
.catmenu__branch.is-open > .catmenu__top::after {
  transform: rotate(225deg) translate(-2px, -2px);
}

/* 展开：grid 行高 0fr → 1fr */
.catmenu__fold {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1);
}
.catmenu__branch.is-open > .catmenu__fold { grid-template-rows: 1fr; }

.catmenu__kids {
  position: relative;
  list-style: none;
  margin: 0 0 0 16px;
  padding: 0;
  min-height: 0;
  overflow: hidden;
}

.kids__svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
.kids__wire {
  fill: none;
  stroke: var(--rule-soft);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.kids__reach {
  fill: none;
  stroke: var(--red, #e20c18);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke-dashoffset 240ms cubic-bezier(0.23, 1, 0.32, 1),
              opacity 240ms ease 340ms;
  opacity: 1;
}
.kids__reach.fading { opacity: 0; }

.catmenu__kid {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;              /* 必须等于 ROW */
  margin: 0;
  padding: 0 0 0 18px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  color: var(--ink-2, var(--ink-3));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.catmenu__kid.is-on { color: var(--red, #e20c18); font-weight: 600; }
.catmenu__kid.is-all { color: var(--ink-4); }
.catmenu__kid.is-all.is-on { color: var(--red, #e20c18); }

@media (prefers-reduced-motion: reduce) {
  .catmenu__fold, .catmenu__top::after, .kids__reach { transition: none; }
}
</style>
