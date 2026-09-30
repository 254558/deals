import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderHtml } from '../src/core/report.mjs';

/**
 * 报告 HTML 的结构不变量。
 *
 * 这些都是「顺序」和「谁在谁前面」的约定，改 renderHtml 时最容易不小心弄反，
 * 而弄反了不会报错——只是首绘悄悄变慢几百毫秒（实测过，见 README「加载性能」）。
 * 所以在这里钉住。
 */
function html(overrides = {}) {
  return renderHtml({
    js: 'console.log(1)',
    css: '/* 整块 CSS */',
    fontCss: '@font-face{font-family:x;src:url(data:font/woff2;base64,AAA)}',
    payload: {
      site: 'uniqlo',
      generatedAt: '2026-09-30T00:00:00.000Z',
      meta: { pageTitle: '优衣库比价' },
      deals: [
        { id: 'a', image: 'img/a@561.webp' },
        { id: 'b', image: 'img/b@561.webp' },
        { id: 'c', image: 'img/c@561.webp' },
        { id: 'd', image: 'img/d@561.webp' },
        { id: 'e', image: 'img/e@561.webp' },
        { id: 'f', image: 'img/f@561.webp' },
      ],
      ...overrides,
    },
  });
}

const at = (s, needle) => {
  const i = s.indexOf(needle);
  assert.ok(i >= 0, `没找到：${needle}`);
  return i;
};

test('开机动画那块要排在最前面：关键 CSS → 开机动画 → 整块 CSS → payload', () => {
  const h = html();
  const critical = at(h, '<style>:root{--bg:#fff');
  const boot = at(h, 'id="boot"');
  const full = at(h, '/* 整块 CSS */');
  const payload = at(h, 'window.__DEALS_DATA__');
  const app = at(h, 'console.log(1)');

  // 关键 CSS 与开机动画必须在最前：整块 CSS 有 300KB（含内嵌字体），是阻塞渲染的，
  // 排在前面的化，浏览器得先啃完它才肯画第一帧——开机动画就没机会在等 HTML 时出现
  assert.ok(critical < boot, '关键 CSS 要在开机动画之前');
  assert.ok(boot < full, '开机动画要排在整块 CSS 之前（否则首绘被 CSS 拖住）');
  assert.ok(full < payload, '整块 CSS 要排在 payload 之前（React 渲染时样式必须已就位）');
  assert.ok(payload < app, 'payload 要在应用 JS 之前');
  // 字体那份也在 body 里（跟着整块 CSS 走），不能回到 head
  assert.ok(at(h, '@font-face') > boot, '字体那一段不该待在 head 里');
});

test('首屏那几张图要 preload，而且点名点得对', () => {
  const h = html();
  const links = [...h.matchAll(/<link rel="preload" as="image" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(links, ['img/a@561.webp', 'img/b@561.webp', 'img/c@561.webp', 'img/d@561.webp'], '前 4 张，按榜单顺序');
  assert.ok(at(h, 'rel="preload"') < at(h, 'window.__DEALS_DATA__'), 'preload 要在 head 里，早于 payload');

  // 卡片是 React 渲染的，img 标签在 JS 跑完前不在文档里——浏览器自己扫不到，只能靠这里点名
  assert.equal((h.match(/rel="preload"/g) || []).length, 4, '只点名首屏那几张，别把 800 多张全 preload');
});

test('没有本地图（remote 那一路）时不 preload，也不炸', () => {
  const h = html({ deals: [{ id: 'a', image: null }, { id: 'b' }] });
  assert.equal((h.match(/rel="preload"/g) || []).length, 0);
  assert.ok(h.includes('id="boot"'));
});

test('没有字体（迪卡侬那份）时不留空 <style>', () => {
  const h = renderHtml({
    js: 'x',
    css: '.a{}',
    fontCss: '',
    payload: { site: 'decathlon', generatedAt: '2026-09-30T00:00:00.000Z', meta: { pageTitle: '迪卡侬' }, deals: [] },
  });
  assert.ok(!h.includes('<style>\n\n</style>'), '空的字体 style 块不该留下');
  assert.equal((h.match(/@font-face/g) || []).length, 0);
});
