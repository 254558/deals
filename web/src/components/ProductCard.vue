<script setup>
/**
 * 大图卡片。骨架是：图 → 名称 → 价格行 → 标尺 / 状态行 → chips。
 *
 * 两家的卡片是**同一个骨架**，但信息层级和几何都不一样，所以每一处差异都挂一个
 * `META.features` 开关，组件里没有一处站点判断：
 *
 *   stickerTags   商品图上的角标（迪卡侬的 尾货/新品）
 *   brandMark     名称前那块品牌小字（迪卡侬）
 *   priceOffBadge 价格行里的黄底 `降 N 元` 角标（迪卡侬）。优衣库把降幅挪到了
 *                 下面那根比例条的条尾（红字）
 *   dealBarNumber 比例条尾部的红色降幅数字（优衣库）。同一件事不说两遍
 *   cardChips     卡片底部的 chips 行。**没有标签也照样留着**：它的 `margin-top: auto`
 *                 + `min-height` 托住卡片底边，整排卡片的底对齐才不会被带歪
 *
 * 几何（图片比例、网格列宽、卡片要不要 padding、名称怎么截断）全部在 styles.css 的
 * `[data-site=…]` 作用域里，这一层只管结构。
 *
 * 2026-10-06 从 React 翻成 Vue，有三处值得记：
 *   · 原来在函数体里算的一串常量（sizeLine / now / was / cut / gone / text / delay）
 *     → computed。**必须**是 computed 而不是普通 const：它们依赖 props，
 *     props 一变就得跟着重算（React 那边每次渲染都会重跑函数体，天然如此）。
 *   · 那段 `{gone ? … : rate > 0 ? (dealBarNumber ? A : B) : C}` 的三层嵌套三元
 *     → v-if / v-else-if / v-else。**拆平之后好读多了** —— 这不是为了迁就 Vue，
 *     是 Vue 逼着把它摊开，反而回到了它本来该有的样子。
 *   · `style={{ '--w': … }}` → `:style`，自定义属性照样能绑。
 */
import { computed } from 'vue';
import { BadgeJapaneseYen } from 'lucide-vue-next';
import { chips, goneNote, num, priceParts, tagLabel } from '../lib/format.js';
import { META } from '../lib/site.js';
import CardActions from './CardActions.vue';
import CardPicture from './CardPicture.vue';

/**
 * 这一行最多列几档尺码，超了就只写「剩 N 档」。
 *
 * 尺码改成 kbd 方块之后重量的（1440 宽时那行可用 322px）：方块比「 · 」分隔宽，
 * 能排一行的上限跟着降——童装厘米码只到 5 档，腰围厘米码到 6 档、字母码到 8 档。
 * 取最保守的 5。再多就折成第二行，一折就把同一行卡片的价格线顶歪。
 */
const MAX_SIZE_LABELS = 5;

const props = defineProps({
  deal: { type: Object, required: true },
  index: { type: Number, default: 0 },
  onPick: { type: Function, default: null },
  onHide: { type: Function, default: null },
});

const feats = META.features;

/**
 * 图片左下角那块「剩下哪些尺码」（2026-10-01 起压在图上，不再占名字那一行）：
 *   码全 / 没有尺码信息 → 不显示
 *   断码                → 显示剩下哪些尺码
 *   **全是 cm 的量体尺码 → 不显示**：优衣库那批「53cm / 58cm」压在图上很难看
 *                        （用户 2026-10-01：「遇到 cm 的断码的，就别显示了，很难看」）。
 *   混着的时候只去掉 cm 那几个，正常的 S / M / L 照旧显示。
 */
const sizeLine = computed(() => {
  const allLabels = props.deal.sizes?.labels ?? [];
  const labels = allLabels.filter((l) => !/cm/i.test(String(l)));
  const sizes = props.deal.sizes;
  if (!sizes || sizes.full) return null;
  if (allLabels.length > 0 && labels.length === 0) return null; // 全是 cm：整条不显示
  if (labels.length > MAX_SIZE_LABELS) return { lead: '', text: `剩 ${sizes.count} 档`, plain: `剩 ${sizes.count} 档` };
  if (labels.length) return { lead: '剩余：', labels, plain: labels.join(' · ') };
  return { lead: '', text: `剩 ${sizes.count} 档`, plain: `剩 ${sizes.count} 档` };
});

