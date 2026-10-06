<script setup>
/**
 * 「我的 → 转移码」：把本地的收藏和「待拔草 / 不再出现 / 已隐藏」三本账打成一串码，
 * 换设备时导入。
 *
 * 这一块的文案 2026-10-06 按用户要求删掉了那段说明，只剩两颗按钮 + 输入框；
 * 「怎么用」靠输入框的占位提示和点完之后的反馈说。
 *
 * 2026-10-06 从 React 翻成 Vue：
 *   useState                 → ref
 *   value + onChange         → v-model（**这里可以用 v-model**：输入框的唯一出处
 *                              就是本组件，不像 Toolbar 那个搜索框归父组件所有）
 *   {code && <button/>}      → v-if
 */
import { ref } from 'vue';
import { META } from '../lib/site.js';
import { FAVORITES_KEY } from '../lib/use-watch.js';

const TX_PREFIX = 'GP1.';
const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

const code = ref('');
const hint = ref('');

/** 转移码里打包哪些键：收藏夹 + 「待拔草 / 不再出现 / 已隐藏」三本账 */
function transferKeys() {
  const p = META.storagePrefix;
  return [FAVORITES_KEY, `${p}.picks`, `${p}.dropped`, `${p}.hidden`];
}

/** 导出：把本地那几本账打成一串码 */
function exportCode() {
  const bag = {};
  for (const k of transferKeys()) {
    const v = localStorage.getItem(k);
    if (v) bag[k] = v;
  }
  code.value = TX_PREFIX + b64e(JSON.stringify(bag));
  hint.value = '这串码就是你的收藏和三本账。发到新设备（微信传给自己就行），在那台设备上点「导入」再粘进去。';
}

/** 导入：合并，已有的不动 */
function importCode() {
  const raw = code.value.trim().replace(/\s+/g, '');
  if (!raw.startsWith(TX_PREFIX)) return (hint.value = '这段码不对（应该以 GP1. 开头）');
  let bag;
  try {
    bag = JSON.parse(b64d(raw.slice(TX_PREFIX.length)));
  } catch {
    return (hint.value = '这段码读不出来，可能复制时缺了字符');
  }
  if (!bag || typeof bag !== 'object') return (hint.value = '这段码里没有东西');

  let n = 0;
  try {
    for (const [k, v] of Object.entries(bag)) {
      if (!transferKeys().includes(k) || typeof v !== 'string') continue;
      if (k === FAVORITES_KEY) {
        // 收藏夹要**合并**：按 id 去重，本地已有的为准
        const cur = JSON.parse(localStorage.getItem(k) || '[]');
        const add = JSON.parse(v);
        const have = new Set((Array.isArray(cur) ? cur : []).map((x) => x.id));
        const merged = [...(Array.isArray(cur) ? cur : []), ...(Array.isArray(add) ? add : []).filter((x) => !have.has(x.id))];
        localStorage.setItem(k, JSON.stringify(merged));
        n += merged.length - have.size;
      } else if (!localStorage.getItem(k)) {
        localStorage.setItem(k, v); // 三本账本地没有才导，免得覆盖掉现在的
        n++;
      }
    }
  } catch {
    return (hint.value = '写本地存储失败（可能是隐私模式）');
  }
  hint.value = n ? `导入了 ${n} 项，刷新一下就看到` : '这台设备上本来就有，不用导';
  if (n) setTimeout(() => location.reload(), 900);
}

async function copy() {
  try {
    await navigator.clipboard.writeText(code.value);
    hint.value = '已复制 ✅';
  } catch {
    hint.value = '自动复制不行，手动选中复制吧';
  }
}
</script>

<template>
  <div class="mine__pane">
    <div class="mine__row">
      <button class="btn btn--sm" type="button" @click="exportCode">生成转移码</button>
      <button class="btn btn--sm btn--ghost" type="button" @click="importCode">导入</button>
      <button v-if="code" class="btn btn--sm btn--ghost" type="button" @click="copy">复制</button>
    </div>
    <textarea
      v-model="code"
      class="mine__code"
      rows="4"
      spellcheck="false"
      placeholder="点「生成转移码」会在这里出现一串码；或者把旧设备那串粘进来，再点「导入」"
    />
    <p v-if="hint" class="mine__hint">{{ hint }}</p>
  </div>
</template>
