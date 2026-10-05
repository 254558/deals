import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * 一条尾巴很长的坑：市集页是**纯 JS + 纯 HTML，完全没有 JSX**。
 * 所以 JSX 那种花括号包起来的注释记法在那里不是注释，而是**字面文本** ——
 * 写进模板字符串就会原样渲染到页面上（详情页凭空多出几行汉字）。
 *
 * 2026-10-01 我在 market.js 里踩了三次（删收藏按钮、改动作栏、加说明各一次）。
 * 这个文件没有一丝 JSX，所以只要出现那个开头就一定是 bug —— 用一条断言钉死。
 *
 * 判定规则：只看**非注释行**（行首是斜杠或星号的跳过）—— 说明这件事的注释本身
 * 难免要提到那个写法，不能连它一起报。真正出事那次，那行是以花括号开头的
 * （前面只有空白），所以照样抓得到。
 */
test('市集页与 Functions 的 js / html 里不许出现 JSX 风格的注释记号', () => {
  // 扫 market/ 与 functions/ 下的**所有** js / html（递归）：
  // 这两个目录全是纯 JS / 纯 HTML，没有一处 JSX，所以出现那个记号就一定是 bug。
  // （一开始我只列了三个文件名，结果拿一个探针文件去做负向验证时压根扫不到，
  //   差点以为「守卫是好的」—— 范围放宽之后负向验证才有意义。）
  const roots = ['market', 'functions'];
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(ROOT + dir, { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|html)$/.test(e.name)) files.push(rel);
    }
  };
  for (const r of roots) walk(r);

  const mark = '{' + '/*';
  const bad = [];

  for (const f of files) {
    const src = readFileSync(ROOT + f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!line.includes(mark)) return;
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // 说明性注释，跳过
      bad.push(f + ':' + (i + 1) + '  ' + t.slice(0, 60));
    });
  }

  assert.deepEqual(bad, [], '这些地方写了 JSX 风格的注释记号，它会被当成正文渲染出来：\n' + bad.join('\n'));
});

/**
 * 同一个页面里 id 不能重复。
 *
 * 2026-10-05 真实事故：「我的」页重排成 tab 三个 pane 时，我在 paneWorks 里新加了
 * #loading / #empty，却忘了删页面底部原来那对 —— 于是页面上出现了两个 id="loading"。
 * \`$('loading')\` 取到的是第一个（pane 里那个），底部那个**永远停在「正在加载…」**，
 * 而且切到「转移码」「收藏」tab 也照样显示（它在 pane 外面，不受 tab 的 hidden 管）。
 * 用户报的就是「转移码下面为什么有个正在加载」「收藏又显示还没有收藏又显示正在加载」。
 *
 * id 重复在 HTML 里是**无声**的：不报错、也不难看，只是有个元素永远不受控。所以钉一条。
 */
test('market 下的 html 里 id 不能重复', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(ROOT + dir, { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.html')) files.push(rel);
    }
  };
  walk('market');
  assert.ok(files.length > 0, 'market 下应该能找到 html');
  for (const f of files) {
    // 先剔掉 <script> 里的内容：那里的 `id="' + esc(x) + '"` 是**运行时**拼出来的，
    // 静态扫会把它们当成重复 id（实测 market/admin/index.html 被误报 3 次）。
    const html = readFileSync(ROOT + f, 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Map();
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
    const dup = [...seen.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(dup, [], `${f} 里有重复的 id：${JSON.stringify(dup)}`);
  }
});
