<script setup>
/**
 * 卡片的图片那一块：图 + 压在左下角的断码尺码。
 *
 * 为什么要单独一个组件：卡片有两种外壳 —— 迪卡侬那份要在图上再叠角标，
 * 得先包一层定位父盒 `.card__picwrap`；优衣库那份不要角标，**必须保持
 * 一个光秃秃的 `.picframe`**（多包一层会让原本挂在 .picframe 上的对齐规则失效）。
 * React 那边用一个 `pic` 变量把这段渲染结果共用给两个分支；Vue 的模板没法这么干，
 * 而把这段抄两遍是最糟的选项（20 行，改动时必然只改一处）。所以抽成这个组件。
 *
 * 2026-10-06 从 React 翻成 Vue 时新拆的（React 版里没有这个文件）。
 */
defineProps({
  image: { type: String, default: '' },
  url: { type: String, default: '' },
  sizeLine: { type: Object, default: null },
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

    <!-- 断码的剩余尺码压在**图片左下角**（用户 2026-10-01：「弄到图片左下角，
         和图片重叠在一起，不要占标题的位置」）。它排在 <a> 外面，不改变链接的
         点击范围；CSS 里再补 pointer-events: none，点它等于点图片。
         「剩余」这两个字不显示（用户 2026-10-01：「删掉剩余两个字」），
         但仍留在 aria-label 里，读屏听到的是「商品名　剩余：S M L」。 -->
    <span v-if="sizeLine" class="card__sizes">
      <!-- 每一档包一个 <kbd>：方形、细边、浅底，像键盘键帽。
           语义上 <kbd> 本来是「用户输入」，这里纯粹借它的方块外观 -->
      <template v-if="sizeLine.labels">
        <kbd v-for="l in sizeLine.labels" :key="l" class="sizekey">{{ l }}</kbd>
      </template>
      <span v-else class="cardsizes__list">{{ sizeLine.text }}</span>
    </span>
  </div>

  <!-- 兜底，正常情况下用不到：payload 里不会有没图的商品（生成时就剔掉了，
       见 core/report.mjs 的 buildPayload）。留着是因为「少一张图」比「一张破图」好看 -->
  <span v-else class="card__img card__img--none" />
</template>
