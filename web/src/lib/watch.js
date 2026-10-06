import { useCallback, useEffect, useState } from 'react';
import { META } from './site.js';

/**
 * 「待拔草」和「不再出现」这两本账存在浏览器本地。
 *
 * 报告是双击打开的单文件，没有服务端可写，所以账本只能落在 localStorage。
 * `file://` 页面共用同一个存储区，所以换浏览器、清缓存，或者改用 `deals <站点> dev`
 * （http://localhost 是另一个存储区）都会看不到原来的收藏。
 *
 * 三个集合：
 *   picks    在报告里点过「收藏」的
 *   dropped  在报告里点过「取消收藏」的——用来压住终端 `deals <站点> track` 进来的那些，
 *            否则点了取消，刷新又从数据库里冒回来
 *   hidden   点过闭眼图标的：**永久**不再出现（没有放回，见文件末尾那段）
 *
 * 键前缀取 `META.storagePrefix`（uniql / deca），**不是**新造的：
 * `deals[].id` 沿用旧仓库那两个商品编号字段的值，键前缀也沿用旧的，
 * 两个旧报告里已经点过的收藏和隐藏，在新报告里原样还在（契约第五节）。
 */
/**
 * 收藏夹的键。**跨站点共用**（一份报告里两个站点都往里写）。
 *
 * 2026-10-06 清理：这个字符串原来在 App.jsx 和 MinePanel.jsx 里**各写了一遍**，
 * 两边必须永远一致、却没有任何东西保证 —— 改一处另一处会静默失效。
 * 收到这里当唯一出处（它和下面三本账本来就是一族）。
 */
export const FAVORITES_KEY = 'deals.favorites';

const KEYS = {
  picks: `${META.storagePrefix}.picks`,
  dropped: `${META.storagePrefix}.dropped`,
  hidden: `${META.storagePrefix}.hidden`,
};

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    // 隐私模式、或者浏览器禁了 file:// 的存储：当作没收藏过，页面照常能用
    return new Set();
  }
}

function write(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* 存不下就算了，本次浏览仍然有效 */
  }
}

export function useWatch() {
  const [watch, setWatch] = useState(() => ({
    picks: read(KEYS.picks),
    dropped: read(KEYS.dropped),
    hidden: read(KEYS.hidden),
  }));

  useEffect(() => {
    write(KEYS.picks, watch.picks);
    write(KEYS.dropped, watch.dropped);
    write(KEYS.hidden, watch.hidden);
  }, [watch]);

  /**
   * 收藏 ↔ 取消收藏。dbTracked 是终端 `deals <站点> track` 过的：
   * 取消它不能只从 picks 里删（它本来就不在 picks 里），得记一笔 dropped 才压得住。
   */
  const togglePick = useCallback((code, dbTracked) => {
    setWatch((w) => {
      const picks = new Set(w.picks);
      const dropped = new Set(w.dropped);
      const on = dbTracked ? !dropped.has(code) : picks.has(code);
      if (on) {
        picks.delete(code);
        if (dbTracked) dropped.add(code);
      } else {
        picks.add(code);
        dropped.delete(code);
      }
      return { ...w, picks, dropped };
    });
  }, []);

  /**
   * 闭眼：**按款**永久隐藏。写进名单的是两个键——`product_code`（这张卡片）和
   * `code`（吊牌号，同一个款）。
   *
   * 为什么要两个：优衣库一个款有多个颜色，各自一个 productCode，**名字一模一样**。
   * 只按 product_code 删的话，同款另一个颜色照旧在榜上，用户会以为「删了怎么还在」
   * （实测 84 组吊牌号下挂着 2~3 件）。带上吊牌号，点一次这个款的全部颜色一起消失。
   * 迪卡侬那边 code 本来就一件一个，两个键等价，没有副作用。
   *
   * 旧版本只存过 product_code，那些记录照样有效——过滤时两个键都比。
   */
  const hide = useCallback((id, code) => {
    setWatch((w) => {
      const hidden = new Set(w.hidden);
      hidden.add(id);
      if (code && code !== id) hidden.add(code);
      return { ...w, hidden };
    });
  }, []);

  /**
   * 这里原先还有一个 `restoreHidden`（工具栏那颗「已隐藏 N 件 · 放回」）。
   * 2026-09-30 应要求删掉了：闭眼就是**永久删掉**——有些东西就是不想见第二次，
   * 而一颗「放回」按钮等于天天提醒你「这儿还堆着你藏起来的东西」。
   * 于是 hidden 只增不减，也不再有任何入口能看见它、动它。
   *
   * 代价是误点没法撤：真要撤只能清浏览器存储（写进 README 了）。
   */
  return { watch, togglePick, hide };
}
