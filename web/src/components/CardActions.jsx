import { Heart, EyeClosed } from 'lucide-react';

/**
 * 两个动作：爱心＝收进「待拔草」，闭上的眼睛＝以后不再出现。
 *
 * 这一组对两家完全一致（图标、尺寸、颜色、无障碍文字都一样），所以它没有任何
 * `META` 开关 —— 两家真正的差别是「这两个动作落哪一行」：
 * 优衣库在大图卡片的价格行、列表行的名称下面那一行；迪卡侬在大图卡片的价格行、
 * 列表行底部那条 chips 行的行尾。那是**父组件的排版**，不是这组图标的事。
 *
 * 爱心是**实心**图标（`fill="currentColor"`）。大图卡片里它们落在价格行的右端，
 * 和现价、角标、划线上市价排在同一行，实心的分量才压得住旁边那排数字。
 *
 * 「不再出现」用闭眼（`EyeClosed`），不用垃圾桶、也不用叉号：垃圾桶填成实心就是一只
 * 黑桶，跟一排数字排在一起又重又钝；叉号虽然轻，但它是两条硬邦邦的直线，跟圆润的爱心
 * 并排像两个体系的东西。闭眼是「不看了／不显示」最安静的说法，也正好对上这件商品的状态
 * ——它没被销毁，只是从这张榜上隐掉了，工具栏那个「放回」一点就能叫回来。形状上它和
 * 爱心一样是圆润的有机图形，并列不打架。
 *
 * 它是全组里最淡的一个图形（实测墨迹量只有实心爱心的 0.27，划掉的眼睛是 0.55），
 * 这一点是刻意的：三条弧线本来就没有实心块，拿掉又是次要动作，比「收进来」安静才对。
 *
 * 尺寸不用单独配。lucide 全系画在 24 格上，但字形占多大差很多：叉号只从 6 画到 18，
 * 同尺寸下只有爱心的六成宽，所以之前那颗叉号得放大到 24 才追得平。闭眼铺满 2→22，
 * 和爱心一样，两者都在 16px 下量到 14.6px 的墨迹跨度，直接同尺寸即可。
 * 描边保持 lucide 默认的 2——它内部是弧形，加粗到 2.5 在 16px 下会糊成一团。
 *
 * 爱心既然一律实心，形状就不再表示状态了，收没收改由**颜色**说：静着是未激活控件的
 * 淡灰（`--ink-faint`），收了转品牌蓝（`.dealact--on`）。
 * 两家在这一处的取舍不同、但都归这一份代码：优衣库那份不再另挂 `★ 待拔草` 标签
 * （同一件事讲两遍，只是把这一行挤得更满），迪卡侬那份会在卡片底部和列表行的 chips 里
 * 再挂一个 —— 那个标签由 `META.features.trackChip` 控制，不在这组图标里。
 *
 * 两个图标都不带底色、不带边框——同一行已经有黄「降幅」角标，再加两个方块就太重了。
 * 文字留在 `.sr-only` 里给读屏，鼠标停上去还有 title。
 */
export function CardActions({ watched, onPick, onHide }) {
  return (
    <div className="dealacts">
      <button
        type="button"
        className={`dealact${watched ? ' dealact--on' : ''}`}
        aria-pressed={watched}
        onClick={onPick}
        title={watched ? '移出「待拔草」' : '加进「待拔草」'}
      >
        <Heart size={16} strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
        <span className="sr-only">{watched ? '取消收藏' : '收藏'}</span>
      </button>

      <button
        type="button"
        className="dealact"
        onClick={onHide}
        title="以后不再出现这件（工具栏上可以全部放回）"
      >
        {/* 同 size 即可：EyeClosed 跟爱心一样铺满 24 格，量到同样的墨迹跨度 */}
        <EyeClosed size={16} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">不再出现</span>
      </button>
    </div>
  );
}
