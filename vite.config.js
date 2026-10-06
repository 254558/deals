import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 报告要能双击直接打开（file://），有两个坑：
 *  1. ES module 在 file:// 下会被 CORS 拦掉，所以必须打成 IIFE。
 *  2. 拆出来的 js/css 也要能内联进单个 HTML，所以文件名和资源目录都固定下来，
 *     交给 `deals <站点> report` 读出来塞进一个自包含的 reports/<站点>/index.html。
 *
 * 一份 bundle 和一张 styles.css，版面差异全靠
 * `<html data-site="uniqlo">` 选择（见 docs/REPORT-CONTRACT.md）。
 *
 * 产物落在 .build/，那只是中间件；报告目录 reports/<站点>/ 里还有缓存的商品图。
 *
 * `publicDir` 只在 build 时关掉：报告是自包含单文件，数据、字体、CSS 全部内联，
 * 构建产物用不到 web/public/。不关的话 Vite 会把 web/public/ 整个复制进 .build/
 * —— 一份 data.js 加两个站点的商品图，谁都读不到的复制品。
 * 开发服务器还得靠 public/ 里的 data.js、font.css 和 img 软链，所以 serve 时照旧。
 */
export default defineConfig(({ command }) => ({
  root: 'web',
  base: './',
  publicDir: command === 'build' ? false : 'public',
  plugins: [vue()],
  build: {
    outDir: '../.build',
    emptyOutDir: true,
    assetsDir: '',
    cssCodeSplit: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.css',
      },
    },
  },
}));
