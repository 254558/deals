# 代码地图：想改 X，去哪

> 给「下一次改动」用的。**先看这里再去读代码** —— 这轮我因为没先看清就动手，
> 同一个「尾货标记」改了三次、CSS 令牌回归四次，都是可以避免的。

## 一句话结构

```
抓取            src/sites/uniqlo.mjs / decathlon.mjs     （各自一个描述符 + 适配器）
写库            src/core/db.mjs  →  data/deals.db         （node:sqlite，进 git 当备份）
生成报告        src/core/report.mjs + web/                （React → Vite → 单文件 HTML）
推送            src/cli.mjs deploy --target cloudflare    （Cloudflare Pages: deals-pinouts）
市集前端        market/index.html + market/admin/index.html
市集后端        functions/api/*.js  +  D1 库 deals-market
```

## 改哪里

| 想改什么 | 去哪 | 必须知道 |
| --- | --- | --- |
| 卡片长什么样 | `web/src/components/ProductCard.jsx` | 名称那一行**只有一套分支**了（原来两套，害我插错两次） |
| 卡片/页面样式 | `web/src/styles.css` | 见下面「令牌」；文件末尾有几段窄屏覆盖，**顺序即优先级** |
| 报头（导航栏） | `web/src/components/Masthead.jsx` + `styles.css` | 市集页与管理页是**各自手抄的一份**，改一处要改三处 ⚠️ |
| 页面骨架（boot / 内联什么） | `src/core/report.mjs` 的 `renderHtml` | 改模板要 `--rebuild`，否则页面被缓存复用 |
| 榜单 | `web/src/components/RankBoard.jsx` | 「看过即收」的标记存在 localStorage |
| 工具条 / 页签 | `web/src/components/Toolbar.jsx` | 页签不给数字（用户要求） |
| 一个站点的差异 | `src/sites/*.mjs` 的 `report` / `report.features` | 有测试 `test/sites-parity.test.mjs` 锁键集合 |
| 抓取规则 / 接口 | `src/sites/*.mjs` | 优衣库前面有 EdgeOne WAF，要真浏览器 UA |
| 市集接口 | `functions/api/*.js` + `functions/api/_lib.mjs` | **改完必须跑真 D1 冒烟**（见下） |
| 市集页面 | `market/index.html` | 722 行挤一个文件（CSS/JS 都内联），建议下次拆开 |
| 部署产物（robots/sitemap/_headers） | `src/core/report.mjs` 的 `writeDeployRoot` | `_headers` 的规则是**累加**的，别用 `/*` 再叠具体规则 |
| 定时任务 | `.github/workflows/daily.yml` | 每 3 小时一次；只有 01:00 UTC 那次提交库、发提醒 |

## 站点差异怎么写（这轮栽得最多的地方）

两站的差异一律走**描述符**，不要动共用代码，也不要把某一站的值写死：

```js
// src/sites/decathlon.mjs
report: {
  cardMin: '300px',        // 一列最小宽度 → 决定几列（优衣库 258px = 5 列，迪卡侬 300px = 4 列）
  imageAspect: '1/1',      // 图框比例（迪卡侬官图是方的；优衣库 3/4）
  chipTags: ['endlife', 'new_arrival'],
  features: { cardChips: true, ... },
}
```

- 报告把这些写到 `<html style="--card-min:…;--card-aspect:…">`，CSS 用 `var()` 取
- `test/sites-parity.test.mjs` 会在「一边有这个键、另一边没有」时报警 —— **上次 `cardChips`
  就是被抄没的，当时没有任何测试会红**

## 颜色与间距（CSS 令牌）

`web/src/styles.css` **最前面**那份「兜底调色板」是所有令牌的**唯一出处**：

- 放最前面是刻意的：自定义属性按文档顺序取最后一条，后面任何同名定义都会覆盖它
- 关键颜色写成 `var(--red, #e20c18)` 这种**带字面兜底**的形式
- `test/css-tokens.test.mjs` 会检查「用到的变量有没有人定义」—— 这轮它当场查出 5 个
  一直在线上失效的声明（`--bg` / `--ink-3` / `--ink-faint` / `--ls-price` / `--badge-ink`）

## 改动流程（每次都走，别跳）

1. 改
2. `npm test`（50 条）
3. **本地真跑一遍**：报告用 `file://` 打开；市集起 `wrangler pages dev reports` 并用**真 D1**
   走一遍发帖 / 编辑 / 评论 / 删除
4. 构建 + 部署：`node src/cli.mjs all report --rebuild --no-open` + `all deploy --target cloudflare`
5. **线上量一次**（给出数字，不要只说「好了」）：用 headless Chrome 量几何 / 文案 / 数量
   （报告是 React 渲染的，`curl` 看不到内容）
6. 提交：**提交信息里只写已经验过的结论** —— 这轮我有两次没验证就写「成功了」，都得更正

## 已知的坑（都踩过，按踩到的次数排）

1. **`.wrap` 的简写 `padding` 会盖掉同一个元素上组件自己的 padding** —— 踩过两次
   （市集页的 eyebrow、报头的 eyebrow）。要么嵌套两层，要么别共用类名
2. **CSS 令牌定义在「按站点分的块」里**，合并/删除那个块 → 声明整条失效（4 次）
3. **`ProductCard` 曾有两套名称分支** → 改动插错分支（2 次）。现已合并
4. **改报告模板/标题要 `--rebuild`**：页面按 payload 哈希缓存，不进 payload 的改动不触发重建
5. **假 D1（测试里的 stub）不执行 SQL** → 写路径的错（如占位符个数不对）测不出来，
   线上发帖曾因此 500 挂了几小时
6. **git 里的二进制库**冲突：`data/deals.db` 已标 `binary`，冲突时取本地那份
7. 定时任务**尽力而为**：本该 01:00 跑的那次实测 06:01 才启动，别指望准时

## 改市集接口之后必须做的一件事

```bash
npm run smoke:market        # = node scripts/market-smoke.mjs
```

它会自己起一台 `wrangler pages dev`（本地**真 D1**，新环境会先按 market/schema.sql 建表），
把四条写路径全走一遍：发帖 → 评论 → 编辑（**不带新图**也要能改）→ 删评论 → 删帖，
外加两条权限检查（错凭据必须 403）和一条校验检查（缺图必须 400）。16 项全过才退出 0。

**为什么不能只跑单测**：`test/market.test.mjs` 里的 D1 是我手写的假货，SQL 只被正则匹配、
**根本不执行** —— 「11 列写了 12 个 `?`」这种错它天然看不见。2026-10-01 线上发帖就是这么
500 了几个小时，而当时 43 条单测全绿。

它已经接进了 `.github/workflows/daily.yml`（部署前一步），也可以单独跑：
`--url=http://localhost:8788` 用已起着的那台；要打线上得显式加 `--force`（会真的建/删数据）。

## 我建议的下一步（按收益排）

2. **把共享的「外壳 CSS」（令牌 + 报头 + `.wrap`）从三份手抄合成一处**：
   报告从 `styles.css` 引，市集页与管理页在部署时注入同一份
3. **`market/index.html` 拆成 `market.css` + `market.js`**（现在 722 行挤一个文件）
4. 手机端两列（一屏能看的件数从 ~1.4 提到 ~4）
