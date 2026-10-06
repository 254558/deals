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
 * 存的是一份**快照**：渲染张数 + 锚点商品 + 当时的搜索词 + 尺码筛选。
 * 只还原位置而不还原搜索词，回来看到的是**另一批商品**，那个位置就毫无意义。
 *
 * ── 2026-10-06：位置从「滚了多少像素」改成**按商品 id 锚定** ──────────────
 * 原来是存 `scrollY` 的。问题是报告**每小时**重建一次（定时任务抓价 → 重建 →
 * 推 Cloudflare），列表一变，同一个像素高度就落在了另一件商品上；而当时还有个
 * `rev === generatedAt` 的判断，`generatedAt` 每小时都变，于是快照实际只在
 * **一个小时之内**有效 —— 用户离开一会儿再回来就从头开始了。
 * （那段注释里写的「报告每天重建」是写的时候的事实，后来定时任务改成每小时，
 *   没人回头看它 —— 这就是为什么那个 12 小时的 `MAX_AGE` 一直没起作用。）
 *
 * 现在改成：记「**压着工具条下沿的是哪件商品**」（`anchor`）以及它当时相对
 * 工具条下沿的偏移（`anchorOffset`）。回来时先按 `visible` 渲染那么多张，
 * 再找到那件商品、把它放回原来的位置。这样：
 *   · 报告重建过也照样对（认得是同一件商品，不是同一个像素）
 *   · 那件商品掉榜了 → **退回顶部**，不硬塞一个错位置
 *   · 所以 `rev` 那个判断也一起撤了 —— 锚点自己会校验
 *
 * 仍然宁可不还原的情况：
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
    if (!s) return null;
    // ⚠️ 这里原来还有一条 `s.rev !== rev` 就直接作废。撤掉了：rev 是报告的
    // generatedAt，每小时都变，一卡就只剩一小时有效；而位置现在是**按商品 id
    // 锚定**的，report 重建过也认得出来，锚点找不到时调用方会退回顶部。
    if (!Number.isFinite(s.at) || now - s.at > MAX_AGE) return null;
    return {
      visible: Math.max(0, Math.floor(Number(s.visible) || 0)),
      // 老的快照没有 anchor，只有 scrollY —— 留着当退路
      scrollY: Math.max(0, Math.floor(Number(s.scrollY) || 0)),
      anchor: typeof s.anchor === 'string' ? s.anchor : '',
      anchorOffset: Number.isFinite(s.anchorOffset) ? Math.round(s.anchorOffset) : 0,
      query: typeof s.query === 'string' ? s.query : '',
      size: typeof s.size === 'string' ? s.size : '',
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
