<script setup>
/**
 * 两个动作：爱心＝收进「待拔草」，闭上的眼睛＝以后不再出现。
 *
 * 这一组对两家完全一致（图标、尺寸、颜色、无障碍文字都一样），所以它没有任何
 * `META` 开关 —— 两家真正的差别是「这两个动作落哪一行」：优衣库在大图卡片的价格行、
 * 列表行的名称下面那一行；迪卡侬在大图卡片的价格行、列表行底部那条 chips 行的行尾。
 * 那是**父组件的排版**，不是这组图标的事。
 *
 * 爱心是**实心**图标（`fill="currentColor"`）。大图卡片里它们落在价格行的右端，
 * 和现价、角标、划线上市价排在同一行，实心的分量才压得住旁边那排数字。
 *
 * 「不再出现」用闭眼（`EyeClosed`），不用垃圾桶、也不用叉号：垃圾桶填成实心就是一只
 * 黑桶，跟一排数字排在一起又重又钝；叉号虽然轻，但它是两条硬邦邦的直线，跟圆润的爱心
 * 并排像两个体系的东西。闭眼是「不看了／不显示」最安静的说法，也正好对上这件商品的状态
 * ——它没被销毁，只是从这张榜上**永久**隐掉了（2026-09-30 起没有放回）。形状上它和
 * 爱心一样是圆润的有机图形，并列不打架。
 *
 * 尺寸不用单独配。lucide 全系画在 24 格上，但字形占多大差很多：叉号只从 6 画到 18，
 * 同尺寸下只有爱心的六成宽；闭眼铺满 2→22，和爱心一样，两者都在 16px 下量到
 * 14.6px 的墨迹跨度，直接同尺寸即可。描边保持 lucide 默认的 2。
 *
 * 爱心既然一律实心，形状就不再表示状态了，收没收改由**颜色**说：静着是未激活控件的
 * 淡灰，收了转品牌蓝（`.dealact--on`）。两家在这一处的取舍不同、但都归这一份代码：
 * 优衣库那份不再另挂 `★ 待拔草` 标签（同一件事讲两遍），迪卡侬那份会再挂一个 ——
 * 那个标签由 `META.features.trackChip` 控制，不在这组图标里。
 *
 * 两个图标都不带底色、不带边框——同一行已经有黄「降幅」角标，再加两个方块就太重了。
 * 文字留在 `.sr-only` 里给读屏，鼠标停上去还有 title。
 *
 * 2026-10-06 从 React 翻成 Vue：这一份几乎是一对一 ——
 *   props      → defineProps
 *   条件类名   → :class 绑定
 *   图标组件   → lucide-vue-next（同样的尺寸与 strokeWidth 写法）
 * 逻辑一行没动。
 */
import { Heart, EyeClosed } from 'lucide-vue-next';

const props = defineProps({
  /** 收了没（决定颜色与无障碍文字） */
  watched: { type: Boolean, default: false },
  onPick: { type: Function, default: null },
  onHide: { type: Function, default: null },
});
</script>

<template>
  <div class="dealacts">
    <button
      type="button"
      class="dealact"
      :class="{ 'dealact--on': props.watched }"
      :aria-pressed="props.watched"
      :title="props.watched ? '移出「待拔草」' : '加进「待拔草」'"
      @click="props.onPick?.()"
    >
      <!-- **实心**（fill="currentColor"）。
           2026-10-06 一度改成描边（那轮在做"纤细轻盈"），同一天用户要求改回来：
           「收藏和删除商品的图标，改回以前那种实心的」。
           实心的作用见文件顶上那段：它和现价、角标、划线上市价排在同一行，
           实心的分量才压得住旁边那排数字。收没收仍然由**颜色**说
           （.dealact--on 转品牌蓝），形状不表示状态。 -->
      <Heart :size="16" :stroke-width="1.75" fill="currentColor" aria-hidden="true" />
      <span class="sr-only">{{ props.watched ? '取消收藏' : '收藏' }}</span>
    </button>

    <button
      type="button"
      class="dealact"
      title="永久隐藏这件：不再出现在榜上，也无法放回"
      @click="props.onHide?.()"
    >
      <!-- 同 size 即可：EyeClosed 跟爱心一样铺满 24 格，量到同样的墨迹跨度。
           **2026-10-06 也填成实心**（用户：「收藏和删除商品的图标，改回以前那种实心的」）——
           它此前一直是描边。注意 lucide 的 EyeClosed 是**一条开口的弧线**（闭着的眼睑），
           填色填出来的是弧线两端的弦所围的那一小片，不是"实心眼"；
           所以这里同时把描边加粗到 2.4，让它和实心爱心是一个分量。 -->
      <EyeClosed :size="16" :stroke-width="2.4" fill="currentColor" aria-hidden="true" />
      <span class="sr-only">永久隐藏</span>
    </button>
  </div>
</template>
