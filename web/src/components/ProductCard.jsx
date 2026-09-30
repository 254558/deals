import { priceParts, pct, tagLabel, chips } from '../lib/format.js';
import { META } from '../lib/site.js';
import { CardActions } from './CardActions.jsx';

/**
 * 大图卡片。两家的卡片是**同一个骨架**（图 → 名称 → 价格行 → 标尺 / 状态行 → chips），
 * 但信息层级和几何都不一样，所以下面每一处差异都挂一个 `META.features` 开关，
 * 组件里没有一处站点判断：
 *
 *   stickerTags   商品图上的角标（迪卡侬的 尾货/新品）。优衣库那份没有：
 *                 它的促销类型全在工具条页签里，图上再挂一个红角标只是噪音
 *   brandMark     名称前那块品牌小字（迪卡侬）。优衣库的名称里没有品牌
 *   priceOffBadge 价格行里的黄底 `-xx%` 角标（迪卡侬）。优衣库把降幅挪到了
 *                 下面那根比例条的条尾（红字），价格行只留价格和动作
 *   dealBarNumber 比例条尾部的红色降幅数字（优衣库）。迪卡侬只在条上画长度、
 *                 数字在价格行的黄角标里，同一件事不说两遍
 *   cardChips     卡片底部的 chips 行（迪卡侬）。**没有标签也照样留着**：
 *                 它的 `margin-top: auto` + `min-height` 托住卡片底边，
 *                 整排卡片的底对齐才不会被「有没有标签、有没有收藏」带歪
 *
 * 几何（图片比例 3:4 / 1:1、网格 auto-fill 258px / 固定 4 列且列间距 0、
 * 卡片要不要 padding、名称两行怎么截断）全部在 styles.css 的
 * `[data-site=…]` 作用域里，这一层只管结构。
 *
 * 一处和官网不同，两家都适用：官网卡片**不显示原价**（原价只在商品页出现），
 * 但这页的全部意义就是上市价对比，所以把上市价补在现价后面 —— 灰字、划删除线。
 * 划线只在真降了的时候才画（`cut`），没降的原价等于现价，划它没意义。
 */
export function ProductCard({ deal, index, onPick, onHide }) {
  const { url, image, name, brand, tags, tracked, rate } = deal;
  // 动效错开只给前几行，否则滚到下面时动画早跑完了
  const delay = Math.min(index, 11) * 40;
  const now = priceParts(deal.price);
  const was = priceParts(deal.launchPrice);
  const cut = deal.launchPrice > deal.price;
  const feats = META.features;
  const text = chips(tags);

  /** 图片那一块。角标只有在 stickerTags 打开时才需要一个定位父盒（迪卡侬），
   *  否则优衣库那边就保持「一个光秃秃的 .picframe」——多包一层会让原本
   *  挂在 .picframe 上的对齐规则失效 */
  const pic = image ? (
    <div className="picframe">
      <a className="piclink" href={url} target="_blank" rel="noreferrer">
        {/* 不写 width/height 属性：属性会变成 used height 把 aspect-ratio 顶掉，
            图就被塞进一个非本比例的框里留白。比例靠 CSS 的 aspect-ratio 定
            （优衣库 3:4、迪卡侬 1:1），所以这里只给 src */}
        <img className="card__img" src={image} alt="" loading="lazy" />
      </a>
    </div>
  ) : (
    <span className="card__img card__img--none" />
  );

  return (
    <article className="card" role="listitem">
      {feats.stickerTags ? (
        <div className="card__picwrap">
          {pic}
          {/* 角标贴在图上：位置照迪卡侬官网 `.tag-box absolute left-10`。
              官网用它写「特惠产品」（人人都有），这里改写成我们自己的两个信号——
              红＝尾货清仓、灰＝新品。中文译本来自 meta.tagLabels，
              `discount_zone` 因为「全都命中等于没有标签」不进 chipTags */}
          {text.map((t) => (
            <span key={t} className={`tagbox tagbox--${t}`}>
              {tagLabel(t)}
            </span>
          ))}
        </div>
      ) : (
        pic
      )}

      {feats.brandMark ? (
        /* 迪卡侬：品牌内联在名称前面，整块是一个 <p>（官网卡片就是 p + 内联品牌） */
        <p className="card__name">
          {brand && <span className="brandmark">{brand}</span>}
          <a className="card__namelink" href={url} target="_blank" rel="noreferrer">
            {name}
          </a>
        </p>
      ) : (
        /* 优衣库：名称自己就是链接（整行可点），两行截断由 CSS 兜住 */
        <a className="card__name" href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
      )}

      {/* 价格三件套，右端跟着收藏 / 不再出现两个动作——动作挨着价格，
          不用单独再占一行，卡片下半截也就少一层 */}
      <div className="card__prices">
        <span className={`card__now n${rate > 0 ? '' : ' card__now--flat'}`}>
          <span className="now__sym">{now.sym}</span>
          <span className="now__int">{now.int}</span>
          <span className="now__dec">{now.dec}</span>
        </span>
        {/* 迪卡侬：官网把折扣写成「6.0折」，这里写降幅，和榜单、排序的口径一致 */}
        {feats.priceOffBadge && rate > 0 && (
          <span className="offbadge n">-{pct(rate)}</span>
        )}
        {cut && (
          <span className="card__was n">
            {was.sym}
            {was.int}
            {was.dec}
          </span>
        )}
        <CardActions watched={tracked} onPick={onPick} onHide={onHide} />
      </div>

      {rate > 0 ? (
        META.features.dealBarNumber ? (
          /* 优衣库：比例条和降幅红字同行，红字贴在条尾，条占满剩余宽度 */
          <div className="card__deal">
            <span className="card__bar" aria-hidden="true">
              <i style={{ '--w': `${Math.min(1, rate) * 100}%`, animationDelay: `${delay}ms` }} />
            </span>
            <span className="card__off n">-{pct(rate)}</span>
          </div>
        ) : (
          /* 迪卡侬：只有一根条，长度同样等于降幅（数字在价格行的黄角标里） */
          <span className="card__bar" aria-hidden="true">
            <i style={{ '--w': `${Math.min(1, rate) * 100}%`, animationDelay: `${delay}ms` }} />
          </span>
        )
      ) : (
        <div className={feats.dealBarNumber ? 'card__deal card__deal--flat' : 'card__deal--flat'}>
          尚未降价，正在替你盯着
        </div>
      )}

      {feats.cardChips && (
        /* 收藏 / 不再出现已经挪到价格行，这一行现在只剩「待拔草」标签。
           没有标签也照样留着：min-height 托住卡片底边，整排卡片的底对齐才不会被
           有没有标签、有没有收藏带歪 */
        <div className="card__chips">
          {feats.trackChip && tracked && <span className="chip chip--tracked">★ 待拔草</span>}
        </div>
      )}
    </article>
  );
}
