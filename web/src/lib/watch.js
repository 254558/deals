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
 *   hidden   点过闭眼图标的，不再出现
 *
 * 键前缀取 `META.storagePrefix`（uniql / deca），**不是**新造的：
 * `deals[].id` 沿用旧仓库那两个商品编号字段的值，键前缀也沿用旧的，
 * 两个旧报告里已经点过的收藏和隐藏，在新报告里原样还在（契约第五节）。
 */
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

  const hide = useCallback((code) => {
    setWatch((w) => ({ ...w, hidden: new Set(w.hidden).add(code) }));
  }, []);

  /** 工具栏那颗「已隐藏 N 件 · 放回」点一下全放回来 */
  const restoreHidden = useCallback(() => {
    setWatch((w) => ({ ...w, hidden: new Set() }));
  }, []);

  return { watch, togglePick, hide, restoreHidden };
}
