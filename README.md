# deals · 比价与捡漏工具

一个命令行工具 + 一份自包含网页报告。抓零售商的公开接口，**记录每件商品的上市价（历史最高原价）与现价**，算出精确降幅，把正在降价的商品排成一张捡漏榜。

目前支持两个站点：

| 站点 | 抓什么 | 报告 |
| --- | --- | --- |
| `uniqlo` 优衣库 | 全站特价（限时特优 + 超值精选） | `reports/uniqlo/index.html` |
| `decathlon` 迪卡侬 | 特惠专区 | `reports/decathlon/index.html` |

```
编号      商品                              上市价      现价     降幅       省  标签
─────────────────────────────────────────────────────────────────────────────────
488089    抽褶裙                              ¥249       ¥59     -76%     ¥190  超值精选
482979    廓形针织T恤/短袖                    ¥149       ¥39     -74%     ¥110  超值精选
482274    PUFFTECH空气棉棉服无领茄克/外套      ¥499      ¥149     -70%     ¥350  超值精选
```

```bash
npm install                  # 只装 React + Vite + lucide（图标）与 subset-font，用于生成网页报告
node src/cli.mjs uniqlo sync      # 抓优衣库，建立本地历史（第一次约 1 分钟）
node src/cli.mjs decathlon sync   # 抓迪卡侬
node src/cli.mjs all sync         # 两家一起抓
node src/cli.mjs uniqlo list      # 看捡漏榜
node src/cli.mjs uniqlo report    # 生成网页报告并打开
```

需要 **Node 22 以上**（用到内置的 `node:sqlite`）。

## 命令

两个位置参数：**站点**、**命令**。站点也可以是 `all`（`sync` / `report` / `deploy` 支持一次做两家）。

| 命令 | 说明 |
| --- | --- |
| `deals <站点> sync` | 抓取并写入价格库。**建议每天跑一次**，上市价靠历次快照取最高值，攒得越久越准 |
| `deals <站点> list` | 捡漏榜。`--sort rate\|saving\|price\|sales\|newest`、`--min-rate 0.3`、`--limit 60`、`--tag <标签码>`、`--tracked` |
| `deals <站点> new` | 只看最近一次抓取里**又降价**的商品 |
| `deals <站点> track <编号>` | 盯一件商品（编号在商品页价格下方或吊牌上，也接受直接贴商品页地址），降价了在报告里标出来 |
| `deals <站点> history <编号>` | 看一件商品的价格快照，一天一条（只读本地库，不去接口核对） |
| `deals <站点> block <编号>` | 把一个款加进**谢绝名单**：报告里永久不出现。吊牌号（`488089`）、商品编号（`u0000000072656`）、商品名都能给；名字命中多个款时会把候选列出来、什么都不改 |
| `deals <站点> unblock <吊牌号>` | 从谢绝名单里去掉 |
| `deals <站点> blocked` | 看看现在屏蔽了哪些款 |
| `deals <站点> report` | 生成 HTML 报告并打开。`--no-images` 跳过图片缓存、`--no-open` 只生成不打开、`--rebuild` 强制重建页面、`--no-font` 不内嵌字体 |
| `deals <站点> stats` | 本地数据概览 |
| `deals <站点> dev` | 起 Vite 开发服务器调报告页面（热更新），数据来自当前数据库 |
| `deals <站点> deploy` | 生成最新报告并推上去。默认 Vercel（每站一个项目）；`--target cloudflare` 改推 Cloudflare Pages（一个项目装两份） |
| `deals sites` | 有哪些站点、各攒了多少 |
| `deals backup` | 给价格库做一份一致性快照（`VACUUM INTO`，默认留最近 14 份）。有 iCloud / Dropbox 就同时写一份到机器之外 |
| `deals alert` | 盯着的商品降价了、或数据超过 36 小时没抓成功，就弹 macOS 通知（每日任务跑完会自己调它） |

站点别名：`uniqlo` / `uniql` / `u`，`decathlon` / `deca` / `d`。也认 `--site uniqlo`。

`package.json` 里有对应的 npm scripts（`npm run sync`、`npm run report:uniqlo`…）。

## 网页报告

