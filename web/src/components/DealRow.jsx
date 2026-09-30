import { priceParts, price, num, sales, tagLabel, chips } from '../lib/format.js';
import { META } from '../lib/site.js';
import { PriceScale } from './PriceScale.jsx';
import { CardActions } from './CardActions.jsx';

/**
 * 一行 = 一张 PLP 卡片横过来放：左边商品图，中间信息块，
 * 右边价格从上市价坍缩到现价，最右是那本期最该看的东西 —— 降价标尺。
 *
 * 两家的列不完全一样（优衣库尾列是「月销」，迪卡侬是「运动」），
 * 所以行里的格子照 `META.columns` 渲染：key 取数据、kind 决定画法、cellCls 给样式钩子。
 * 组件里没有一处 `site === …`，也没有一处写死的中文列名 —— 换 payload 就换一套列。
 * 三处「格子位置」由 kind 认领（契约第三节）：'name' 是信息块、'was'/'now' 是两格价格、
 * 'scale' 是标尺、剩下的 'cell' 是尾列。
 *
 * 下面这些是**两家的版面差异**，全部由 `META.features` 开关控制：
 *
 *   rowMetaLine  名称上方那行「品牌 + 编号」小灰字。只有迪卡侬有：优衣库的名称
 *                （「抽褶裙」）本身就带不出品牌，编号在搜索里认，不必念在行上；
 *                迪卡侬的名称（「箭侧垫」）脱离品牌就读不懂是哪家的什么货
 *   trackChip    `★ 待拔草` 小标签。只有迪卡侬有：优衣库那边爱心收了就是实心蓝，
 *                同一件事不占两处
 *   rowChips     行尾那行是 chips + 动作（迪卡侬），还是只有动作（优衣库）。
 *                这一条不只是多几个标签：它决定动作落在哪一行，两家的行高不一样
 *   flatWasDash  没降价时「上市价」那格写「—」。迪卡侬要（它的上市价等于现价时
 *                划一道删除线没有意义，写个破折号更诚实）；优衣库照写价格
 *
 * 「限时特优 / 超值精选」这类方框标签两家都不画在行上：促销类型在工具条页签里
 * 筛一次就够，不必一行一行重复。
 */
export function DealRow({ deal, index, onPick, onHide }) {
  const { url, image, name, tracked } = deal;
  // 动效错开只给前面几行，否则滚到下面时动画早跑完了
  const delay = Math.min(index, 14) * 45;
  const now = priceParts(deal.price);
  const cut = deal.launchPrice > deal.price;
  const feats = META.features;
  const cols = META.columns;
  /** 尾列（月销 / 运动）：数字列和文本列写法不一样，由列声明里的 format 决定 */
  const tailCol = cols.find((c) => c.kind === 'cell');

  return (
    <div className="row" role="row">
      <div className="row__piccell" role="cell">
        {image ? (
          <div className="picframe">
            <a className="piclink" href={url} target="_blank" rel="noreferrer">
              {/* 这里**不写** width/height 属性：属性会变成 used height 把 CSS 的
                  aspect-ratio 顶掉，图就被塞进一个非本比例的框里留白 —— 卡片那边
                  已经踩过同一个坑（见 ProductCard）。行缩略图的尺寸完全由 CSS 定：
                  优衣库是 --pic-w / --pic-h（3:4），迪卡侬跟着表格第一列的轨道走、
                  max-width 72px（1:1）。所以这里只给 src */}
              <img className="row__pic" src={image} alt="" loading="lazy" />
            </a>
          </div>
        ) : (
          <span className="row__pic--none" />
        )}
      </div>

      <div className="row__body" role="cell">
        {feats.rowMetaLine && (
          <div className="metaline n row__meta">
            {/* 品牌那一段在名称**上方**、并且是单独一格：迪卡侬官网是把品牌内联在
                名称前面的，我们把它提上来单独站一行，扫列的时候品牌才能对齐成一条 */}
            {deal.brand && <span className="brandmark">{deal.brand}</span>}
            <span>{deal.code}</span>
          </div>
        )}
        <a className="row__name" href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
        {/* 动作行。`rowChips` 那一支还带 chips，所以它在名称下面自成一行；
            另一支只有动作，直接跟在名称后面（两条路径的类名不同是有意的：
            迪卡侬的 chips 行要不吃 `margin-top: auto`，优衣库的动作行要贴住名称） */}
        {feats.rowChips ? (
          <div className="row__chips">
            {feats.trackChip && tracked && <span className="chip chip--tracked">★ 待拔草</span>}
            {chips(deal.tags).map((t) => (
              <span key={t} className={`chip chip--${t}`}>
                {tagLabel(t)}
              </span>
            ))}
            <CardActions watched={tracked} onPick={onPick} onHide={onHide} />
          </div>
        ) : (
          <div className="row__acts">
            <CardActions watched={tracked} onPick={onPick} onHide={onHide} />
          </div>
        )}
      </div>

      {/* 上市价：小、灰。划线只在真降了的时候才加（`--cut`），
          没降的（手动盯着的）原价等于现价，划它没意义 */}
      <div className={`row__was n${cut ? ' row__was--cut' : ''}`} role="cell">
        {feats.flatWasDash && !cut ? '—' : price(deal.launchPrice)}
      </div>

      <div className="row__nowcell" role="cell">
        <div className={`row__now n${deal.rate > 0 ? '' : ' row__now--flat'}`}>
          {/* 货币符号单独一格（字号小一档），数字留给 priceParts 补两位小数与千分位 */}
          <span className="now__sym">{now.sym}</span>
          <span className="now__int">{now.int}</span>
          <span className="now__dec">{now.dec}</span>
        </div>
      </div>

      {/* 还没降价的（手动盯着的）商品画不出标尺，硬画就是一根 -0% 的空条 */}
      {deal.rate > 0 ? (
        <PriceScale
          launch={deal.launchPrice}
          price={deal.price}
          rate={deal.rate}
          saving={deal.saving}
          delay={delay}
        />
      ) : (
        <div className="scale scale--flat" role="cell">
          尚未降价，正在替你盯着
        </div>
      )}

      {/* 尾列：优衣库是月销（`format: 'compact'`，489737 写成 `48.9万`），
          迪卡侬是运动（纯文本，空的写破折号）。同一格代码，靠列声明分叉。
          cellCls 是窄屏下整列撤掉用的钩子（迪卡侬的 `.row__sports`）。 */}
      <div
        className={`n${tailCol?.cellCls ? ` ${tailCol.cellCls}` : ''}`}
        role="cell"
      >
        {tailCol.format === 'compact' ? sales(deal[tailCol.key]) : deal[tailCol.key] || '—'}
      </div>
    </div>
  );
}
