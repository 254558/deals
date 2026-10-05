import { useEffect, useRef, useState } from 'react';
import { META } from '../lib/site.js';

/**
 * 工具条：搜索框 + 尺码筛选。
 *
 * 页签（全部/限时特优/超值精选/待拔草 那两组）2026-10-05 按用户要求整组删掉了；
 * 同一天又要「在搜索框旁边加个尺码筛选按钮」。
 *
 * 尺码**只有 XS/S/M/L/XL 五个**（用户：「只要这五个，不要大码的，
 * 不需要区分衣服裤子等等」）。一件东西的尺码里没有这五个之一就不进这张表 ——
 * 理由见 lib/sizes.js：那些 cm 是腰围/裤长/身高/脚长，换算成 S/M/L 就是编数据。
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
                    className={'sizechip sizechip--all' + (size ? '' : ' sizechip--on')}
                    type="button"
                    onClick={() => pick('')}
                  >
                    不限
                  </button>
                  {sizes.map((s) => (
                    <button
                      key={s}
                      className={'sizechip sizechip--all' + (size === s ? ' sizechip--on' : '')}
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
