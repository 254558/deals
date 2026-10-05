import { useEffect, useRef, useState } from 'react';
import { META } from '../lib/site.js';

/**
 * 工具条：搜索框 + 尺码筛选。
 *
 * 页签（全部/限时特优/超值精选/待拔草 那两组）2026-10-05 按用户要求整组删掉了，
 * 之后只剩搜索框；同一天用户要「在搜索框旁边加个尺码筛选按钮」。
 *
 * 尺码**按品类分组**（衣服/裤子/裙子/内衣）。只有这四个进尺码表 ——
 * 鞋、袜、围巾、包这些小众东西不统计尺码（用户 2026-10-05）。
 * 是重复的，66 个尺码平铺成一列谁也找不着；分组之后「裤子 · M」才表达得出来。
 * 点某组的小标题＝只看该品类（不限尺码）。分组逻辑在 lib/size-groups.js。
 *
 * 尺码**只在有数据时才画**：优衣库 886 件里 867 件带尺码标签，迪卡侬的 payload
 * 里 `sizes` 是空的（抓取那边还没取体育用品的尺码），所以那份报告上不出现这颗按钮
 * —— 摆一个点了没用的按钮比不摆更糟。
 *
 * 尺码表是从**当前可见的商品**现算的（不是写死的清单），所以每份报告只列自己真有的
 * 那些；排序按服装惯例 XS→4XL 在前，其余（童装 cm、鞋码…）按字典序排在后面。
 *
 * 三层，各管一件事：
 *   .toolbar      整页宽、粘住（粘性元素只能在自己父元素的盒子里活动，
 *                 所以外壳必须高过整页内容，不能是 .wrap）
 *   .wrap         居中 + 左右内衬
 *   .toolbar__row flex 排布 + 下边那条发丝线（放在这层，线才跟报头、表头一样内缩）
 */
export function Toolbar({ query, onQuery, cat, size, onPick, groups = [] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // 点别处就收起（面板展开着却关不掉最烦人）
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const pick = (nextCat, nextSize) => {
    onPick(nextCat, nextSize);
    setOpen(false);
  };

  return (
    <div className="toolbar">
      <div className="wrap">
        <div className="toolbar__row">
          <input
            className="search"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={META.searchPlaceholder}
            aria-label={META.searchPlaceholder}
          />

          {groups.length > 0 && (
            <div className="sizefilter" ref={boxRef}>
              <button
                className="sizefilter__btn"
                type="button"
                aria-expanded={open}
                aria-pressed={!!size}
                onClick={() => setOpen((v) => !v)}
              >
                尺码{cat ? ' · ' + cat : ''}{size ? ' ' + size : ''}
              </button>
              {open && (
                <div className="sizefilter__pop" role="group" aria-label="按品类与尺码筛选">
                  <button
                    className={'sizechip sizechip--all' + (cat || size ? '' : ' sizechip--on')}
                    type="button"
                    onClick={() => pick('', '')}
                  >
                    不限
                  </button>
                  {groups.map((g) => (
                    <div className="sizegroup" key={g.cat}>
                      {/* 小标题本身也是按钮：只想看「裤子」而不限定尺码时点它 */}
                      <button
                        className={'sizegroup__head' + (cat === g.cat && !size ? ' sizegroup__head--on' : '')}
                        type="button"
                        onClick={() => pick(g.cat, '')}
                      >
                        {g.cat}
                      </button>
                      {g.hint && <div className="sizegroup__hint">{g.hint}</div>}
                      <div className="sizegroup__chips">
                        {g.sizes.map((s) => (
                          <button
                            key={s}
                            className={'sizechip' + (cat === g.cat && size === s ? ' sizechip--on' : '')}
                            type="button"
                            aria-pressed={cat === g.cat && size === s}
                            onClick={() => pick(cat === g.cat && size === s ? '' : g.cat, cat === g.cat && size === s ? '' : s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
