import { useEffect, useRef, useState } from 'react';
import { META } from '../lib/site.js';

/**
 * 工具条：搜索框 + 尺码筛选。
 *
 * 页签（全部/限时特优/超值精选/待拔草 那两组）2026-10-05 按用户要求整组删掉了，
 * 之后只剩搜索框；同一天用户要「在搜索框旁边加个尺码筛选按钮」。
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
export function Toolbar({ query, onQuery, size, onSize, sizes = [] }) {
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

  const pick = (s) => {
    onSize(s);
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

          {sizes.length > 0 && (
            <div className="sizefilter" ref={boxRef}>
              <button
                className="sizefilter__btn"
                type="button"
                aria-expanded={open}
                aria-pressed={!!size}
                onClick={() => setOpen((v) => !v)}
              >
                尺码{size ? ' · ' + size : ''}
              </button>
              {open && (
                <div className="sizefilter__pop" role="group" aria-label="按尺码筛选">
                  <button
                    className={'sizechip' + (size ? '' : ' sizechip--on')}
                    type="button"
                    onClick={() => pick('')}
                  >
                    不限
                  </button>
                  {sizes.map((s) => (
                    <button
                      key={s}
                      className={'sizechip' + (size === s ? ' sizechip--on' : '')}
                      type="button"
                      aria-pressed={size === s}
                      onClick={() => pick(size === s ? '' : s)}
                    >
                      {s}
                    </button>
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
