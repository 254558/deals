<script setup>
/**
 * 一排「果冻」选项 —— 按 vue-bits.dev/micro/jelly-radio 的效果**手写移植**，
 * 不装 Tailwind、不装图标库、不装 motion-v。
 *
 * 用户 2026-10-06：「选尺码的换成这种风格」。
 *
 * ── 效果是什么 ──────────────────────────────────────────────
 * 点中一个：它自己**变胖** ✓、左右邻居被**推开** ✓、回弹时抖两下（果冻感）✓。
 * 原组件靠每帧直接写 `el.style.transform`，**不让 Vue 参与动画**
 * （不然每帧触发一次渲染，几十个 chip 就卡了）—— 这里沿用这个做法。
 *
 * ── 为什么能不用 motion-v ────────────────────────────────────
 * 原组件用了 `motion-v` 的 `animate` / `motionValue`，但真正用到的只有
 * 「一个标量朝目标值做弹簧」这一件事。每个 chip 三个标量（x / sx / sy），
 * 下面 makeValue 三十行就够了 —— 为这一个 `useSpring` 引 15~20 KB 的库不划算。
 *
 * ── 果冻感从哪来 ────────────────────────────────────────────
 * 不是「一个弹簧」——是**两个轴的弹簧参数不一样**：横向 sx 更硬、弹得更多，
 * 纵向 sy 更软、回得更慢。两个轴错开，形状就先胖后抖，看着像果冻。
 * （原组件还有 stagger：离得越远的 chip 延迟越多。这里省掉了 —— 尺码一排
 *   最多七八个，延迟反而显得拖沓；用户要的是"纤细轻盈"，不是"弹来弹去"。）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  /** 选项：字符串数组，或 [{ value, label }] */
  items: { type: Array, default: () => [] },
  /** 当前选中的 value（'' 表示没选） */
  value: { type: String, default: '' },
});
const emit = defineEmits(['pick']);

// —— 参数（对着原组件的默认值调过：swell 0.2 → 0.18，在 12px 的尺码块上
//    0.2 有点晃；barge 6 → 5，一排七八个时推开 6px 会顶到面板边）
const SWELL = 0.18; // 选中的胖多少
const SHRINK = 0.05; // 其余瘦多少
const BARGE = 5; // 往两边推开多少 px
const STIFF = 580; // 弹簧刚度
const BOUNCE = 0.26; // 回弹量（0 = 不弹，1 = 一直弹）
const MASS = 0.9;
const DT = 1 / 60;

const list = computed(() => props.items.map((it) => (typeof it === 'string' ? { value: it, label: it } : it)));

const groupRef = ref(null);
const els = ref([]);
const setEl = (i, el) => { els.value[i] = el; };

/** 一个标量弹簧：欠阻尼 → 过冲 → 回弹 */
function makeValue() {
  return { x: 0, v: 0, t: 0 };
}
const kick = (s, to) => { s.t = to; };
const jump = (s, to) => { s.x = to; s.v = 0; s.t = to; };
/** 推进一帧，返回是否还在动 */
function tick(s, k, bounce) {
  const damping = 2 * Math.sqrt(k * MASS) * (1 - bounce);
  const a = k * (s.t - s.x) - damping * s.v;
  s.v += a * DT;
  s.x += s.v * DT;
  return Math.abs(s.t - s.x) > 0.001 || Math.abs(s.v) > 0.01;
}

const chips = []; // 每个 chip：{ x, sx, sy } 三组弹簧
const chipFor = (i) => {
  if (!chips[i]) chips[i] = { x: makeValue(), sx: makeValue(), sy: makeValue(), x0: 0, sx0: 1, sy0: 1 };
  return chips[i];
};
const xVal = (c) => (c.x0 ?? 0) + c.x.x;
const sxVal = (c) => (c.sx0 ?? 1) * (1 + c.sx.x);
const syVal = (c) => (c.sy0 ?? 1) * (1 + c.sy.x);

/** 把位移直接写进 style —— 不让 Vue 参与动画 */
function paint(i) {
  const el = els.value[i];
  if (!el) return;
  const c = chipFor(i);
  el.style.transform = `translateX(${xVal(c)}px) scale(${sxVal(c)}, ${syVal(c)})`;
}

let raf = 0;
let reduce = false;

function loop() {
  let moving = false;
  const sel = at.value;
  const n = list.value.length;
  const rtl = groupRef.value ? getComputedStyle(groupRef.value).direction === 'rtl' : false;
  for (let i = 0; i < n; i++) {
    const c = chipFor(i);
    const on = i === sel;
    const dir = Math.sign(i - sel) * (rtl ? -1 : 1);
    const w = els.value[i]?.offsetWidth ?? 0;
    const push = (w * SWELL) / 2 + BARGE;
    kick(c.x, dir * push);
    kick(c.sx, on ? SWELL : -SHRINK);
    kick(c.sy, on ? SWELL : -SHRINK);
    // 两个轴的参数不一样 —— 果冻感就是这么来的
    if (tick(c.x, STIFF, BOUNCE)) moving = true;
    if (tick(c.sx, STIFF * 1.24, Math.min(0.85, BOUNCE + 0.3))) moving = true;
    if (tick(c.sy, STIFF * 0.86, BOUNCE)) moving = true;
    paint(i);
  }
  raf = moving ? requestAnimationFrame(loop) : 0;
}

const at = computed(() => Math.max(0, list.value.findIndex((it) => it.value === props.value)));

function applyOnce() {
  if (reduce) {
    for (let i = 0; i < list.value.length; i++) {
      const c = chipFor(i);
      const on = i === at.value;
      c.x.x = 0; c.sx.x = 0; c.sy.x = 0;
      jump(c.x, (Math.sign(i - at.value)) * (((els.value[i]?.offsetWidth ?? 0) * SWELL) / 2 + BARGE));
      jump(c.sx, on ? SWELL : -SHRINK);
      jump(c.sy, on ? SWELL : -SHRINK);
      paint(i);
    }
    return;
  }
  if (!raf) raf = requestAnimationFrame(loop);
}

function pick(it, i) {
  if (it.value === props.value) return;
  emit('pick', it.value, i);
}

watch(() => props.value, () => applyOnce());
watch(() => props.items, () => nextTick(applyOnce));

onMounted(() => {
  reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  applyOnce();
});
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf); });
</script>

<template>
  <div ref="groupRef" class="jellybar" role="radiogroup" aria-label="按尺码筛选">
    <button
      v-for="(it, i) in list"
      :key="it.value || '__all'"
      :ref="(el) => setEl(i, el)"
      class="jellychip"
      type="button"
      role="radio"
      :aria-checked="it.value === props.value"
      :aria-pressed="it.value === props.value"
      @click="pick(it, i)"
    >
      <span class="jellychip__in">{{ it.label }}</span>
    </button>
  </div>
</template>