// 动效错开只给前几行，否则滚到下面时动画早跑完了
const now = computed(() => priceParts(props.deal.price));
const was = computed(() => priceParts(props.deal.launchPrice));
const cut = computed(() => props.deal.launchPrice > props.deal.price);
// 连续两轮没在抓取池里见到（只有手动 track 的商品会带着这个标记进来，见 db.mjs 的 missed）
const gone = computed(() => props.deal.gone === true);
const text = computed(() => chips(props.deal.tags));
/**
 * 降幅条：**一排 12 根竖条**，亮到降幅位置为止（用户 2026-10-06：
 * 「把降了多少钱左边的条换成这种样式」，给的是 vue-bits 的 wake-slider 截图）。
 *
 * 原来是一根轨道 + 一条填充（宽度 = 降幅%）。改成竖条是为了：
 *   · 读起来是**刻度**不是"进度"—— 一眼能数出"亮了 9 格 / 一共 12 格"；
 *   · 数字（降 190 元）隔壁有这么一排小竖条，比一根实心横条轻。
 *
 * 只取它**静止时的长相**，不做尾迹：那个尾迹要「有人在拖」才出现，
 * 而降幅是印在卡上的一个静态数字 —— 没有任何东西在动它。
 */
// 12 → 24（2026-10-06）：参照图里是 ~32 根**细**条，12 根在卡片宽度下太胖，
// 像积木不像刻度。24 根配 4px 上限，密度和细度都贴近参照图。
// 25 → 23 → 21 → **25**。这条曲线是跟着"一行里还有什么"走的：
//   加图标进这一行 → 条被挤窄 → 得减格子（25→23→21）；
//   图标又挪走了（去当价格的 ¥ 了）→ 条宽回来约 19px → 格子加回去（21→25）。
// 25 格 = 25×3 + 24×2 = 123px，在 133px 的盒子里留出约 10px ——
// 正是用户先前就定过的那个距离。**改这一行之前先量"条到文字"是多少。**
const BAR_SEGMENTS = 25;
const barFilled = computed(() => Math.max(0, Math.min(BAR_SEGMENTS, Math.round(props.deal.rate * BAR_SEGMENTS))));

// 名字**原样显示**，不再按斜杠截断。
//
// 2026-10-06 用户：「商品名，写成和官网一样的，比如
// 男装/男女同款 UT Disney x F1®印花T恤/短袖T恤 488131，这种……现在用户反馈说要全的」。
// 这里原先写的是 `name.split('/')[0]`（只留斜杠前面那半段）。现在照原样渲染；
// 长出去的部分由 CSS 的省略号兜着，`title` / `aria-label` 里始终是全名。
</script>

