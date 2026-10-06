import { useCallback, useEffect, useState } from 'react';
import { META } from '../lib/site.js';
import { FAVORITES_KEY } from '../lib/watch.js';

/**
 * 「我的」——报告里的一个视图，**只有两块：收藏 / 转移码**。
 *
 * 用户 2026-10-06：「我的里面就放：收藏，转移码就好，别的都删掉」。
 * 这一块原来是独立的一页（/market/?mine=1，跟着「有品」市集走），那天市集整个删了，
 * 于是把它收进报告本身：报告是双击就能打开的单文件，而收藏和转移码**本来就是纯本地的**
 * （localStorage，没有服务端），放进来自带两个好处——离线可用、少一套部署。
 *
 * 2026-10-06 整理：这个文件原来是**一个 171 行的组件**，里面塞着两件互不相干的事
 * （读收藏 / 搬凭据）。拆成三个各管一件事的组件之后，两边各自的 state 和副作用
 * 都回到自己身上，上面这个壳只负责「现在看哪一块」。
 *
 * 键的来历见 lib/watch.js（收藏夹 + 三本账都在那儿定义）。
 */

const TAB_FAVS = 'favs';
const TAB_TRANSFER = 'transfer';

export function MinePanel() {
  const [tab, setTab] = useState(TAB_FAVS);

  return (
    <div className="mine">
      <div className="wrap">
        {/* 这一块**没有标题**：顶上导航那一行已经说明了在哪（左边 GoodPrices、
            右边「优衣库」），再来一行「我的」是重复。
            用户 2026-10-06：「点到我的后，删掉导航栏下面的那个我的两个字」。
            也没有自己的「返回/关闭」——右边那条「优衣库」就是回榜单的路。 */}
        <div className="mine__tabs" role="tablist">
          <TabButton on={tab === TAB_FAVS} onClick={() => setTab(TAB_FAVS)}>收藏</TabButton>
          <TabButton on={tab === TAB_TRANSFER} onClick={() => setTab(TAB_TRANSFER)}>转移码</TabButton>
        </div>

        {tab === TAB_FAVS ? <FavoritesPane /> : <TransferPane />}
      </div>
    </div>
  );
}

function TabButton({ on, onClick, children }) {
  return (
    <button
      className={'mine-tab' + (on ? ' mine-tab--on' : '')}
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════ 收藏 ══════════════════════════ */

/** 报告可能是 file:// 打开的，那时 /uniqlo/img/x.webp 这种绝对路径解不出来 —— 去掉开头的斜杠 */
function imgSrc(u) {
  const s = String(u || '');
  return location.protocol === 'file:' && s.startsWith('/') ? s.slice(1) : s;
}

function FavoritesPane() {
  const [favs, setFavs] = useState([]);

  // 挂上来就重读一遍：可能刚在报告里点过爱心
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      setFavs(Array.isArray(v) ? v : []);
    } catch {
      setFavs([]);
    }
  }, []);

  /**
   * 取消收藏：删快照，**并同步那三本账**（不然刷新一下爱心又亮回来）。
   * localStorage 那些写在 setState 之外 —— 放进更新函数里的话，
   * StrictMode 下会被调两次（结果虽然一样，但没必要）。
   */
  const removeFav = useCallback((id) => {
    const one = favs.find((x) => x.id === id);
    const next = favs.filter((x) => x.id !== id);
    setFavs(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
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

  if (!favs.length) {
    return (
      <div className="mine__pane">
        <p className="mine__empty">还没收藏。回到榜单点商品卡片上的爱心，就会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="mine__pane">
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
            <button className="fav__del" type="button" onClick={() => removeFav(f.id)} aria-label="取消收藏">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════ 转移码 ══════════════════════════ */

const TX_PREFIX = 'GP1.';
const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** 转移码里打包哪些键：收藏夹 + 「待拔草 / 不再出现 / 已隐藏」三本账 */
function transferKeys() {
  const p = META.storagePrefix;
  return [FAVORITES_KEY, `${p}.picks`, `${p}.dropped`, `${p}.hidden`];
}

function TransferPane() {
  const [code, setCode] = useState('');
  const [hint, setHint] = useState('');

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
        if (k === FAVORITES_KEY) {
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

  return (
    <div className="mine__pane">
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
  );
}
