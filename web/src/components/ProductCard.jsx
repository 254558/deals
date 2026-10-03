import { priceParts, pct, tagLabel, chips, goneNote } from '../lib/format.js';
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
/**
 * 这一行最多列几档尺码，超了就只写「剩 N 档」。
 *
 * 尺码改成 kbd 方块之后重量的（1440 宽时那行可用 322px）：方块比「 · 」分隔宽，
 * 能排一行的上限跟着降——童装厘米码（110cm 这种）只到 **5** 档，腰围厘米码到 6 档、
 * 字母码到 8 档。取最保守的 5。再多就折成第二行，一折就把同一行卡片的价格线顶歪。
 */
const MAX_SIZE_LABELS = 5;

export function ProductCard({ deal, index, onPick, onHide }) {
  const { url, image, name, brand, tags, tracked, rate, sizes } = deal;

  /**
   * 图片左下角那块「剩下哪些尺码」（2026-10-01 起压在图上，不再占名字那一行）：
   *   码全 / 没有尺码信息 → 不显示
   *   断码                → 显示剩下哪些尺码（图片已经看得够清楚，这时真正决定买不买的是
   *                         「我的码还在不在」）
   *   **全是 cm 的量体尺码 → 不显示**：优衣库有一批用「53cm / 58cm」这种身长尺码，
   *   压在商品图上很难看（用户 2026-10-01：「遇到 cm 的断码的，就别显示了，很难看」）。
   *   混着的时候只去掉 cm 那几个，正常的 S / M / L 照旧显示。
   *
   * 尺码是适配器算好的（见 src/sites/uniqlo.mjs 的 sizeInfo）：接口给的是**有货的
   * 内部码**，翻译成人话才到这儿。商品名不受影响 —— 它在上面一行，完整名字在 title 里。
   */
  const allLabels = sizes?.labels ?? [];
  const sizeLabels = allLabels.filter((l) => !/cm/i.test(String(l)));
  const sizeLine =
    !sizes || sizes.full
      ? null
      : allLabels.length > 0 && sizeLabels.length === 0
        ? null // 全是 cm：整条不显示
        : sizeLabels.length > MAX_SIZE_LABELS
          ? { lead: '', text: `剩 ${sizes.count} 档`, plain: `剩 ${sizes.count} 档` } // 太长，只报个数（不拆方块）
          : sizeLabels.length
            ? { lead: '剩余：', labels: sizeLabels, plain: sizeLabels.join(' · ') } // 一档一个 kbd 小方块
            : { lead: '', text: `剩 ${sizes.count} 档`, plain: `剩 ${sizes.count} 档` };
  // 动效错开只给前几行，否则滚到下面时动画早跑完了
  const delay = Math.min(index, 11) * 40;
  const now = priceParts(deal.price);
  const was = priceParts(deal.launchPrice);
  const cut = deal.launchPrice > deal.price;
  // 连续两轮没在抓取池里见到（只有手动 track 的商品会带着这个标记进来，见 db.mjs 的 missed）
  const gone = deal.gone === true;
  const feats = META.features;
  const text = chips(tags);

  // 显示用的短名：官网名里的斜杠后半段是面料/系列说明（「高弹力紧身牛仔裤/水洗产品」），
  // 卡片上只写斜杠前那半段 —— 官网自己也是这么显示的，名字能短一大截。
  // **数据里存的仍是官网原名**，完整名字留在 title / aria-label 里（鼠标停一下能看到）。
  // 2026-10-01 用户的说法：先说「要和官网一致」（于是不再缩写），再说「带斜杠的只显示斜杠前」
  // —— 两件事不冲突：数据一致、显示精简。
  const shownName = String(name).includes('/') ? String(name).split('/')[0].trim() : name;

  /** 图片那一块。角标只有在 stickerTags 打开时才需要一个定位父盒（迪卡侬），
   *  否则优衣库那边就保持「一个光秃秃的 .picframe」——多包一层会让原本
   *  挂在 .picframe 上的对齐规则失效 */
  const pic = image ? (
    <div className="picframe">
      <a className="piclink" href={url} target="_blank" rel="noreferrer">
        {/* 不写 width/height 属性：属性会变成 used height 把 aspect-ratio 顶掉，
            图就被塞进一个非本比例的框里留白。比例靠 CSS 的 aspect-ratio 定
            （优衣库 3:4、迪卡侬 1:1），所以这里只给 src */}
        <img className="card__img" src={image} alt="" loading="lazy" decoding="async" />
      </a>
          {/* 断码的剩余尺码压在**图片左下角**（用户 2026-10-01：「弄到图片左下角，和图片重叠在一起，
              不要占标题的位置」）。它排在 <a> 外面，不改变链接的点击范围；
              CSS 里再补 pointer-events: none，点它等于点图片。 */}
          {sizeLine && (
            // 「剩余」这两个字不显示（用户 2026-10-01：「删掉剩余两个字，感觉影响美观」）；
            // 它仍留在 aria-label 里，读屏听到的是「商品名　剩余：S M L」。
            <span className="card__sizes">
              {/* 每一档包一个 <kbd>：方形、细边、浅底，像键盘键帽。
                  语义上 <kbd> 本来是「用户输入」，这里纯粹借它的方块外观——
                  它没有 ARIA role，读屏不会多念什么。 */}
              {sizeLine.labels
                ? sizeLine.labels.map((l) => (
                    <kbd className="sizekey" key={l}>
                      {l}
                    </kbd>
                  ))
                : <span className="cardsizes__list">{sizeLine.text}</span>}
            </span>
          )}
    </div>
  ) : (
    /* 兜底，正常情况下用不到：payload 里不会有没图的商品（生成时就剔掉了，见
       core/report.mjs 的 buildPayload）。留着是因为「少一张图」比「一张破图」好看，
       万一哪天有别的路径塞进来一件没图的，页面也不至于难看 */
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

      {/* 名称那一行：**整行是链接**（两行截断由 CSS 兜住）。
          断码时这一行显示剩下的尺码、不显示名字——名字留给 title / aria-label
          （鼠标停一下就能看到，读屏也读得到）。

          ⚠️ 这里原本是「品牌内联 / 整行链接」两套分支，用 feats.brandMark 二选一。
          两站的 brandMark 都是 false，那一支是死代码，却让「尾货」标记被我插错两次
          （一次插进没用到的分支，一次用 includes('card__name') 定位又落回它）。
          2026-10-01 直接删掉合成一份：要恢复就去 git 里找。 */}
      <a
        className="card__name"
        href={url}
        target="_blank"
        rel="noreferrer"
        title={name}
        aria-label={sizeLine ? `${name}　${sizeLine.lead}${sizeLine.plain}` : name}
      >
        {/* 名称**永远显示**（原来断码时会被尺码顶掉，优衣库有 26% 的卡片因此没有名字），
            显示的是 shownName（官网原名去掉斜杠后半段），断码时把剩余尺码跟在名称后面。 */}
        {shownName}
      </a>
      {/* 「尾货 / 新品」的小标记。迪卡侬一半的卖点就是尾货清仓；做得轻（一个小方块 + 两个字），
          而且**只此一份** —— 不要再往别的分支里抄第二份。 */}
      {tags.includes('endlife') && <span className="card__flag">尾货</span>}
      {tags.includes('new_arrival') && <span className="card__flag card__flag--new">新品</span>}

      {/* 价格三件套，右端跟着收藏 / 不再出现两个动作——动作挨着价格，
          不用单独再占一行，卡片下半截也就少一层 */}
      <div className="card__prices">
        <span className={`card__now n${rate > 0 && !gone ? '' : ' card__now--flat'}`}>
          <span className="now__sym">{now.sym}</span>
          <span className="now__int">{now.int}</span>
          <span className="now__dec">{now.dec}</span>
        </span>
        {/* 迪卡侬：官网把折扣写成「6.0折」，这里写降幅，和榜单、排序的口径一致 */}
        {feats.priceOffBadge && rate > 0 && !gone && (
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

      {gone ? (
        <div className={feats.dealBarNumber ? 'card__deal card__deal--flat' : 'card__deal--flat'}>
          {goneNote(deal.lastSeenAt)}
        </div>
      ) : rate > 0 ? (
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
