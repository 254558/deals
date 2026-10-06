import { useCallback, useEffect, useState } from 'react';
import { DATA, META } from '../lib/site.js';

/**
 * 「我的」——报告里的一个整屏视图，**只有两块：收藏 / 转移码**。
 *
 * 用户 2026-10-06：「我的里面就放：收藏，转移码就好，别的都删掉」。
 * 这一块原来是独立的一页（/market/?mine=1，跟着「有品」市集走），那天市集整个删了，
 * 于是把它收进报告本身：报告是双击就能打开的单文件，而收藏和转移码**本来就是纯本地的**
 * （localStorage，没有服务端），放进来自带两个好处——离线可用、少一套部署。
 *
 * 键的来历见 App.jsx 顶部的注释：`deals.favorites` 跨站点共用，
 * `${prefix}.picks / .dropped / .hidden` 是「待拔草 / 不再出现」那三本账（见 lib/watch.js）。
 */

const FAV_KEY = 'deals.favorites';
const TX_PREFIX = 'GP1.';

/** 转移码里打包哪些键：收藏夹 + 「待拔草 / 不再出现 / 已隐藏」三本账 */
function transferKeys() {
  const p = META.storagePrefix;
  return [FAV_KEY, `${p}.picks`, `${p}.dropped`, `${p}.hidden`];
}

/** 报告可能是 file:// 打开的，那时 /uniqlo/img/x.webp 这种绝对路径解不出来 —— 去掉开头的斜杠 */
function imgSrc(u) {
  const s = String(u || '');
  return location.protocol === 'file:' && s.startsWith('/') ? s.slice(1) : s;
}

