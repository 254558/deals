/**
 * 尺码：**只认 XS / S / M / L / XL 这五个**。
 *
 * 用户 2026-10-05 的五次调整，按时间记着，免得以后又绕回去：
 *   1. 「尺码按 衣服/裤子/鞋子/内衣/其他 分类」→ 有过分组；
 *   2. 「上衣和外套有什么区别，归为一类」；
 *   3. 「鞋不用管，像袜子围巾这些小众的东西就不统计尺码了」；
 *   4. 「能转化的转化成这种尺码，不能转化的就当不存在这件东西」；
 *   5. 「只要 xs,s,M,L,XL，不要大码的，**不需要区分衣服裤子等等**」→ 就是现在这样：
 *      一个平的尺码表，五个码，没有品类。
 *
 * **为什么一个 cm 都不收**：那些 cm 不是一种尺码，是几种完全不同的量
 * （实测 uniqlo 249 件带 cm 的）：53–91 是裤子的腰围、97–122 是裤长（加长款）、
 * 110–160 是童装身高、16–27 是鞋的脚长。把 76cm 的腰围写成 M、把 22.5cm 的鞋写成 XL，
 * 就是**编数据** —— 所以一件东西的尺码里如果没有这五个之一，它就不进尺码表
 * （但它**仍然留在商品列表里**，只是尺码筛选里找不到它）。
 */
const LETTERS = ['XS', 'S', 'M', 'L', 'XL'];
const LETTER_SET = new Set(LETTERS);

/** 这个标签算不算我们认的尺码（大小写不敏感；cm、数字、XXL/3XL/4XL 一律不算） */
const isOurSize = (label) => LETTER_SET.has(String(label).trim().toUpperCase());

/** 排序就按 LETTERS 的顺序 */
export function sizeRank(s) {
  const k = LETTERS.indexOf(String(s).trim().toUpperCase());
  return k < 0 ? 99 : k;
}

/** 一堆标签里，属于这五个的那些（去重、按序） */
export function ourSizes(labels = []) {
  const out = new Set();
  for (const l of labels) if (isOurSize(l)) out.add(String(l).trim().toUpperCase());
  return [...out].sort((a, b) => sizeRank(a) - sizeRank(b));
}