<template>
  <!-- data-id：浏览进度按**商品 id** 锚定（见 lib/browse-memory.js）。
       回来时靠它找到「上次压着工具条下沿的那一件」。只是属性，不影响渲染。 -->
  <article class="card" role="listitem" :data-id="props.deal.id">
    <!-- 角标只有在 stickerTags 打开时才需要一个定位父盒（迪卡侬），
         否则就保持「一个光秃秃的 .picframe」——多包一层会让原本挂在
         .picframe 上的对齐规则失效。
         图片那一块本身抽成了 CardPicture：两种外壳要渲染同样的内容，
         而模板不能像 React 那样用一个变量把渲染结果共用出去。 -->
    <div v-if="feats.stickerTags" class="card__picwrap">
      <CardPicture :image="props.deal.image" :url="props.deal.url" :size-line="sizeLine" />
      <!-- 角标贴在图上：红＝尾货清仓、灰＝新品 -->
      <span v-for="t in text" :key="t" class="tagbox" :class="`tagbox--${t}`">{{ tagLabel(t) }}</span>
    </div>
    <CardPicture v-else :image="props.deal.image" :url="props.deal.url" :size-line="sizeLine" />

    <!-- 名称那一行：**整行是链接**（两行截断由 CSS 兜住） -->
    <a
      class="card__name"
      :href="props.deal.url"
      target="_blank"
      rel="noreferrer"
      :title="props.deal.name"
      :aria-label="sizeLine ? `${props.deal.name}　${sizeLine.lead}${sizeLine.plain}` : props.deal.name"
    >
      {{ props.deal.name }}
    </a>

    <!-- 价格三件套，右端跟着收藏 / 不再出现两个动作 -->
    <div class="card__prices">
      <span class="card__now n" :class="{ 'card__now--flat': !(props.deal.rate > 0 && !gone) }">
        <!-- ¥ 符号换成 lucide 的 **badge-japanese-yen**（一个圆圈里一个 ¥）——
             2026-10-06 用户先要「钞票图标替换 ¥」，接着改主意：「换成这个图标，
             放价格左下角，就和以前的 ¥ 一样小」。
             尺寸跟旧的 ¥ 一样是 13px（那是 .now__sym 原来的字号），靠 CSS 的
             vertical-align 把它压到**左下角**。
             图标是 stroke=currentColor，所以跟着价格的颜色走 —— 现价红的它就红。
             **¥ 本身仍用 sr-only 留着**：不然读屏器念价格只剩「59」，丢了币种。 -->
        <span class="now__sym">
          <span class="sr-only">{{ now.sym }}</span>
          <BadgeJapaneseYen :size="11" :stroke-width="2" aria-hidden="true" />
        </span>
        <span class="now__int">{{ now.int }}</span>
        <span class="now__dec">{{ now.dec }}</span>
      </span>
      <!-- 迪卡侬：官网把折扣写成「6.0折」，这里写降幅，和榜单、排序的口径一致 -->
      <span v-if="feats.priceOffBadge && props.deal.rate > 0 && !gone" class="offbadge n">
        降 {{ num(Math.round(props.deal.saving)) }} 元
      </span>
      <span v-if="cut" class="card__was n">{{ was.sym }}{{ was.int }}{{ was.dec }}</span>
      <CardActions :watched="props.deal.tracked" :on-pick="props.onPick" :on-hide="props.onHide" />
    </div>

    <div v-if="gone" class="card__deal card__deal--flat" :class="{ 'card__deal': feats.dealBarNumber }">
      {{ goneNote(props.deal.lastSeenAt) }}
    </div>
    <!-- 优衣库：比例条和降幅红字同行，红字贴在条尾，条占满剩余宽度。
         直接说「降 190 元」——省下的钱是实打实的数，百分比还得自己换算 -->
    <div v-else-if="props.deal.rate > 0 && feats.dealBarNumber" class="card__deal">
      <!-- [降幅条] 降 190 元。2026-10-06 那个钞票图标先在这行待过一阵，
           后来用户说「把这个图标删了，换到价格前面」—— 它现在去当价格的 ¥ 符号了
           （见上面的 .card__now）。 -->
      <span class="card__bar" aria-hidden="true"><i v-for="s in BAR_SEGMENTS" :key="s" :class="{ 'is-on': s <= barFilled }" /></span>
      <span class="card__off n">降 {{ num(Math.round(props.deal.saving)) }} 元</span>
    </div>
    <!-- 迪卡侬：只有一根条，长度同样等于降幅 -->
    <span v-else-if="props.deal.rate > 0" class="card__bar" aria-hidden="true"><i v-for="s in BAR_SEGMENTS" :key="s" :class="{ 'is-on': s <= barFilled }" /></span>
    <div v-else class="card__deal--flat" :class="{ 'card__deal': feats.dealBarNumber }">尚未降价，正在替你盯着</div>

    <!-- 这一行现在只剩「待拔草」标签；没有标签也照样留着，托住卡片底边 -->
    <div v-if="feats.cardChips" class="card__chips">
      <span v-if="feats.trackChip && props.deal.tracked" class="chip chip--tracked">★ 待拔草</span>
    </div>
  </article>
</template>
