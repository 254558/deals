<script setup>
/**
 * 「我的 → 收藏」：报告里点过爱心的那些商品，快照存在 localStorage。
 *
 * 报告可能是 file:// 打开的，那时 `/uniqlo/img/x.webp` 这种绝对路径解不出来 ——
 * 所以下面渲染图片时统一走 `imgSrc()` 去掉开头的斜杠。
 *
 * 取消收藏时**同时要改那三本账**（picks / dropped），不然刷新一下爱心又亮回来 ——
 * 这段逻辑从原来的 MinePanel 搬过来，一行没改。
 *
 * 2026-10-06 从 React 翻成 Vue：
 *   useState + useEffect(…, []) → ref + 顶层直接读一次（script setup 本来就在挂载前跑）
 *   useCallback(…, [favs])      → 普通函数（Vue 不需要稳定引用）
 *   `.map()` 里的 JSX            → v-for
 */
import { ref } from 'vue';
import { Trash } from 'lucide-vue-next';
import { META } from '../lib/site.js';
import { FAVORITES_KEY } from '../lib/use-watch.js';

const favs = ref([]);

// 挂上来就重读一遍：可能刚在报告里点过爱心
try {
  const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  favs.value = Array.isArray(v) ? v : [];
} catch {
  favs.value = [];
}

/** 报告可能是 file:// 打开的，那时绝对路径解不出来 —— 去掉开头的斜杠 */
function imgSrc(u) {
  const s = String(u || '');
  return location.protocol === 'file:' && s.startsWith('/') ? s.slice(1) : s;
}

function removeFav(id) {
  const one = favs.value.find((x) => x.id === id);
  favs.value = favs.value.filter((x) => x.id !== id);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs.value));
    if (one?.prefix) {
      const pk = `${one.prefix}.picks`;
      const dk = `${one.prefix}.dropped`;
      const picks = new Set(JSON.parse(localStorage.getItem(pk) || '[]'));
      const dropped = new Set(JSON.parse(localStorage.getItem(dk) || '[]'));
      picks.delete(id);
      dropped.add(id);
      localStorage.setItem(pk, JSON.stringify([...picks]));
      localStorage.setItem(dk, JSON.stringify([...dropped]));
    }
  } catch { /* 存不下就算了 */ }
}
</script>

<template>
  <div class="mine__pane">
    <p v-if="!favs.length" class="mine__empty">还没收藏。回到榜单点商品卡片上的爱心，就会出现在这里。</p>

    <div v-else class="mine__favs">
      <div v-for="f in favs" :key="f.id" class="fav">
        <a class="fav__link" :href="f.url" target="_blank" rel="noreferrer">
          <img class="fav__img" :src="imgSrc(f.image)" alt="" loading="lazy" />
          <span class="fav__body">
            <span class="fav__name">{{ f.name }}</span>
            <span class="fav__price">{{ f.currency || META.currency?.sym || '¥' }}{{ f.price }}</span>
          </span>
        </a>
        <!-- 移除收藏用**垃圾桶**（2026-10-06 用户指定 lucide 的 trash）。
             原来是个文字「×」—— 和站上其它图标不是一套写法，也说不清"删除"。 -->
        <button class="fav__del" type="button" aria-label="取消收藏" @click="removeFav(f.id)">
          <Trash :size="15" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