两份报告都是**一个自包含的单文件**：CSS、JS、数据、字体全部内联，双击就能打开，不需要起服务器。React 源码在 `web/`，改完跑 `deals <站点> report --rebuild` 或 `deals <站点> dev`。

**两家共用同一套 React 组件和同一张 `styles.css`**，版面差异挂在 `<html data-site="uniqlo|decathlon">` 上；所有会随站点变的文案与开关（页签名、列名、货币符号、卡片上有哪些元素、标尺怎么排）都来自 payload 里的 `meta`。这份契约写在 **[docs/REPORT-CONTRACT.md](docs/REPORT-CONTRACT.md)**，它也是 `src/core/report.mjs` 与 `web/` 之间唯一的接口。

两家各自的设计取舍（为什么这么排、删掉了什么、量了哪些实测值）分别写在：

- **[docs/DESIGN-UNIQLO.md](docs/DESIGN-UNIQLO.md)** —— 优衣库这一半：3:4 网格、页顶榜单、红色标尺、内嵌思源黑体
- **[docs/DESIGN-DECATHLON.md](docs/DESIGN-DECATHLON.md)** —— 迪卡侬这一半：方图卡片、图上角标、黄底降幅角标、墨色标尺

两边都有的东西：

**只有一种视图：大图。** 优衣库分类页那种卡片墙，图大、铺满整列，翻的时候一眼就能看清是哪件东西。卡片底部那根比例条就是「降价标尺」——横轴是价格轴，左端上市价、右端零，墨条从上市价铺到现价，所以墨条长度直接等于降了多少。筛选（页签）与搜索共用一套；**排序固定是「降幅从大到小」**（就是最该看的那个），没有排序入口。

> 原先还有一个**列表视图**（一张「门店价签」式的表），2026-09-30 应要求撤掉了——大图够用。连带删掉 `DealRow` / `ColumnHeader` / `PriceScale` 三个组件、整套表格 CSS 和 payload 里的 `meta.columns`（先换成 `meta.sorts`；后来排序入口也撤了，那份声明一并删掉）。

**窄屏（≤760）工具栏只留页签一行，并且钉在顶上。** 搜索那一档撤掉（屏幕金贵，手机上也不常用），剩下的一行 `57px` 常驻——1302 件商品，滚到中段想「只看尾货」，不该一路滚回顶部。两家行为一致。

**打开时先给一块加载指示（纯 CSS 点阵）。** 白屏其实是两段，得分开看（390 宽 + 4 倍 CPU 降速，线上实测）：

| 段落 | 耗时 | 盖得住吗 |
| --- | --- | --- |
| 等服务器第一个字节（TTFB） | 449～1147ms（抖动很大，取决于网络/代理） | **盖不住**——HTML 还没到，页内没有东西可画 |
| HTML 到了之后 → 首次绘制 | 改前 **460ms** → 改后 **41ms** | 这一段就是能盖的：解析 + React 挂载 |

所以指示器是 25 个点的点阵（斜着一道波扫过去，`--i` = 行+列），**纯 CSS、写在 `#root` 之后、两段大脚本之前**，React 一往 `#root` 里画出东西它就自动让位（`#root:not(:empty) ~ #boot`）。

两个踩出来的坑，都写在 `styles.css` 的注释里：

1. **不能用 React 组件做。** 白屏就是 React 还没跑起来的那段时间，拿 React 去盖它逻辑上盖不住（等它渲染出来，白屏已经结束）。市面上那些点阵加载库（比如 dotmatrix）动画本身也是纯 CSS，React 只负责算相位——但依赖它们就要跟着引入 React 组件 + Tailwind/shadcn。
2. **不能有延迟。** 浏览器只在「解析到这块、脚本还没跑完」的那一次机会里画一帧（实测 `firstPaint − htmlDone = 41ms`）；加 100ms 延迟等它出场，React 早挂载完并把它摘掉了——手机上实测一次都没画出来。所以改成不延迟 + 120ms 淡入：慢的时候正好在等待期间浮起来（手机上实测有约 230ms 的画面），快到只有 36ms 的时候（这台 Mac）它只到三成不透明度，一闪而过。`prefers-reduced-motion` 下点阵不扫，但仍然出现。

