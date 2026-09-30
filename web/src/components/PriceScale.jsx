import { pct, price, priceParts } from '../lib/format.js';
import { META } from '../lib/site.js';

/**
 * 降价标尺 —— 这一页的签名元素。
 *
 * 横轴就是价格轴：左端是上市价，右端是 `currency.zero`。条子从上市价铺到现价，
 * 所以「条子有多长」直接等于「降了多少」。
 *
 * 两家共用同一根轨道、同一段生长动画（`.scale__track` / `.scale__fill` /
 * `.scale__notch` 都写在共用的那一层），只有**条子上下的那点读数**摆法不同，
 * 这就是 `META.features.scaleLayout`：
 *
 *   'inline'（优衣库）降幅红字贴在条尾，和条同一行（`.scale__barline`），
 *                     条占满剩余宽度。整屏扫下来条和数字一眼对上
 *   'top'   （迪卡侬）降幅（黄底角标）和省下的钱写在条**上方**一行
 *                     （`.scale__top`）。迪卡侬要多说一句「省 ￥X」，
 *                     那句话贴在条尾会把条挤短、黄角标也没地方放
 *
 * 注意 `saving` 只在 'top' 那一支用得上：'inline' 那一支条尾是红字降幅，
 * 没有省多少钱的位置 —— 省多少由降幅和现价自己就能算出来，那一站不必再念一遍。
 *
 * 配色也是站点差异，写在各自的 `[data-site]` 作用域里：优衣库是红条
 * （红＝降价，和它卡片上的红色现价一套），迪卡侬是墨条（那一站黄＝折扣数、
 * 红＝清仓角标、蓝＝可点，标尺不属于这三类，它是一段数据，所以用官网的墨色）。
 *
 * 还没降价的商品根本走不到这里：那种情况父组件直接画「尚未降价，正在替你盯着」，
 * 免得硬画一根 -0% 的空条。
 */
export function PriceScale({ launch, price: now, rate, saving = 0, delay = 0 }) {
  const w = `${Math.min(1, Math.max(0, rate)) * 100}%`;
  const saved = priceParts(saving);
  return (
    <div className="scale" role="cell">
      {META.features.scaleLayout === 'top' ? (
        <div className="scale__top">
          <span className="scale__off n">-{pct(rate)}</span>
          <span className="scale__saved n">
            省 {saved.sym}
            {saved.int}
            {saved.dec}
          </span>
        </div>
      ) : null}

      <div className={META.features.scaleLayout === 'top' ? undefined : 'scale__barline'}>
        <div
          className="scale__track"
          role="img"
          aria-label={`降幅标尺：上市价 ${price(launch)}，现价 ${price(now)}，降幅 ${pct(rate)}${
            META.features.scaleLayout === 'top' ? `，省 ${price(saving)}` : ''
          }`}
        >
          <div className="scale__fill" style={{ '--w': w, animationDelay: `${delay}ms` }} />
          <div className="scale__notch" style={{ '--w': w, animationDelay: `${delay}ms` }} />
        </div>
        {META.features.scaleLayout === 'top' ? null : (
          <span className="scale__off n">-{pct(rate)}</span>
        )}
      </div>

      {/* 两端读数：左端上市价、右端零值。右端写的是 `currency.zero` 而不是 `price(0)`
          的推算结果 —— 两家一个 `¥ 0` 一个 `￥0`，这一格正是那个差异的用武之地 */}
      <div className="scale__ends n">
        <span>{price(launch)}</span>
        <span>{META.currency.zero}</span>
      </div>
    </div>
  );
}
