/**
 * ESLint 配置：**只开一条规则 —— `no-undef`**。
 *
 * 为什么要有它：这个项目栽过两次「用了没导入 / 变量名拼错」的错 ——
 *   1. 2026-10-01 两份报告**白屏**：ProductCard 里用了 `num` 却忘了 import，
 *      组件渲染时抛 ReferenceError，整棵 React 树挂掉，线上空白。
 *      **构建期完全静默** —— Vite 不会因为一个未导入的标识符报错，它当成全局变量。
 *   2. 同样在 2026-10-01，市集发帖 500（那次根因是 SQL 占位符，但当时也没有任何护栏）。
 *
 * 只开这一条，不引入格式/风格规则：这个项目不需要别人来管缩进和引号。
 * 想扩就扩能挡住「真错」的规则（比如 no-unused-vars），别加会天天吵架的。
 */
import globals from 'globals';

export default [
  {
    // 构建产物、依赖、以及我调试时临时写在项目根的探针脚本都不看
    ignores: ['reports/**', 'node_modules/**', '.wrangler/**', 'tmp*.mjs', 'data/**', '.build/**'],
  },
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // 报告的前端是 JSX（React），默认的 espree 只要打开这个开关就够，不用额外装解析器
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser, // document / window / localStorage / IntersectionObserver…
        ...globals.node, // process / console / Buffer / URL…
        ...globals.worker, // fetch / WebSocket / crypto…
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
