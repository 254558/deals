# 代码地图：想改 X，去哪

> 给「下一次改动」用的。**先看这里再去读代码** —— 这轮我因为没先看清就动手，
> 同一个「尾货标记」改了三次、CSS 令牌回归四次，都是可以避免的。

## 一句话结构

```
抓取            src/sites/uniqlo.mjs     （站点描述符 + 适配器）
写库            src/core/db.mjs  →  data/deals.db         （node:sqlite，进 git 当备份）
生成报告        src/core/report.mjs + web/                （React → Vite → 单文件 HTML）
推送            src/cli.mjs deploy --target cloudflare    （Cloudflare Pages: deals-pinouts）
```

## 改哪里

| 想改什么 | 去哪 | 必须知道 |
| --- | --- | --- |
| 卡片长什么样 | `web/src/components/ProductCard.vue` | 名称那一行**只有一套分支**了（原来两套，害我插错两次） |
| 卡片/页面样式 | `web/src/styles.css` | 见下面「令牌」；文件末尾有几段窄屏覆盖，**顺序即优先级** |
| 报头（导航栏） | `web/src/components/Masthead.vue` + `styles.css` | 外壳那一套在 `web/src/shell.css`，是唯一出处 |
| 页面骨架（boot / 内联什么） | `src/core/report.mjs` 的 `renderHtml` | 改模板要 `--rebuild`，否则页面被缓存复用 |
| 工具条 / 搜索 + 尺码 | `web/src/components/Toolbar.vue` | 搜索框的值归父组件所有（`:value` + `@input`，不是 v-model）|
| 一个站点的差异 | `src/sites/*.mjs` 的 `report` / `report.features` | 有测试 `test/sites-parity.test.mjs` 锁键集合 |
| 抓取规则 / 接口 | `src/sites/*.mjs` | 优衣库前面有 EdgeOne WAF，要真浏览器 UA |
| 部署产物（robots/sitemap/_headers） | `src/core/report.mjs` 的 `writeDeployRoot` | `_headers` 的规则是**累加**的，别用 `/*` 再叠具体规则 |
| 定时任务 | `.github/workflows/daily.yml` | 每 3 小时一次；只有 01:00 UTC 那次提交库、发提醒 |

## 站点差异怎么写（这轮栽得最多的地方）

站点的差异一律走**描述符**，不要动共用代码，也不要把某一站的值写死：

```js
// src/sites/uniqlo.mjs
report: {
  cardMin: '258px',        // 一列最小宽度 → 决定几列（258px = 5 列）
  imageAspect: '3/4',      // 图框比例（优衣库官图 3:4）
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
2. `npm test`
3. **本地真跑一遍**：报告用 `file://` 打开（双击就行），确认离线也能看
4. 构建 + 部署：`node src/cli.mjs all report --rebuild --no-open` + `all deploy --target cloudflare`
5. **线上量一次**（给出数字，不要只说「好了」）：用 headless Chrome 量几何 / 文案 / 数量
   （报告是 React 渲染的，`curl` 看不到内容）
6. 提交：**提交信息里只写已经验过的结论** —— 这轮我有两次没验证就写「成功了」，都得更正

## 已知的坑（都踩过，按踩到的次数排）

1. **`.wrap` 的简写 `padding` 会盖掉同一个元素上组件自己的 padding** —— 踩过两次
   （都在报头的 eyebrow 上）。要么嵌套两层，要么别共用类名
2. **CSS 令牌定义在「按站点分的块」里**，合并/删除那个块 → 声明整条失效（4 次）
3. **`ProductCard` 曾有两套名称分支** → 改动插错分支（2 次）。现已合并
4. **改报告模板/标题要 `--rebuild`**：页面按 payload 哈希缓存，不进 payload 的改动不触发重建
5. **假 D1（测试里的 stub）不执行 SQL** → 写路径的错（如占位符个数不对）测不出来，
   线上发帖曾因此 500 挂了几小时
6. **git 里的二进制库**冲突：`data/deals.db` 已标 `binary`，冲突时取本地那份
7. 定时任务**尽力而为**：本该 01:00 跑的那次实测 06:01 才启动，别指望准时

## 已经做完的整理（2026-10-01 那一轮）

| 项 | 提交 | 说明 |
| --- | --- | --- |
| 两条「保险」测试 | `6ad4fb4` | `test/css-tokens.test.mjs`（用到的变量必须有定义）+ `test/sites-parity.test.mjs`（站点描述符同一套键）。前者一上来就查出 **5 个线上一直失效的声明** |
| 删死代码分支 | `0ce1ac8` | `ProductCard` 的「品牌内联 / 整行链接」两套分支合成一套（`brandMark` 是 false，那一支是死代码，害我插错两次） |
| `data/deals.db` 标为二进制 | `0ce1ac8` | 不再每次推送都来一次「无法合并二进制文件」 |
| 外壳 CSS 收敛到一处 | `2527b7c` `a367d98` `bd7a0f7` | `web/src/shell.css` 是令牌 + .wrap + 报头的唯一出处 |
| 手机端两列 | `a465cc5` | 一屏能看的件数 1.4 → 2.4（≤560px） |

## 已经查过、**结论是不用改**的（别再查一遍）

- **手机端字号**（2026-10-01 实测，390px）：名称 15px/行高 22.5px、现价 16px、原价 15px、
  尺码键 12px、小灰字 12px；名称 **全部两行，三行占比 0%**。
  （我一度以为要占三行 —— 那是用 `高度 ÷ 18` 估的，真实行高 22.5，估错了。）
- **两列下的溢出**：唯一超框的是 `.sr-only`（读屏文字，故意 1px 宽），没有真溢出。
- **定时任务能不能更准**：GitHub 的 schedule 是尽力而为，实测本该 01:00 的那次 06:01 才跑。

## 还没做（按收益排）

### 1. 报告的 SEO 预渲染 —— 收益最大，但它是改构建，算一件正经活

现状：报告的正文是 React 渲染的，静态 HTML 里 `<div id="root">` 是空的 ——
**百度/谷歌抓不到任何商品**（只有标题、描述、canonical 这些 meta 是对的）。
外链、sitemap、robots 都已就位，缺的就是「正文得在 HTML 里」。

计划（不建议上 Next，理由见对话记录：单文件离线的硬约束，和框架的服务端模型冲突）：
1. 加一个 SSR 入口（Vue 那边是 `renderToString` / `@vue/server-renderer`），带首屏 10 件的数据
2. `src/core/report.mjs` 的 `renderHtml` 把渲染结果放进 `#root`；客户端改成
   `createSSRApp` + `hydrate`（现在用 `createApp` 会白扔一份 DOM）
3. 注意：**payload 不要塞进 HTML 两次**；预渲染的卡片要能被后续的 Vue 收拾干净
4. 验证方式要换：`curl` 到 HTML 里能 grep 出商品名与价格（现在 grep 不到，这才是病根）

### 2. 桌面端商品名单行截断（每张卡省 22px）

用户说过「主要是手机端」，所以先搁置。要做的话先给对比图。

### 3. 三条小一致性（都不着急）

- 工具条吸附时加一点投影（现在贴住时没有分割感）
- 手机端滚过两屏出现「回顶」（800 多件要滑很久）

## 改动前后请记住这条

**提交信息里只写已经验过的结论。** 这轮我有两次没验证就写了「成功了」，都得更正 ——
比改错代码更糟的是留下一条不实的记录。
