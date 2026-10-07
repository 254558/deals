<script setup>
/**
 * 卡片的图片那一块：图。
 *
 * 为什么要单独一个组件：卡片有两种外壳 —— 叠角标的那种要先包一层定位父盒
 * `.card__picwrap`；优衣库这份不要角标，**必须保持一个光秃秃的 `.picframe`**
 * （多包一层会让原本挂在 .picframe 上的对齐规则失效）。
 * React 那边用一个 `pic` 变量把这段渲染结果共用给两个分支；Vue 的模板没法这么干，
 * 而把这段抄两遍是最糟的选项（20 行，改动时必然只改一处）。所以抽成这个组件。
 *
 * 2026-10-06 从 React 翻成 Vue 时新拆的（React 版里没有这个文件）。
 */
defineProps({
  image: { type: String, default: '' },
  url: { type: String, default: '' },
});
</script>

<template>
  <div v-if="image" class="picframe">
    <a class="piclink" :href="url" target="_blank" rel="noreferrer">
      <!-- 不写 width/height 属性：属性会变成 used height 把 aspect-ratio 顶掉，
           图就被塞进一个非本比例的框里留白。比例靠 CSS 的 aspect-ratio 定
           （优衣库 3:4），所以这里只给 src。

           卡片约 175 CSS px，2x 屏需要 350 —— 400 那档正好够，体积只有 561 的四分之一。
           没有 srcset 时，手机首屏十几张图全是 1200px 的源图，约 700 KB。 -->
      <img
        class="card__img"
        :src="image"
        :srcset="image.replace('@561.', '@400.') + ' 400w, ' + image + ' 561w'"
        sizes="(max-width: 760px) 45vw, 200px"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </a>

  </div>

  <!-- 兜底，正常情况下用不到：payload 里不会有没图的商品（生成时就剔掉了，
       见 core/report.mjs 的 buildPayload）。留着是因为「少一张图」比「一张破图」好看 -->
  <span v-else class="card__img card__img--none" />
</template>