const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function MinePanel({ open, onClose }) {
  const [tab, setTab] = useState('favs');
  const [favs, setFavs] = useState([]);
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');

  // 每次打开重读一遍：可能刚在报告里点过爱心
  useEffect(() => {
    if (!open) return;
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      setFavs(Array.isArray(v) ? v : []);
    } catch {
      setFavs([]);
    }
    setCode('');
    setHint('');
  }, [open]);

  // 开着的时候别让背后的榜单跟着滚
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** 取消收藏：删快照，并同步那三本账（不然刷新时爱心又亮回来） */
  const removeFav = useCallback((id) => {
    const next = favs.filter((x) => x.id !== id);
    setFavs(next);
    const one = favs.find((x) => x.id === id);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      if (one?.prefix) {
        const pk = `${one.prefix}.picks`;
        const dk = `${one.prefix}.dropped`;
        const picks = new Set(JSON.parse(localStorage.getItem(pk) || '[]'));
        const dropped = new Set(JSON.parse(localStorage.getItem(dk) || '[]'));
        picks.delete(id);
        dropped.add(id);
        localStorage.setItem(pk, JSON.stringify([...picks]));
        localStorage.setItem(dk, JSON.stringify([...dropped]));
      }
    } catch { /* 存不下就算了 */ }
  }, [favs]);

  /** 导出：把本地那几本账打成一串码 */
  const exportCode = useCallback(() => {
    const bag = {};
    for (const k of transferKeys()) {
      const v = localStorage.getItem(k);
      if (v) bag[k] = v;
    }
    setCode(TX_PREFIX + b64e(JSON.stringify(bag)));
    setHint('这串码就是你的收藏和三本账。发到新设备（微信传给自己就行），在那台设备上点「导入」再粘进去。');
  }, []);

  /** 导入：合并，已有的不动 */
  const importCode = useCallback(() => {
    const raw = code.trim().replace(/\s+/g, '');
    if (!raw.startsWith(TX_PREFIX)) return setHint('这段码不对（应该以 GP1. 开头）');
    let bag;
    try {
      bag = JSON.parse(b64d(raw.slice(TX_PREFIX.length)));
    } catch {
      return setHint('这段码读不出来，可能复制时缺了字符');
    }
    if (!bag || typeof bag !== 'object') return setHint('这段码里没有东西');
    let n = 0;
    try {
      for (const [k, v] of Object.entries(bag)) {
        if (!transferKeys().includes(k) || typeof v !== 'string') continue;
        if (k === FAV_KEY) {
          // 收藏夹要**合并**：按 id 去重，本地已有的为准
          const cur = JSON.parse(localStorage.getItem(k) || '[]');
          const add = JSON.parse(v);
          const have = new Set((Array.isArray(cur) ? cur : []).map((x) => x.id));
          const merged = [...(Array.isArray(cur) ? cur : []), ...(Array.isArray(add) ? add : []).filter((x) => !have.has(x.id))];
          localStorage.setItem(k, JSON.stringify(merged));
          n += merged.length - have.size;
        } else if (!localStorage.getItem(k)) {
          localStorage.setItem(k, v); // 三本账本地没有才导，免得覆盖掉现在的
          n++;
        }
      }
    } catch {
      return setHint('写本地存储失败（可能是隐私模式）');
    }
    setHint(n ? `导入了 ${n} 项，刷新一下就看到` : '这台设备上本来就有，不用导');
    if (n) setTimeout(() => location.reload(), 900);
    return undefined;
  }, [code]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setHint('已复制 ✅');
    } catch {
      setHint('自动复制不行，手动选中复制吧');
    }
  }, [code]);

  if (!open) return null;

  return (
    <div className="mine" role="dialog" aria-modal="true" aria-label="我的">
      <div className="wrap">
        <div className="mine__bar">
          <span className="mine__title">我的</span>
          <button className="mine__close" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {/* 两块，别的都删了（用户 2026-10-06） */}
        <div className="mine__tabs" role="tablist">
          <button
            className={'mine-tab' + (tab === 'favs' ? ' mine-tab--on' : '')}
            type="button" role="tab" aria-selected={tab === 'favs'}
            onClick={() => setTab('favs')}
          >
            收藏
          </button>
          <button
            className={'mine-tab' + (tab === 'transfer' ? ' mine-tab--on' : '')}
            type="button" role="tab" aria-selected={tab === 'transfer'}
            onClick={() => setTab('transfer')}
          >
            转移码
          </button>
        </div>

        {tab === 'favs' ? (
          <div className="mine__pane">
            {favs.length === 0 ? (
              <p className="mine__empty">
                还没收藏。回到榜单点商品卡片上的爱心，就会出现在这里。
              </p>
            ) : (
              <div className="mine__favs">
                {favs.map((f) => (
                  <div className="fav" key={f.id}>
                    <a className="fav__link" href={f.url} target="_blank" rel="noreferrer">
                      <img className="fav__img" src={imgSrc(f.image)} alt="" loading="lazy" />
                      <span className="fav__body">
                        <span className="fav__name">{f.name}</span>
                        <span className="fav__price">{f.currency || META.currency?.sym || '¥'}{f.price}</span>
                      </span>
                    </a>
                    <button
                      className="fav__del" type="button"
                      onClick={() => removeFav(f.id)}
                      aria-label="取消收藏"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mine__pane">
            <p className="mine__hint">
              收藏和「待拔草 / 不再出现」都只存在这个浏览器里（报告是双击打开的单文件，
              没有服务端）。换手机、清了缓存就没了 —— 用这串码把它们搬过去。
              <b>它不是账号：谁拿到这串码，谁就能改你的收藏。</b>
            </p>
            <div className="mine__row">
              <button className="btn btn--sm" type="button" onClick={exportCode}>生成转移码</button>
              <button className="btn btn--sm btn--ghost" type="button" onClick={importCode}>导入</button>
              {code && <button className="btn btn--sm btn--ghost" type="button" onClick={copy}>复制</button>}
            </div>
            <textarea
              className="mine__code"
              rows={4}
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="点「生成转移码」会在这里出现一串码；或者把旧设备那串粘进来，再点「导入」"
            />
            {hint && <p className="mine__hint">{hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export { FAV_KEY };
