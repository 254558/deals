/**
 * 按**品类**给商品分堆，好让尺码表分组显示；并且**只认字母尺码**。
 *
 * 用户 2026-10-05 的四次调整，按时间记着，免得以后又绕回去：
 *   1. 「尺码按 衣服/裤子/鞋子/内衣/其他 分类」→ 于是有了分组；
 *   2. 「上衣和外套有什么区别，归为一类」→ 外套并进衣服（两者尺码集合本来就一样）；
 *   3. 「鞋不用管，像袜子围巾鞋这种小众的东西就不统计尺码了」→ 只有 SIZE_CATS 进尺码表；
 *   4. 「尺码只有 xs,s,M,L,XL 这种，能转化的转化，不能转化的就当不存在这件东西」→
 *      **只保留字母尺码**（见 LETTERS），cm 一个都不收。
 *
 * **为什么 cm 一个都不转化**：那些 cm 不是一种尺码，是几种完全不同的量
 * （实测 uniqlo 249 件带 cm 的）：53–91 是裤子的腰围、97–122 是裤长（加长款）、
 * 110–160 是童装身高、16–27 是鞋的脚长。把 76cm 的腰围写成 M、把 22.5cm 的鞋写成 XL，
 * 就是在**编数据** —— 用户说的「不能转化的就当不存在」，正好也是唯一诚实的做法：
 * 这些件不进尺码统计（但**仍然留在商品列表里**，只是尺码筛选里找不到它们）。
 *
 * 为什么只能靠商品名分品类：payload 里没有品类字段（见 docs/MAP.md 的抓取部分）。
 * 规则是「越具体越先判」，**顺序本身就是规则**：
 *   裙子 → 内衣 → 裤子 → 衣服 → 其他
 * 例：「打底裤」撞不上内衣任何词，才落到裤子；袜、围巾、帽、包都归「其他」——
 * 而「其他」不在 SIZE_CATS 里，于是它们不参与尺码统计。
 */
const RULES = [
  ['裙子', /裙/],
  ['内衣', /内裤|文胸|胸罩|bra|内衣|睡衣|家居服|秋衣|保暖内衣|打底衫/i],
  ['裤子', /裤|打底|legging/i],
  ['衣服', /外套|夹克|茄克|羽绒|大衣|风衣|棉服|马甲|派克|T恤|T恤衫|tee|衬衫|衬衣|针织|毛衣|卫衣|背心|吊带|POLO|开衫|套头|上衣/i],
];

/** **只有这四个品类统计尺码**（用户：「鞋不用管，像袜子围巾啊乱七八糟小众的东西就不统计」） */
export const SIZE_CATS = ['衣服', '裤子', '裙子', '内衣'];

/**
 * **认的尺码就这些**，其它一律不算尺码。
 * 用户说的是「xs,s,M,L,XL」，这里多留了 XXL / 3XL / 4XL ——
 * 库里 3XL 有 269 件、4XL 有 155 件，砍掉等于让大码的人完全筛不出东西。
 * 真要只留五个，删掉后面三个即可。
 */
export const LETTERS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const LETTER_SET = new Set(LETTERS);

/** 这个标签算不算尺码（大小写不敏感，cm/数字那些一律不算） */
export const isLetterSize = (label) => LETTER_SET.has(String(label).trim().toUpperCase());

/** 一件商品的尺码里，属于字母尺码的那些 */
export function letterSizes(labels = []) {
  return labels.filter(isLetterSize);
}

export function categoryOf(name = '') {
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return '其他';
}

/** 尺码排序，就按 LETTERS 的顺序 */
export function sizeRank(s) {
  const k = LETTERS.indexOf(String(s).trim().toUpperCase());
  return k < 0 ? 99 : k;
}
