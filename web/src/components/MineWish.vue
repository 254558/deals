<script setup>
/**
 * 「我的 → 许愿」：一块入口，点出去到**许愿墙**（wookao.icu）。
 *
 * 用户 2026-10-10：「再加一个：许愿……用户点击 wookao.icu，就会进入一个叫许愿墙的
 * 网站，他可以在这个网站许愿让别人送她衣服」。
 *
 * 许愿墙是**另一个站点**，不在这份报告里 —— 报告是双击就能打开的本地单文件，
 * 只有收藏和转移码那两块是纯本地的（localStorage）。所以这一块只放一条外链：
 *   · 用 <a> 而不是 <button>：交给浏览器原生打开，新标签页里看。
 *     报告常常是 file:// 打开的，同页跳走就回不来了，所以一定要 target="_blank"。
 *   · rel="noreferrer"：和报头那组兄弟报告入口（Masthead.vue）保持一致。
 *
 * 2026-10-10 用户改过两次：先要一句说明 + 一颗写着 wookao.icu 的链接，
 * 随后「删除这个文字……按钮就写点击许愿」—— 于是只剩一颗按钮，文案是「点击许愿」，
 * 域名不再出现在界面上（藏在 href 里）。
 *
 * 地址写成一个常量而不是散在模板里：将来要换域名只改这一行。
 */
const WISH_URL = 'https://wookao.icu';
</script>

<template>
  <div class="mine__pane">
    <a class="mine__wish" :href="WISH_URL" target="_blank" rel="noreferrer">点击许愿</a>
  </div>
</template>
