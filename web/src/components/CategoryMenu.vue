<script setup>
/**
 * 站名下面展开的分类菜单。
 *
 * 2026-10-06 重写：前一版照 vue-bits BranchedMenu 移植了 SVG 枝杈，
 * 坐标（TRUNK/INDENT/PADL/负偏移 + overflow 裁剪）几轮改下来互相打架，
 * 用户要求「删了重写一个好的」。这一版回到最朴素的树形列表：
 * 纯 CSS 边框画线，没有 SVG、没有负坐标，功能不变。
 *
 * ── 行为 ──
 *   · 点顶层 → 只展开/收起（不算选中）
 *   · 点「全部」（每个分支的第一条，合成项）→ 选中整类 + 收起
 *   · 点某个子类 → 选中它 + 收起
 *   · 再点已选中的那一项 → 取消筛选 + 收起
 *   · **0 件商品的类目（顶层或子类）不渲染**
 *
 * 参考思路：vue-bits BranchedMenu（MIT + Commons Clause, Copyright 2025 David Haz）。
 * 本项目不复用其代码，仅结构相似，故此声明留档。
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
const emit = defineEmits(['pick']);

/** 当前展开的顶层码（同时只展开一支，手机上更清爽） */
const open = ref('');

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

function pick(code) {
  emit('pick', props.value === code ? '' : code);
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

/* 展开箭头（纯 CSS，不引图标） */
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

/* 展开：grid 行高 0fr → 1fr（过渡到内容自然高度） */
.catmenu__fold {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 220ms ease;
}
.catmenu__branch.is-open > .catmenu__fold { grid-template-rows: 1fr; }
.catmenu__kids {
  list-style: none;
  margin: 0 0 0 16px;
  padding: 0;
  overflow: hidden;
  border-left: 2px solid var(--rule-soft);
}

.catmenu__kid {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 6px 0 6px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  color: var(--ink-2, var(--ink-3));
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
/* 每个子项左侧一小段横线，接到分支竖线 */
.catmenu__kid::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 10px;
  border-top: 2px solid var(--rule-soft);
}
.catmenu__kid.is-on { color: var(--red, #e20c18); font-weight: 600; }
.catmenu__kid.is-all { color: var(--ink-4); }
.catmenu__kid.is-all.is-on { color: var(--red, #e20c18); }

@media (prefers-reduced-motion: reduce) {
  .catmenu__fold, .catmenu__top::after { transition: none; }
}
</style>
