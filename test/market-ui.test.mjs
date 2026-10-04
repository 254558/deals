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
