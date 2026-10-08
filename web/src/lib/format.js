import { META } from './site.js';

/**
 * 价格与计数格式化。
 *
 * 写法靠 `META.currency` 选，而不是在组件里硬编码：
 *
 *   优衣库   `¥`   两位小数、千分位，**零值例外**写成 `¥ 0`
 *            （官网的 `currency-zero` 就是不带小数、中间留一个空格）
 *
 * 也就是说「同一个 priceParts(0)」会得到约定的 int/dec，
 * 这份差异是量出来的、不是选的，所以整个搬进 currency 里（契约第三节）。
 */

/**
 * 只按官网的写法格式化**数字部分**（不带货币符号）：**只要整数，不要小数**。
 *
 * 2026-10-01 用户要求：「价格位数比较多的时候，收藏按钮会被挤到下一行去，
 * 所以删掉小数部分，价格只保留整数部份」。实测多数商品带小数
 * （`329.9` 这种），去掉后 `¥329.9` → `¥329`；5 位以上的省得更多
 * （`¥34,999.00` → `¥34,999`）。千分位保留：好读，长度也只差一个逗号。
 *
 * 零值仍由各自的 `currency.zero` 负责（标尺右端那格），不走这里。
 * **只影响显示**：降幅、排序、榜单名次用的都是 payload 里的原始数值。
 */

const amount = (n) => Math.trunc(Number(n) || 0).toLocaleString('zh-CN');

/**
 * 把价格拆成三段交给价格行排版：`sym` / `int` / `dec`。
 *
 * 拆开只有一个理由：货币符号要单独小一档（见 styles.css 的 `.now__sym`），
 * 数字那两段则完全按 `amount()` 的写法来。
 *
 * 零值是一个特例，写法由 `META.currency.zero` 给：优衣库 `¥ 0`
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
 * 条数、销量这类计数不要小数，和价格分开
 */
export const num = (n) => (Number(n) || 0).toLocaleString('zh-CN');

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
 * 拿不到译名的标签直接返回 null 由调用方滤掉：一个全都命中的标签等于没有标签，
 * 所以它连译本都不进 tagLabels。
 */
export const tagLabel = (t) => META.tagLabels?.[t] ?? null;

/**
 * 真正值得挂出来的标签，顺序照 `meta.chipTags`（契约：顺序即显示顺序）。
 * `chipTags` 里没有的标签一律不画成 chip / 角标。
 */
export const chips = (tags = []) => META.chipTags?.filter((t) => tags.includes(t)) ?? [];
