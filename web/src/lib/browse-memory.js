/**
 * 记住「读到哪儿了」（浏览进度）。
 *
 * 用户 2026-10-05：「我浏览很久，不小心跳出去了，再回到这个页面，又要从头开始往下翻，
 * 能不能做个保存当前浏览进度的功能，就类似 vue 的 keep-alive 那种」。
 *
 * 为什么不能只靠浏览器自己还原滚动位置：报告是**分批渲染**的（首屏 10 张，往下滑再补），
 * 回来时 DOM 里只有最初那 10 张，文档根本没有原来那么高 —— 浏览器想还原也无处可落，
 * 只能停在顶部。所以要把**渲染了多少张**一起存下来：先按它渲染，再把滚动位置放回去。
 *
 * 存的是一份**快照**：渲染张数 + 滚动位置 + 当时的搜索词。三个必须一起存 ——
 * 只还原位置而不还原搜索词，回来看到的是**另一批商品**，那个位置就毫无意义。
 *
 * 什么情况下宁可不还原（把人送到错的地方比从头开始更糟）：
 *   · 报告数据换过（`generatedAt` 变了）—— 报告每天重建，旧位置对不上新列表
 *   · 超过 MAX_AGE（12 小时）—— 隔天再回来，重新看一遍是合理的
 *   · 两份报告同源共用 localStorage，所以 key 里必须带站点，别互相串
 */
const MAX_AGE = 12 * 3600 * 1000;
const keyOf = (site) => `deals.browse.${site}`;

export function loadProgress(site, rev, now = Date.now()) {
  try {
    const raw = localStorage.getItem(keyOf(site));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.rev !== rev) return null;
    if (!Number.isFinite(s.at) || now - s.at > MAX_AGE) return null;
    return {
      visible: Math.max(0, Math.floor(Number(s.visible) || 0)),
      scrollY: Math.max(0, Math.floor(Number(s.scrollY) || 0)),
      query: typeof s.query === 'string' ? s.query : '',
    };
  } catch {
    return null; // 存坏了就当没有 —— 绝不能让一份坏快照把报告弄打不开
  }
}

export function saveProgress(site, rev, state, now = Date.now()) {
  try {
    localStorage.setItem(keyOf(site), JSON.stringify({ rev, at: now, ...state }));
  } catch {
    // 隐私模式 / 配额满：记不住就算了，不能因此报错
  }
}

export function clearProgress(site) {
  try {
    localStorage.removeItem(keyOf(site));
  } catch {
    // 同上
  }
}
