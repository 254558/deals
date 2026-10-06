/**
 * 保险之一：页面里用到的每个 CSS 变量，都必须有人定义。
 *
 * 为什么要有这条：2026-10-01 那轮统一皮肤，我一共制造了 **4 次同源回归**——
 *   降幅条的灰底（--rule-soft）、降幅条的红填充（--bar-dur / --bar-ease）、
 *   页签的边框（--rule）、页面左右边距（--pad）——
 * 全都是「令牌定义在按站点分的变量块里，我把那个块删了/合并了」导致的。
 * 而 CSS 的表现是：`var()` 解析不到 → **整条声明在计算期失效**（不是退化成某个颜色），
 * 所以肉眼看到的是「边框没了」「条不见了」「边距没了」，很难反推到变量上。
 *
 * 这条测试就在源头堵住它：扫一遍所有 CSS（报告的 web/src/styles.css、
 * 市集页与管理页内联的 <style>），把「用到的变量」和「定义过的变量」对一遍。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
// shell.css 是外壳（令牌 + .wrap + 报头）的**唯一出处**，必须一起扫：
// 令牌定义搬过去之后，只扫 styles.css 会误报「用到了却没定义」（这条测试自己抓到过一次）。
const FILES = [
  'web/src/shell.css',
  'web/src/styles.css',
];

/**
 * 有些变量**不来自 CSS**，而是运行时写上去的，必须列白名单：
 *   --card-min / --card-aspect  报告在 <html style> 上按站点写（描述符里的值）
 *   --nav-h                     报头用 ResizeObserver 量出来写上去
 *   --nav-gap                   只有兜底值，没有定义（var(--nav-gap, 44px) 这种写法本身是安全的）
 * 带兜底值的写法（`var(--x, 兜底)`）不算问题——那正是防这类事故的手段，已经专门用上了。
 */
const RUNTIME_TOKENS = new Set([
  'card-min',
  'card-aspect',
  'nav-h',
  // 运行时按行号/动画写上去的
  'w',   // 降幅条的填充宽度，组件内联 style 写
  'i',   // 卡片入场动画的序号，组件内联 style 写
  // 只有兜底值、刻意不定义：改这个值就能调报头顶部留白，不定义也能跑
  'nav-gap',
]);

/** 从一段 CSS 里抽「用到的变量」（记下有没有兜底值） */
function usedTokens(css) {
  const out = new Map(); // name -> 是否总是带兜底
  for (const m of css.matchAll(/var\(\s*--([a-zA-Z0-9-_]+)\s*(,)?/g)) {
    const name = m[1];
    const hasFallback = Boolean(m[2]);
    if (!out.has(name)) out.set(name, hasFallback);
    else out.set(name, out.get(name) && hasFallback);
  }
  return out;
}

/** 从一段 CSS 里抽「定义过的变量」：形如 `--x:`，且不在 var( 里面 */
function definedTokens(css) {
  const out = new Set();
  // 先把所有 var(...) 挖掉，免得把 var(--x, 兜底) 里的 --x 当成定义
  const withoutVar = css.replace(/var\([^()]*\)/g, '');
  for (const m of withoutVar.matchAll(/(?:^|[;{\s])--([a-zA-Z0-9-_]+)\s*:/g)) out.add(m[1]);
  return out;
}

for (const file of FILES) {
  test(`${file}：用到的 CSS 变量都有定义`, () => {
    let css = readFileSync(ROOT + file, 'utf8');
    // HTML 文件先只取 <style> 里的部分（顺序很重要：必须先滤，再拼 shell，
    // 否则 shell 会被 <style> 正则一起滤掉 —— 这条我写错过一次）
    if (file.endsWith('.html')) {
      css = [...css.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    }
    // 外壳（令牌 + .wrap + 报头）是唯一出处 web/src/shell.css：报告的 styles.css 用
    // @import 拿，市集页与管理页在部署时注入。扫任何页面都要把它算上，否则误报「没定义」。
    css = readFileSync(ROOT + 'web/src/shell.css', 'utf8') + '\n' + css;

    const used = usedTokens(css);
    const defined = definedTokens(css);

    const missing = [];
    for (const [name, alwaysHasFallback] of used) {
      if (defined.has(name)) continue;
      if (RUNTIME_TOKENS.has(name)) continue;
      if (alwaysHasFallback) continue; // `var(--x, 兜底)`：解析不到也不致命
      missing.push(name);
    }

    assert.deepEqual(
      missing,
      [],
      `这些变量被用了、但没人定义（var() 解析不到会让整条声明失效）：${missing.join(', ')}\n` +
        `要么补上定义，要么写成 var(--x, 兜底值)，要么加进测试里的 RUNTIME_TOKENS 白名单。`
    );
  });
}

test('没有哪个变量是靠「兜底值」硬撑的（有的话说明定义丢了）', () => {
  // 这条是提醒，不是硬约束：兜底值本来就是防事故的。但**每个**用到的地方都靠兜底，
  // 就说明定义确实丢了 —— 那种情况应该补定义，而不是靠兜底混过去。
  const css = readFileSync(ROOT + 'web/src/shell.css', 'utf8') + '\n' + readFileSync(ROOT + 'web/src/styles.css', 'utf8');
  const defined = definedTokens(css);
  const onlyFallback = [];
  for (const [name, alwaysHasFallback] of usedTokens(css)) {
    if (alwaysHasFallback && !defined.has(name) && !RUNTIME_TOKENS.has(name)) onlyFallback.push(name);
  }
  assert.deepEqual(onlyFallback, [], `这些变量全靠兜底值撑着，定义应该是丢了：${onlyFallback.join(', ')}`);
});

/**
 * 反方向的那一半：**定义了、却没有任何地方 var() 的令牌**就是死令牌。
 *
 * 上面几条只管「用了没定义」——那会当场出视觉事故（整条声明失效），所以好抓；
 * 反过来的「定义了没人用」是**无声**的：页面看不出任何异常，只是变量表一年年变长。
 * 2026-10-06 清理时就抓到三个（--yellow / --ls-price / --badge-ink，都随折扣角标那套
 * 一起废掉了，但定义一直留在 shell.css 里）。加这条钉住。
 *
 * 注意：扫的是**所有** CSS 拼起来的一份，因为令牌常定义在一处、用在另一处
 * （shell.css 定义）。运行时由 JS 写上去的（--w / --i 那些）
 * 本来就不在 CSS 里定义，所以不会误报。
 */
test('没有「定义了却一处都没用」的令牌（死令牌）', () => {
  const all = ['web/src/shell.css', 'web/src/styles.css']
    .map((f) => readFileSync(ROOT + f, 'utf8')).join('\n');
  const used = usedTokens(all);
  const dead = [...definedTokens(all)].filter((n) => !used.has(n));
  assert.deepEqual(dead, [], `这些变量定义了但全项目没有一处 var() 引用，删掉即可：${dead.join(', ')}`);
});
