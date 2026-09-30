import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { DATA, META } from './lib/site.js';
import './styles.css';

/**
 * `<html data-site>` 是**版面差异的唯一开关**：两家共用这一张 styles.css，
 * 站点特有的几何（图片比例、网格列宽、标尺配色、卡片信息层级、字体栈）
 * 全部挂在 `[data-site="…"]` 作用域里。
 *
 * 正式报告里 renderHtml 已经把它写死在 `<html>` 上了；这里再写一遍是为了
 * `deals <站点> dev` 的调试页 —— 那份 HTML 是仓库里共享的一个 index.html，
 * 站点标识只能从 payload 里拿（契约第一节）。两处写的是同一个值，
 * 后写的这一次不会覆盖出差异。
 */
document.documentElement.dataset.site = DATA.site;

/**
 * 页签标题取 `meta.pageTitle`，同样是为了 dev 页：正式报告由 renderHtml 写
 * `<title>`。组件里不许硬编码站点文案，`<title>` 也是站点文案，所以在这里落一次。
 */
if (META.pageTitle) document.title = META.pageTitle;

createRoot(document.getElementById('root')).render(<App />);
