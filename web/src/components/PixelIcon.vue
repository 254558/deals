<script setup>
/**
 * 像素图标 —— 取自 **Pixelarticons**（https://pixelarticons.com）。
 *
 * 用户 2026-10-06：「里面的收藏，或者删除商品，都从这个里面选图标」。
 * 报头那个机器人（ai-view）也出自同一个库，所以风格是一路的：
 * 24×24、2px 的方块、边缘锐利。
 *
 * 授权：Pixelarticons by Gerrit Halfmann — https://github.com/halfmage/pixelarticons
 *       **MIT**（可商用、可改，保留本声明即可）。
 *
 * 只收**这个站真正用到的两个**，不整包引进来（那个库有八百多个图标）。
 * 路径是从官方 svg 里**原样提取**的，没有手写 —— 手打像素路径必错。
 *
 * 颜色用 currentColor：谁用谁决定颜色。收藏那颗靠 .dealact--on 转品牌蓝，
 * 就是这条在起作用。
 */
import { computed } from 'vue';

const props = defineProps({
  /** heart | eye-off */
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
});

const PATHS = {
  // **实心**爱心：不是库里给的，是从库里的空心 heart **算**出来的 ——
  // 那个库整个是描边式的（heart-filled 是 404）。算法见本文件顶部那段注释：
  // 把它的像素路径反解成矩形 → 画进 24×24 → 从外面灌水 → 灌不到的就是内部 →
  // 边界 + 内部 = 实心。收藏时用这颗，没收藏用库里的空心 heart。
  'heart-filled':
    "M5 2h4v1h-4ZM15 2h4v1h-4ZM5 3h4v1h-4ZM15 3h4v1h-4ZM3 4h8v1h-8ZM13 4h8v1h-8ZM3 5h8v1h-8ZM13 5h8v1h-8ZM1 6h22v1h-22ZM1 7h22v1h-22ZM1 8h22v1h-22ZM1 9h22v1h-22ZM1 10h22v1h-22ZM1 11h22v1h-22ZM3 12h18v1h-18ZM3 13h18v1h-18ZM5 14h14v1h-14ZM5 15h14v1h-14ZM7 16h10v1h-10ZM7 17h10v1h-10ZM9 18h6v1h-6ZM9 19h6v1h-6ZM11 20h2v1h-2ZM11 21h2v1h-2Z",
  // 收藏（空心，库里的原版）
  heart:
    "M13 22h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 16H5v-2h2v2Zm12 0h-2v-2h2v2ZM5 14H3v-2h2v2Zm16 0h-2v-2h2v2ZM3 12H1V6h2v6Zm20 0h-2V6h2v6ZM13 8h-2V6h2v2ZM5 6H3V4h2v2Zm6 0H9V4h2v2Zm4 0h-2V4h2v2Zm6 0h-2V4h2v2ZM9 4H5V2h4v2Zm10 0h-4V2h4v2Z",
  // 不再出现（带斜杠的眼睛）。**不用垃圾桶**：垃圾桶会让人以为"真的删掉了"，
  // 而这个动作只是在本机把它藏起来。
  'eye-off':
    "M0 10h2v4H0zm24 0h-2v4h2zm-8 0h-2v2h2zm-6 0H8v4h2zM2 8h2v2H2zm0 8h2v-2H2zm20-8h-2v2h2zm0 8h-2v-2h2zM4 6h4v2H4zm0 12h4v-2H4zM20 6h-4v2h4zM10 4h6v2h-6zM8 20h8v-2H8zm4-12h2v2h-2zm-2 6h4v2h-4zM8 8h2v2H8zm2 2h2v4h-2zm2 2h2v2h-2z M6 6h2v2H6zM4 4h2v2H4zM2 2h2v2H2zm12 12h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z",
};

const d = computed(() => PATHS[props.name] ?? '');
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>