**首屏只渲染 10 件，下滑再一批批补上。** 数据一开始就全在内存里（自包含单文件，没有服务端），但**卡片是整批建的**。手机上实测（390 宽 + 4 倍 CPU 降速）：

| | 优衣库 878 件 | 迪卡侬 1307 件 |
| --- | --- | --- |
| DOM 节点 | 24,705 → **402** | 40,916 → **364** |
| 首屏主线程长任务 | 1250ms → **157ms** | 1515ms → **136ms** |
| 页面处理耗时（DCL − TTFB） | 912ms → **154ms** | 1296ms → **118ms** |

图片本来就是懒加载的（首屏只请求 3～4 张），网络也不是瓶颈（gzip 后 380KB / 125KB）——慢的就是一次建出几万个 DOM 节点。本地双击打开（无网络）测得的长任务和线上几乎一样，正好说明这一点。

列表尾部只有一行小字回答「还有没有」：还没到底写「继续下滑加载更多」，到底了写「已经到底了」——**不报总数**（2026-09-30 起；工具条右端那句「显示全部 N 件」也一并撤了）。换筛选或搜索会回到第一批并滚回顶部。

> 这条链路里三个东西缺一不可，都是为了「连续下滑不卡顿、一步跳到底也不卡死」：
> ① 列表尾部的哨兵（`IntersectionObserver`，提前 800px 就补）；
> ② 距**文档**底部不足 400px 也补一批——页脚还在的时候，哨兵后面还跟着一屏页脚，拖滚动条直接到底会**一步跨过哨兵**（实测就卡住不再往下补）；页脚撤掉之后哨兵就在文档末尾，这一条成了保险，留着不碍事；
> ③ `html { overflow-anchor: none }` 关掉滚动锚定——锚定开着时，补进来的内容会被浏览器把视口重新钉回底部，条件一直成立，实测一次「直达底部」连补 12 批（10 → 130 张），把省下来的渲染成本又花回去。

**商品图都是本地缓存。** 优衣库的图片 CDN 返回 `application/octet-stream`，Chrome 的 ORB 会拦掉跨域引用，报告里会是一片空白；两家的商品下架后图也会 404/410。所以图一律下到 `reports/<站点>/img/`，文件名带档位（优衣库是 `u0000000072656@561.jpg`、迪卡侬是 `346498@800.jpg`），换档位不会把旧档当缓存命中。

**优衣库卡片上多了一行「还剩什么尺码」**（2026-09-30 加，在商品名下面一行）。捡漏时真正决定买不买的是「我的码还在不在」：图片已经看得够清楚，而尺码接口里有——每个商品带一个**有货的内部码**数组，再配上侧边栏那份码 → 显示名的词表（`SMA002=XS`、`CMA080=80cm`、`CMD070=W28/28英寸/28码`…，每次 sync 刷进库里的 `size_vocab` 表），于是卡片上写 `剩余：XS · 3XL`（最多列 6 档，再多就只写「剩 12 档」——列太长会把这一行挤到第二行、顶歪同排卡片的价格线；**码全则完全不写这一行**，但高度留着，价格线才对得齐）。同一处还把商品名截短了：优衣库的名字是「主名/一堆形容词」拼的，只留斜线前面那一段。实测覆盖 97.7%，剩下的 2.3% 是睡衣/帽子/手套那类**接口连尺码范围都没给**的商品，卡片上就少这一行。做法与踩过的坑见 [docs/DESIGN-UNIQLO.md](docs/DESIGN-UNIQLO.md) 第七节。

**没图的商品不上榜。** 有的是官网自己就没图（迪卡侬的冷门备件常见，实测 32 件），有的是图在 CDN 上挂了。两种情况对用户是同一件事：卡片上只剩一个灰框，不知道是什么东西，也就没法决定买不买——所以生成报告时直接把它们剔掉（迪卡侬 1310 → 1278 件）。这不是「下架」：商品仍留在库里、终端 `deals <站点> list` 里仍看得到；`ensureImages` 只补缺的图，所以哪天图下到了，下一轮它自动回到榜上。

