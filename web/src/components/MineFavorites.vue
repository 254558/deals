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
 * 2026-10-06 从 React 翻成 Vue；同一天把"点垃圾桶"换成**左滑删除**（用户：
 * 「删除收藏改成左滑删除，类似 iPhone 短信的左滑删除」）。手势这套写法照 iOS 的来：
 *   · 拖得浅（没到 OPEN_AT）→ 弹回去；
 *   · 拖到 OPEN_AT 以上松手 → **停在滑开状态**，红色"删除"露着，再点它才删；
 *   · 一口气拖过 SWIPE_AT → 直接删（iOS 上"滑到底"就是这个效果）。
 * 所以误删的门槛不低：要么滑到底，要么滑开之后再点一下。
 *
 * 三个必须写对的地方：
 *   1. **竖着滑要放行**。手指在列表上竖滑是"滚页面"，不能被我们吃掉 ——
 *      第一次 move 就比 |dx| 和 |dy|，竖的大就整个放弃这次手势。
 *      外加 CSS 的 touch-action: pan-y，双保险。
 *   2. **拖完不能触发链接跳转**。被拖的那一层整个是个 <a>，松手浏览器还会补一次 click，
 *      不拦就会跳去商品页。moved 为真时在 click 里 preventDefault。
 *   3. **拖动过程中关掉 transition**，否则位移会追着手指慢慢飘。
 */
import { onBeforeUnmount, ref } from 'vue';
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

/* ── 左滑删除 ── */
const OPEN_X = -88;    // 停在滑开状态时的位移（"删除"那块正好露出来）
const OPEN_AT = 44;    // 松手时拖过这么多 → 停在滑开状态
const SWIPE_AT = 190;  // 一口气拖过这么多 → 直接删

const dragId = ref('');   // 正在被拖的那一行
const dragX = ref(0);     // 它的当前位移（负数）
const openId = ref('');   // 已经滑开、停住的那一行
const goingId = ref('');  // 正在播删除动画的那一行

let startX = 0;
let startY = 0;
let baseX = 0;      // 这一行拖动前的位移（滑开着的行再拖，要从 OPEN_X 起算）
let tracking = false;
let decided = false;
let moved = false;

/** 每一行该用的位移 */
function fx(id) {
  if (goingId.value === id) return 'translateX(-110%)';        // 删除：整条滑出去
  if (dragId.value === id) return `translateX(${dragX.value}px)`;
  if (openId.value === id) return `translateX(${OPEN_X}px)`;
  return 'translateX(0)';
}

function stop() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  tracking = false;
}

function onDown(e, id) {
  if (goingId.value || e.button > 0) return;
  dragId.value = id;
  baseX = openId.value === id ? OPEN_X : 0;
  dragX.value = baseX;
  startX = e.clientX;
  startY = e.clientY;
  tracking = true;
  decided = false;
  moved = false;
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function onMove(e) {
  if (!tracking) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  if (!decided) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;  // 还没真动
    decided = true;
    // 竖着滑得更多 → 这是"滚页面"，整场手势放弃
    if (Math.abs(dy) > Math.abs(dx)) { stop(); dragId.value = ''; dragX.value = 0; return; }
  }

  moved = true;
  let x = baseX + dx;
  if (x > 0) x = 0;                                     // 往右不给拖
  if (x < OPEN_X) x = OPEN_X + (x - OPEN_X) * 0.45;     // 拖过删除区之后加阻尼
  dragX.value = x;
}

function onUp() {
  const id = dragId.value;
  const x = dragX.value;
  const didMove = moved;
  stop();
  dragId.value = '';
  dragX.value = 0;
  if (!id || !didMove) return;

  if (x <= -SWIPE_AT) startDelete(id);                  // 滑到底 → 直接删
  else if (x <= -OPEN_AT) openId.value = id;            // 停在滑开状态
  else openId.value = '';                               // 弹回去
}

/** 拖过就不算点击 —— 否则松手会顺手跳去商品页 */
function onLinkClick(e) {
  if (moved || openId.value) {
    e.preventDefault();
    moved = false;
    if (openId.value) openId.value = '';                // 已经滑开时点一下 = 收起来
  }
}

function startDelete(id) {
  goingId.value = id;
  setTimeout(() => {
    removeFav(id);
    goingId.value = '';
    if (openId.value === id) openId.value = '';
  }, 220);                                              // 等滑出去的动画播完
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

// 组件被卸载时把 window 上的监听摘掉（拖到一半切走「我的」的情况）
onBeforeUnmount(stop);
</script>

<template>
  <div class="mine__pane">
    <p v-if="!favs.length" class="mine__empty">还没收藏。回到榜单点商品卡片上的爱心，就会出现在这里。</p>

    <div v-else class="mine__favs">
      <!-- 2026-10-06 用户：「删除收藏改成左滑删除，类似 iPhone 短信的左滑删除」。
           所以这一行是**两层叠着**：底下是红色的"删除"（滑开才露出来），
           上面是那一整条商品（<a>，被拖着走）。 -->
      <div
        v-for="f in favs"
        :key="f.id"
        class="fav"
        :class="{ 'fav--drag': dragId === f.id, 'fav--going': goingId === f.id }"
      >
        <button
          class="fav__delete"
          type="button"
          :tabindex="openId === f.id ? 0 : -1"
          :aria-hidden="openId === f.id ? 'false' : 'true'"
          @click="startDelete(f.id)"
        >删除</button>

        <!-- draggable="false" + @dragstart.prevent 是**必须的**：
             这一层整个是个 <a>，里面还嵌了 <img>，浏览器默认把"按住拖动"当成
             原生链接/图片拖放 —— 于是它一发 dragstart 就给我们 pointercancel，
             手势当场作废（实测：鼠标模式 down:1 move:1 **cancel:1**、位移 0；
             触摸模式没有这个问题，所以一开始只在手机上试是看不出来的）。
             另外 <img> 自己也要写 draggable="false"：img 默认单独可拖。 -->
        <a
          class="fav__link"
          :href="f.url"
          target="_blank"
          rel="noreferrer"
          draggable="false"
          @dragstart.prevent
          :style="{ transform: fx(f.id) }"
          @pointerdown="onDown($event, f.id)"
          @click="onLinkClick"
        >
          <img class="fav__img" :src="imgSrc(f.image)" alt="" loading="lazy" draggable="false" />
          <span class="fav__body">
            <span class="fav__name">{{ f.name }}</span>
            <span class="fav__price">{{ f.currency || META.currency?.sym || '¥' }}{{ f.price }}</span>
          </span>
        </a>
      </div>
    </div>
  </div>
</template>
