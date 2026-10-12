<script setup>
/**
 * 「我的」——报告里的一个视图，**三块：收藏 / 转移码 / 许愿**。
 *
 * 用户 2026-10-06：「我的里面就放：收藏，转移码就好，别的都删掉」。
 * 用户 2026-10-10 加回第三块「许愿」：点出去到许愿墙（wookao.icu），见 MineWish.vue。
 * 这一块原来是独立的一页（/market/?mine=1，跟着「有品」市集走），那天市集整个删了，
 * 于是把它收进报告本身：报告是双击就能打开的单文件，而收藏和转移码**本来就是纯本地的**
 * （localStorage，没有服务端），放进来自带两个好处——离线可用、少一套部署。
 *
 * 2026-10-06 从 React 翻成 Vue。这里有个**习惯差异**值得记下来：
 *   React 那边三个组件可以写在一个 .jsx 里（一个文件导出多个）；
 *   Vue 一个 .vue 就是一个组件，所以拆成了三个文件，这个只当壳。
 *   下面那两个 import 进来的组件，在 `<script setup>` 里 import 之后就自动可用，
 *   不用再写 components 注册表。
 *
 * 状态那一层一一对应：useState → ref，`{tab === 'favs' ? <A/> : <B/>}` → v-if / v-else。
 *
 * 键的来历见 lib/use-watch.js（收藏夹 + 三本账都在那儿定义）。
 */
import { ref } from 'vue';
import MineFavorites from './MineFavorites.vue';
import MineTransfer from './MineTransfer.vue';
import MineWish from './MineWish.vue';

const TAB_FAVS = 'favs';
const TAB_TRANSFER = 'transfer';
const TAB_WISH = 'wish';
const tab = ref(TAB_FAVS);
</script>

<template>
  <div class="mine">
    <div class="wrap">
      <!-- 这一块**没有标题**：顶上导航那一行已经说明了在哪（左边 GoodPrices、
           右边「优衣库」），再来一行「我的」是重复。
           用户 2026-10-06：「点到我的后，删掉导航栏下面的那个我的两个字」。
           也没有自己的「返回/关闭」——右边那条「优衣库」就是回榜单的路。 -->
      <div class="mine__tabs" role="tablist">
        <button
          class="mine-tab"
          :class="{ 'mine-tab--on': tab === TAB_FAVS }"
          type="button"
          role="tab"
          :aria-selected="tab === TAB_FAVS"
          @click="tab = TAB_FAVS"
        >
          收藏
        </button>
        <button
          class="mine-tab"
          :class="{ 'mine-tab--on': tab === TAB_TRANSFER }"
          type="button"
          role="tab"
          :aria-selected="tab === TAB_TRANSFER"
          @click="tab = TAB_TRANSFER"
        >
          转移码
        </button>
        <button
          class="mine-tab"
          :class="{ 'mine-tab--on': tab === TAB_WISH }"
          type="button"
          role="tab"
          :aria-selected="tab === TAB_WISH"
          @click="tab = TAB_WISH"
        >
          许愿
        </button>
      </div>

      <MineFavorites v-if="tab === TAB_FAVS" />
      <MineTransfer v-else-if="tab === TAB_TRANSFER" />
      <MineWish v-else />
    </div>
  </div>
</template>