**两本账存在浏览器里。** 卡片行尾两个图标：爱心＝收进「待拔草」（实心，靠颜色表示收没收），闭眼＝这个款**永久**从榜上消失——有些东西就是不想见第二次，所以没有放回，`hidden` 只增不减。

闭眼是**按款**删的：写进名单的是两个键——这张卡片的商品编号，加上它的**吊牌号**。所以同款的其他颜色会一起消失。这一条是必须的：优衣库一个款有多个颜色、各自一个商品编号，**名字一模一样**（实测 84 组吊牌号下挂着 2~3 件），只删一个的话，另一个照旧在榜上，你会以为「删了怎么还在」。

两本账存在 `localStorage`，报告重新生成、重新抓取都还在；但**只认这一个浏览器 + 这一个网址**——换设备、换域名（`goodprices.online` 与 `deals-pinouts.pages.dev` 是两个 origin）、清缓存都会「复活」。误点了也只有一条撤回路：清掉浏览器存储里那个 `hidden` 键。

**要把屏蔽带到所有地方，用谢绝名单**（存在价格库里，生成报告时直接不发出去）：`deals <站点> block <编号>`，随时 `deals <站点> blocked` 看名单、`unblock` 撤回。它按吊牌号生效，所以同款所有颜色一起走。

> **键名沿用旧的两个报告**（`uniql.picks` / `deca.picks` 等），商品 id 也沿用旧值，所以在合并前那两份报告里点过的收藏和「不再出现」，在这份新报告里原样还在。

## 关键概念

**上市价怎么来的。** 官方原价（或划线价）只降不涨，所以工具记录每次抓到的官方原价，**取历史最大值**作为上市价。首次抓取时它等于当前原价；之后若官方永久降价，工具会保留更高的历史值——那才是真正的上市价。这也是为什么 `sync` 值得每天跑。

**下架 / 退出特价的商品会自动下架。** 抓取池里消失的商品以前会永远留在榜上——`in_stock` 只在商品被抓到时才写，于是它带着「在售」的旧标记一直挂着，点进去才发现官网早没了。现在的规则：

- **连续 2 次成功抓取都没见到** → 移出榜单。不是 1 次：翻页抖动、接口偶发丢页、优衣库限时特优每周轮换都会造成单次缺失。
- **基准是最后一次「成功」的抓取**——失败的运行不参与对比，否则一次接口故障会让全站看起来都下架了。
- **安全阀**：本轮抓到件数不到上一次成功抓取的 60% 时，本轮一件都不标记（一次半截的抓取不该造成全站下架）。
- **历史一条不删**：库里照旧保留，只是不进报告。
- **你 `track` 盯着的例外**：它即使已不在特价也继续显示、明确标成「已不在特价 · 最后见到 9/25」，并弹一条通知——你等它降价，结果它先没了，这件事必须让你看见。

终端里 `deals <站点> stats` 会显示「已不在特价 N 件」和「另有 N 件本轮没见到」，报告里则不出现（榜上只剩现在真在卖的）。文案用「已不在特价」而不是「已下架」是因为：从池子里消失可能是真下架，也可能是活动结束回了原价，我们无法区分，就不替官方下结论。

**两种降价的区别**（决定了该不该现在买）：

- **限时特优**（优衣库 `time_doptimal`）：每周轮换的活动价，下周会涨回去。看到尺码齐、价格合适就可以下手。
- **超值精选**（优衣库 `concessional_rate`）：换季清仓，会一路降到底，但降到最后往往开始断码。可以多等几轮再出手。
- **尾货**（迪卡侬 `endlife`）／**新品**（`new_arrival`）：前者同上，后者是刚上架就在打折。

`sync` 还会单独标出**官方永久降价**（原价本身被下调）——这种比限时活动更值得出手。

## 目录结构

