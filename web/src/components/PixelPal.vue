<script setup>
/**
 * 导航栏里的像素小人。
 *
 * 2026-10-06 用户：「有没有类似开罗或者宝可梦或者星露谷物语的像素人动画，
 * 我希望弄几个放导航栏」。
 *
 * ⚠️ 版权：宝可梦 / 星露谷 / 开罗的素材都是版权作品，不能搬。所以这里是**同风格的
 * 原创像素画** —— 而且正好可以贴题：这个站是「优衣库**捡漏**榜」，
 * 画的是**来捡漏的人**，不是通用的冒险者。
 *
 * 画布的规矩（也是它保持克制的地方）：
 *   · 16×16 的格子，一个字符一个像素；
 *   · 只用站上已有的三个颜色 —— 墨（描边和身体）、品牌红（唯一的亮点：上衣）、
 *     纸白（脸）。不引入第四个颜色；
 *   · 大脑袋 chibi（开罗那个比例：头占一半）；
 *   · 两帧：左右腿交替，身体跟着起伏 1px —— 这就是 8 位机上的原地走动。
 *
 * 渲染方式：把格子拼成一个 <svg> 的 data URI，用 background-image 贴上去。
 * 好处是一个字符都不用进 DOM（否则 16×16 要几百个节点），
 * 而且 image-rendering: pixelated 能保证放大后还是硬边方块。
 */
import { computed } from 'vue';

/** 墨、品牌红、纸白 —— 和站上的令牌是同一批值 */
const PALETTE = { k: '#000f17', r: '#e20c18', w: '#f7f6f4' };

/**
 * 一帧的格子。`.` 是透明。
 * 两帧只在腿部（最后四行）不同，这样循环起来像是原地踏步。
 */
const BODY = [
  '................',
  '.....kkkkkk.....',
  '....kkkkkkkk....',
  '....kwwwwwwk....',
  '....kwkwwkwk....',
  '....kwwwwwwk....',
  '.....kwwwwk.....',
  '...kkkkkkkkkk...',
  '..kkkrrrrrrkkk..',
  '..kkrrrrrrrrkk..',
  '..kkrrrrrrrrkk..',
  '...kkkkkkkkkk...',
];
const LEGS_A = [
  '....kkk..kkk....',
  '....kkk..kkk....',
  '....kkk..kkk....',
  '...kkkk..kkkk...',
];
const LEGS_B = [
  '....kkkk.kkk....',
  '.....kkk.kkk....',
  '.....kkk.kkk....',
  '....kkkk.kkkk...',
];

const FRAMES = [
  [...BODY, ...LEGS_A],
  [...BODY, ...LEGS_B],
];

/** 把一帧的格子拼成 SVG 的 data URI */
function frameToUri(rows) {
  const rects = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      // 横向把同色连成一整块，少写几个 rect（16px 的图够用了）
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[ch]}"/>`);
      x += w;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  // data URI 里 # 必须转义，否则会被当成片段标识
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const props = defineProps({
  /** 放大到多少 px（16 的整数倍最清晰：32 = 两倍，48 = 三倍） */
  size: { type: Number, default: 32 },
  /** 一个循环多少秒 */
  speed: { type: Number, default: 1.1 },
});

const layers = computed(() => FRAMES.map(frameToUri));
</script>

<template>
  <span
    class="pixelpal"
    :style="{ '--pal-size': size + 'px', '--pal-speed': speed + 's' }"
    aria-hidden="true"
  >
    <i class="pixelpal__f pixelpal__f--a" :style="{ backgroundImage: layers[0] }" />
    <i class="pixelpal__f pixelpal__f--b" :style="{ backgroundImage: layers[1] }" />
  </span>
</template>
