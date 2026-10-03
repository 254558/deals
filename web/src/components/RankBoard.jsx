import { useEffect, useMemo, useState } from 'react';
import { META } from '../lib/site.js';
import { num, price } from '../lib/format.js';

/** 「几件」用汉字，词随实际条数走——只剩 3 件的时候不该写成「五件」 */
const CN = ['一', '二', '三', '四', '五'];
const TOP_N = 5;

/**
 * 本期降得最狠的几件，排成榜，放在整页最上面（报头之下、筛选页签之上）。
 *
 * 只摆第一件的话，想看第二三名还得往下滚、还得自己排序；一次排五件、排在最前，
 * 打开就先看见这一期哪儿在塌，再往下挑。
 *
 * 它答的是「这一期整体哪儿在塌」，跟筛选出来的那批商品不是一回事，
 * 所以不跟着工具条的筛选/排序走。
 *
 * 页签那条工具条是粘性的、榜单在它前面，所以往下滚时榜单走掉、页签留在顶上——
 * 翻到榜单下面之后，筛选用的是页签、不再需要回头找榜单。
 *
 * 整块只在 `META.features.rankBoard` 打开时挂上去（优衣库那一站；判断在 App 里，
 * 这里拿不到开关就不渲染任何东西，免得白算一遍）。
 * 迪卡侬那份报告没有这一块，它的首屏第一个元素就是筛选页签 —— 那是一种选择，
 * 不是少了什么：迪卡侬的商品名下面是「品牌 + 编号」，榜单里再念一遍品牌很啰嗦，
 * 而优衣库的商品名本身就够短，摆得下一张榜。所以这里是开关，不是残留。
 */
export function RankBoard({ deals }) {
  const top = useMemo(
    () =>
      // 先比降幅，降幅一样再比绝对省下的钱：都是降 50%，先看省 349 的那件。
      // 这里用的是 payload 里的 rate（精确值），不是四舍五入后的整数百分比 ——
      // 三件都显示 -74% 时顺序仍由真实值决定，不会出现「看着一样、名次却在抖」。
      deals
        .filter((d) => d.rate > 0)
        .slice()
        .sort((a, b) => b.rate - a.rate || b.saving - a.saving)
        .slice(0, TOP_N),
    [deals]
  );

  // 榜单看过一次就够了：第一次进来展开、并记一笔，之后默认收起（仍然可以手动展开）。
  // 起因是手机上这一块占掉整整第一屏（5 行榜），而多数时候打开是想直接翻商品。
  const seeKey = (META.storagePrefix || 'deals') + '.rankSeen';
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(seeKey); } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(seeKey, '1'); } catch {}
  }, [seeKey]);

  // 开关的判断放在 useMemo 之后（App 里也还有一道），免得 Hook 调用次序随开关变
  if (top.length === 0) return null;

  return (
    <section className="topranks" aria-label="本期降得最狠的商品">
      <button className="topranks__toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="label">本期降得最狠的{CN[top.length - 1]}件</span>
          <span className="topranks__hint">{open ? '收起' : '展开'}</span>
        </button>
      <ol className={open ? 'rank' : 'rank rank--hidden'}>
        {top.map((d, i) => (
          <li className="rank__row" key={d.id}>
            <span className="rank__n n">{String(i + 1).padStart(2, '0')}</span>

            <span className="rank__body">
              <a className="rank__name" href={d.url} target="_blank" rel="noreferrer" title={d.name}>
                {d.name}
              </a>
              {/* 季节 / 尺码这行小灰字：两家都可能有，也可能都是空串，
                  空了就不画那一行（`::before` 的分隔符不进 textContent，
                  只能靠几何验证：每个后随 span 宽出 9.84px） */}
              <span className="rank__meta metaline n">
                {d.season && <span>{d.season}</span>}
                {d.sizeRange && <span>{d.sizeRange}</span>}
              </span>
            </span>

            <span className="rank__tail">
              {/* 价格排版和卡片、列表共用 price()：同一件商品在三个地方写法一致 */}
              <span className="rank__was n">{price(d.launchPrice)}</span>
              <span className="rank__now n">{price(d.price)}</span>
              {/* 降幅＝黄底角标。卡片和列表的降幅都改成了红字（.card__off / .scale__off），
                  黄角标只剩榜单上这一个 */}
              {/* 和卡片同一个口径：说「降 190 元」而不是百分比 */}
              <span className="rank__off n">降 {num(Math.round(d.saving))} 元</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