```
src/cli.mjs          命令行入口：解析「站点 + 命令」，调度下面两层
src/core/            两个站点共用的核心
  db.mjs             历史库（SQLite，一张库靠 site 列装两家）
  images.mjs         商品图本地缓存（候选图链 + 站点自定义档位规则）
  report.mjs         组装 payload + 把 CSS/JS/数据/字体内联成单文件 HTML
  fonts.mjs          下载中文字体并按实际用字子集化（声明了 fonts 的站点才用）
  terminal.mjs       终端颜色、按显示宽度补位、通用表格
  cf-wrangler.mjs    Cloudflare Pages 部署（含「大请求体被掐时改用小批次」的兜底）
src/sites/           站点适配器：只有「这家才这样」的东西
  uniqlo.mjs         优衣库：搜索接口、字段映射、标签文案、图片档位、字体、报告开关
  decathlon.mjs      迪卡侬：匿名令牌 + BFF 接口、model 选价、两个图床的缩放写法
web/                 一套 React 报告源码（组件、样式、格式化）
.github/workflows/   每天定时跑的那一轮（抓价 → 报告 → 部署 → 提交库 → 提醒）
scripts/             daily.sh（本机手动跑一轮）+ install-launchd.sh（本机定时的装/卸/改时间）
docs/                REPORT-CONTRACT.md（报告契约）+ 两份站点设计说明
data/deals.db        本地数据库（自动生成，不进版本管理）
data/fonts/          思源黑体原件（首次自动下载，约 16MB）
reports/<站点>/       生成的报告与图片缓存
.build/              Vite 构建产物（app.js / app.css，自动生成、两家共用）
```

**为什么报告要打成 IIFE 单文件。** 报告要能双击直接打开（`file://`），这里有两个坑：`file://` 的源是 opaque origin，**ES module 一律被 CORS 拦掉**，所以 Vite 必须输出 IIFE 而不是默认的 ESM；同理 `fetch('data.js')` 也拿不到数据，数据只能用 `<script>` 内联注入。构建时 `publicDir` 是关掉的（报告用不到 `web/public/`），开发服务器反过来离不开它，所以只在 `build` 时关。

## 关于合并

这个仓库是**两个几乎同源的项目合并成的**：

| 旧仓库 | 现在 |
| --- | --- |
| `~/Desktop/uniql`（优衣库，`uniql <命令>`） | 本站点 `uniqlo` |
| `~/Desktop/decathlon`（迪卡侬，`deca <命令>`） | 本站点 `decathlon` |

两个旧目录**原样留着**，当作备份与对照。合并时做的事：

1. **抽出共享核心。** 两个仓库的 `db.mjs` / `images.mjs` / `report.mjs` / 终端输出工具几乎逐字相同，只是字段名不同（`dsm_code` vs `product_code`、`listPrice/activePrice` vs `originPrice/minPrice`）。这些统一进 `src/core/`，字段名也统一（`product_code` 是站点内唯一号，报告里叫 `id`；给人看的编号统一叫 `code`）。
2. **站点差异收进适配器。** 「抓哪、怎么抓、字段怎么映射、标签叫什么、图怎么缩放、报告上显示哪些元素」全部落在 `src/sites/<站点>.mjs`。所以 `cli.mjs` 与 `web/` 里**没有一处 `if (站点 === …)`**。
3. **一张库装两家。** `data/deals.db`，主键 `(site, product_code)`，同一件商品在两个站点下互不干扰。
4. **一套界面两个皮肤。** 组件与样式表只有一份，靠 `data-site` 与 `meta` 分岔（见上）。
5. **旧的浏览器账本照旧有效。** localStorage 前缀沿用 `uniql` / `deca`，`deals[].id` 沿用旧值。

合并后**功能上只增不减**：两份报告互相有入口、`history` 命令两家都能用、`deals all sync` 一次抓两家。（迪卡侬那份当时还多了一行页脚——2026-09-30 又整块撤了，见下。）两家的版面与交互没有做任何合并简化——各自的实测尺寸、配色、卡片信息层级、标尺排法都按原样保留。

逐像素对照过新旧四份报告（1440 / 900 / 760 / 700 / 390 五档宽度），当时只有两处**有意的**差别：

1. ~~迪卡侬列表视图的现价数字从 16px 变成 18px~~ —— 列表视图 2026-09-30 已撤，这条不再适用（当时的结论是：迪卡侬样式表里那条早就写着、却一直没真正生效的 `--row-price-size: 18px`，合并后第一次落到了数字上）。
2. ~~迪卡侬页脚多了一行~~ —— 页脚 2026-09-30 已整块撤掉，这条不再适用。

