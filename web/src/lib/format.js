import { META } from './site.js';

/**
 * 价格与计数格式化。
 *
 * 两家的写法在这里并列保留，靠 `META.currency` 选，而不是靠站点标识：
 *
 *   优衣库   `¥`   两位小数、千分位，**零值例外**写成 `¥ 0`
 *            （官网的 `currency-zero` 就是不带小数、中间留一个空格）
 *   迪卡侬   `￥`   全角符号（官网 DOM 里就是 `￥29.90`），零值写成 `￥0`
 *
 * 也就是说「同一个 priceParts(0)」在两家会得到不同的 int/dec，
 * 这份差异是量出来的、不是选的，所以整个搬进 currency 里（契约第三节）。
 */

/**
 * 只按官网的写法格式化**数字部分**（不带货币符号），两位小数 + 千分位。
 *
 * 迪卡侬原来的 `money()` 是这个语义：`money(0)` → `'0'`，
 * 因为它拿 `.split('.')` 分两段，`'0.00'` 会被切成 `['0', '']`，
 * 小数那格就成了空串 —— 于是页面上 `￥` 后面直接跟一个 `0`。
 * 优衣库那条路径处理零值走的是 `currency.zero`，不经过这里。
 */
export const amount = (n) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * 把价格拆成三段交给价格行排版：`sym` / `int` / `dec`。
 *
 * 拆开只有一个理由：货币符号要单独小一档（见 styles.css 的 `.now__sym`），
 * 数字那两段则完全按 `amount()` 的写法来。
 *
 * 零值是一个特例，两家的写法都由 `META.currency.zero` 给：优衣库 `¥ 0`
 * 的长度正好比 `¥` 多一个 `0`，所以取它的末字符当整数格、`dec` 留空。
 * 这些都是数据侧量好的，这里不自己编。
 */
export function priceParts(n) {
  const cur = META.currency ?? { sym: '', zero: '' };
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (v === 0) return { sym: cur.sym, int: (cur.zero ?? '').slice(-1), dec: '' };
  const [int, dec] = amount(v).split('.');
  return { sym: cur.sym, int, dec: dec ? `.${dec}` : '' };
}

/**
 * 带上货币符号的一整串价格，给标尺两端、榜单、上市价那几格用。
 *
 * 零值必须走 `currency.zero`：标尺右端就是 `¥0` 那一格，两家一个带空格一个不带，
 * 这里统一了才能保证标尺的读法和各自官网一致。
 */
export function price(n) {
  const cur = META.currency ?? { sym: '', zero: '' };
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (v === 0) return cur.zero;
  return `${cur.sym}${amount(v)}`;
}

/** 条数、销量这类计数不要小数，和价格分开 */
export const num = (n) => (Number(n) || 0).toLocaleString('zh-CN');

/** 降幅按整数百分比显示（排序仍然用精确值，见 App 的 compare） */
export const pct = (r) => `${Math.round((Number(r) || 0) * 100)}%`;

/**
 * 月销：优衣库官网的紧凑写法 —— 10 万以上取整（489737 → `48.9万`），
 * 1 万到 10 万留一位小数（16284 → `1.6万`），不到 1 万就写原数。
 * 没有销量（0）写破折号，不要写成一个 0 让人以为是「卖出 0 件」。
 *
 * 这个写法是优衣库那一站专有的（迪卡侬的尾列是「运动」，纯文本），
 * 但它由 `META.columns[].format === 'compact'` 选中，组件里没有站点判断。
 */
export const sales = (n) =>
  n ? (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : num(n)) : '—';

/** 抓取时间：`2026-09-26 15:49`，报头那行用 */
export function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 「已不在特价 · 最后见到 9/25」——手动 track 的商品从抓取池里消失了才用得上。
 *
 * 为什么特意带上日期：这时候卡片上那个价格是**最后一次见到的旧价**，不是现在
 * 还能买到的价。不带日期的话，一个灰掉的 ¥59 仍然会被读成「现在 59 能买」。
 *
 * 文案为什么是「已不在特价」而不是「已下架」：优衣库抓的是两个标签池
 * （限时特优 / 超值精选），从池子里消失有两种可能——真下架，或者活动结束回了原价。
 * 我们无法从池成员关系区分这两者，所以用中性的说法，不替官方下结论。
 */
export const goneNote = (iso) =>
  iso ? `已不在特价 · 最后见到 ${new Date(iso).toLocaleDateString('zh-CN')}` : '已不在特价';

/**
 * 把一件商品的标签翻成中文。标签名（`endlife` / `new_arrival` / `time_doptimal`…）
 * 是数据侧的，中文只在 `meta.tagLabels` 里（契约第三节）。
 *
 * 拿不到译名的标签直接返回 null 由调用方滤掉：`discount_zone`（特惠专区）
 * 就是这样 —— 迪卡侬抓来的样本里 1391 件有 1374 件带着它，
 * 一个全都命中的标签等于没有标签，所以它连译本都不进 tagLabels。
 */
export const tagLabel = (t) => META.tagLabels?.[t] ?? null;

/**
 * 真正值得挂出来的标签，顺序照 `meta.chipTags`（契约：顺序即显示顺序）。
 * `chipTags` 里没有的标签一律不画成 chip / 角标。
 */
export const chips = (tags = []) => META.chipTags?.filter((t) => tags.includes(t)) ?? [];