顺带修掉一个只在合并后才会暴露的坑：迪卡侬那条 `.picframe { max-width: 72px }` 原本是全局的，旧版卡片用的是另一个类名所以没被它砸到，合并后卡片共用 `.picframe`，会把 288px 的方图压成 72px 的缩略图。当时的修法是把它收进列表行作用域；列表视图撤掉后这条约束已经不在了。

**新库是空库重新抓的**，没有迁移旧的 `uniql.db` / `deca.db`。所以开头几天「上市价」等于当前原价，降幅看着会偏小；等快照攒到几周，这个判断才真正准。想立刻要旧库的历史，见下面的「注意」。

## 部署

两份报告都是静态文件（一个自包含 HTML + 一目录本地商品图），随便往哪个静态托管上发都行。仓库里接好了两个目标，`--target` 切：

### Vercel（默认，每站一个项目）

```bash
vercel login                        # 只需一次
node src/cli.mjs uniqlo deploy      # 生成最新报告，再 vercel deploy reports/uniqlo --project uniql --prod --yes
node src/cli.mjs decathlon deploy   # 同理，项目 decathlon-deals
```

这两个 Vercel 项目是合并前后留下来的旧入口，**早就不是线上地址了**：正式入口是 Cloudflare 上的 <https://goodprices.online>（见下面那节）。留着这段是因为 `deploy` 命令还能用，真要重新捡起来也就一条命令。

挑 `reports/<站点>/` 而不是仓库根目录来部署是刻意的：那个目录里没有 `package.json`，**不会跑依赖安装、也没有 `build` 脚本可跑**——Vercel 只负责原样收下这些文件。生成报告时会顺手在目录里放一份三行的 `vercel.json`（`framework` / `installCommand` / `buildCommand` 全置空），把「这是静态文件」这件事写死，免得被识别成 Vite 预设白跑一遍构建；生成器从不清 `reports/`，所以这份配置不会被下次生成冲掉。

### Cloudflare Pages（一个项目装两份）

```bash
npx wrangler login                  # 只需一次（浏览器点一下 Allow）
node src/cli.mjs all deploy --target cloudflare
```

线上地址：**<https://goodprices.online/uniqlo/>** 与 **<https://goodprices.online/decathlon/>**（域名与项目名在 `src/sites/index.mjs` 的 `CLOUDFLARE` 里；`deals.goodprices.online` 与 `deals-pinouts.pages.dev` 是同一份部署的别名，也一直有效）。

> **三个地址各是一本收藏账。** 收藏/不再出现存在 localStorage 里、按 origin 隔离，所以上面三个域名（加本地 `file://`）是四本互不相通的账。对外只提裸域那一个，别的当备用。

域名在阿里云注册，DNS 也一直在阿里云（没动 NS）。加了两条 CNAME，都指向 `deals-pinouts.pages.dev`：

| 主机记录 | 类型 | 记录值 | 说明 |
| --- | --- | --- | --- |
| `@` | CNAME | `deals-pinouts.pages.dev` | 裸域，正式入口 |
| `deals` | CNAME | `deals-pinouts.pages.dev` | 子域别名 |

Cloudflare 侧分别把这两条挂成 Pages 的自定义域名，自动完成验证并签发证书（Google Trust Services）。**不需要 ICP 备案**——备案只针对服务器在中国大陆境内的网站。

> **`@` 上放 CNAME 是非标准做法**（RFC 不允许 CNAME 与 SOA/NS 之外的记录共存），阿里云放行、公共解析器也会跟随，实测可用。代价是：将来这个域名若要收邮件（MX）或加 SPF/TXT，就得二选一，那时才需要把 NS 迁到 Cloudflare 用它的 CNAME flattening。
>
> 另外 Cloudflare 的文档写「裸域必须是 Cloudflare 上的 zone」，实测**不是硬要求**：用 API 直接挂裸域会被接受，验证方式走 HTTP、照样签发证书。这条是踩过之后记下来的——别照文档那句话就下结论（我一开始就下错了）。

**根路径 `/` 默认进优衣库。** 部署上去的是整个 `reports/`，两份各占一个子目录，所以 `/` 本来什么都没有、打开是 404。生成报告时会顺手写三个小文件到部署根：

- `reports/_redirects` → `/  /uniqlo/  302`（Cloudflare 给真 302，`curl -I /` 能看到 `location: /uniqlo/`）
- `reports/index.html` → 一份 meta refresh 落地页，**相对路径** `uniqlo/`。相对路径的好处是网页上解析成 `/uniqlo/`、本地双击解析成旁边的 `reports/uniqlo/`，两边都对；而且不依赖托管方特性，将来搬到阿里云 OSS 也一样用
- `reports/404.html` → 不存在的路径的兜底页。**这个必须有**：部署根上放了 `index.html` 之后，Cloudflare Pages 会把**任何**不存在的路径都回成 `200 + 落地页`（实测 `/zzz-不存在`、`/uniqlo/nope`、`/favicon.ico` 全是那份 718 字节的落地页）——站点于是永远不 404，打错地址会被悄悄送到优衣库，爬虫也能把任意垃圾路径收成 200。放上 `404.html` 之后 Pages 才回 404 状态码

**根目录还能放一次性的验证文件。** 例如微信站长认证要求在站点根放一个指定名字的 txt、内容是一串令牌——直接丢进 `reports/` 根目录就行：生成器从不清 `reports/`，所以它一直在，下次 `deploy` 也会把它带上（`check-missing` 会发现它是新的）。两点注意：`reports/` 不进 git，所以**换机器或重新克隆要再放一次**；证明归属的令牌只在你自己后台生成的才安全——别人给的令牌等于把域名绑到别人的账号上。

想换默认站点，改 `src/sites/index.mjs` 里的 `DEFAULT_SITE` 一行即可，重跑一次 `report` 就更新。



和 Vercel 那边不一样，这里是**一个项目装两份报告**：命令会把两份都重新生成，再把整个 `reports/` 目录发上去，站点各占一个子目录。所以报头那个「另一家的报告」入口在 Cloudflare 上改成了**同域的相对路径**（`../decathlon/`、`../uniqlo/`），换域名、甚至本地双击都对。这个命令与「对哪个站点做」无关，从哪一站触发都一样。

> **这台机器上必须知道的一件事。** `wrangler pages deploy` 是按 **40MB 一批**打包上传的（bundle 里写死的 `MAX_BUCKET_SIZE`），而这条网络（Clash Verge 的 TUN）传大请求体会断流：实测 1MB×10 并发全过、2MB×3 全过、5MB 起开始掉、40MB×3 就必挂，报 `write EPIPE` / `ERR_HTTP2_STREAM_ERROR`。同一个 13MB 请求体换 `node:https`（HTTP/1.1）或 curl 都 100% 成功，所以是 HTTP/2 大请求体在这条路上不稳，不是网络不通。
>
> 于是 `deploy --target cloudflare` 是**两次尝试**：先照常跑 wrangler；失败就复制一份 wrangler 的 bundle、只把批次从 40MB 改成 2MB，再用 node 跑那份副本（见 `src/core/cf-wrangler.mjs` 里的实测数据与理由）。日常只改两个 HTML 时，第一次尝试就能过（素材已在 Cloudflare 上，`check-missing` 只补变化的那两个文件，实测 2 秒）；只有大批新图时才会走到小批次那条路。

三个两个目标共通的点：

- **部署的是一份快照。** 托管方不会自己抓数据——数据库和抓取脚本都在本地。要更新就再跑一次 `deploy`。
- **收藏 / 不再出现不会跟过去。** 两本账存在 localStorage 里、按域名隔离；Cloudflare 与 Vercel 是两个域名，各是一本账。
- 部署**默认是公开的**：拿到链接的人都能看。要收起来，Vercel 走项目的 Deployment Protection，Cloudflare 走 Cloudflare Access。

## 自动化

**每天 01:00 UTC（北京时间 09:00）由 GitHub Actions 跑一轮**，配置在 [.github/workflows/daily.yml](.github/workflows/daily.yml)。搬到 Actions 的原因很简单：本机那套只在「Mac 开着、你还登录着」时才跑，出差一周就断档。

一轮做这几件事：

| 步骤 | 为什么在 |
| --- | --- |
| `all sync` | 抓两家的最新价格写进历史库——**上市价就是靠这个一天一天攒出来的**，漏一天就少一天 |
| `all report --no-open` | 生成两份报告（`sync` 只动数据库，报告是另一个文件）；缺的商品图/字体会在这一步现下 |
| `all deploy --target cloudflare` | 把 `reports/` 推到 Cloudflare，**线上跟着当天更新** |
| 提交 `data/deals.db` | **这一步就是备份**：每次一条带日期的快照，git 历史本身就是带版本的异地备份 |
| `alert` → 开 Issue | 盯着的商品降价了、或数据断档（>36 小时没抓成功）就开一个 Issue——GitHub 会给仓库的 watch 邮箱发信（本机那套走的是 `osascript` 弹通知，Linux runner 上没这东西） |

### 一次性的设置：两个 Secret

在仓库 **Settings → Secrets and variables → Actions** 里加两个，否则抓价与生成报告照跑、只有最后推 Cloudflare 那一步会失败：

| Secret | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 控制台 → My Profile → API Tokens → 用 **Edit Cloudflare Workers** 模板，或自建一个带 `Account → Cloudflare Pages → Edit` 的令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右侧栏（Workers & Pages 概览页）能抄到 |

### 价格库是「谁在跑」的主人

**`data/deals.db` 进了版本管理**（`.gitignore` 里只给它开了个口子，`data/` 下其余仍忽略）。原因是 runner 每次都是空的：库不进 git 的话，历史每次重置、上市价永远算不出来。

由此带来一条规矩——**本机手动跑之前先拉一次，跑完把库提交回去**：

```bash
git pull                     # 先把 CI 昨天的库拉下来
bash scripts/daily.sh        # 抓价 → 报告 → 部署 → 备份 → 提醒；脚本自己会 pull 一次并提交库
```

### 本机定时（备用，现在没开）

`scripts/daily.sh` + `scripts/install-launchd.sh` 都还在，想退回本机定时就：

```bash
bash scripts/install-launchd.sh              # 装（默认 09:00）
bash scripts/install-launchd.sh --hour 21    # 换时间
bash scripts/install-launchd.sh --uninstall  # 卸
launchctl kickstart -k gui/$(id -u)/com.$(whoami).deals.daily   # 立刻试跑一次
```

> ⚠️ **两条路只留一条**。都开着的话，两边各写各的库再互相推，会覆盖掉对方的抓取结果（本机那份现在也会 pull + commit 了，所以不至于丢数据，但会白抓两遍、还可能撞上推送冲突）。当前状态：**Actions 开着，本机 launchd 已卸载**。

**为什么当初不用 crontab**（实测出来的）：`~/Desktop` 受 macOS 的 TCC 隐私保护，cron 跑起来连目录都读不了（`ls: .: Operation not permitted`），除非把 `/usr/sbin/cron` 加进「完全磁盘访问权限」；而且笔记本 9 点多半在睡觉，cron 错过就跳过、launchd 的 `StartCalendarInterval` 会在唤醒后补跑。

**为什么不用 Cloudflare 的 Cron Triggers / Worker**：抓取、建库、生成报告这一整套是 Node 的（`node:sqlite`、文件读写、Vite 构建、字体子集化），Workers 里没有文件系统、SQLite 要换成 D1、构建与字体子集化都得重做——那是一次移植工程。Actions 则是在 runner 上**原样跑现在这套 CLI**。

### 素材走缓存，不进 git

商品图 168MB + 字体 16MB，都不进仓库（几年下来会把仓库拖到 GB 级），改用 `actions/cache` 缓存 `reports/*/img` 与 `data/fonts`；缓存没命中就现下（`ensureImages` 只补缺的，所以命中之后每天几乎不下载）。

## 注意

- 价格以结账页为准，接口数据仅作参考。
- 本工具与迅销集团、优衣库官方、迪卡侬官方均无关，仅供个人比价使用。请控制抓取频率，别给人家服务器添麻烦。
- 想让新的 `data/deals.db` 直接继承旧库的历史，可以自己写个导入脚本：旧库的 `products` / `price_history` 加上 `site` 列就能塞进来，字段名的对应关系见上面的「关于合并」一节。工具本身不再往回读旧库。
