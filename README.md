# deals · 比价与捡漏工具

一个命令行工具 + 一份自包含网页报告。抓零售商的公开接口，**记录每件商品的上市价（历史最高原价）与现价**，算出精确降幅，把正在降价的商品排成一张捡漏榜。

目前支持两个站点：

| 站点 | 抓什么 | 报告 |
| --- | --- | --- |
| `uniqlo` 优衣库 | 全站特价（限时特优 + 超值精选） | `reports/uniqlo/index.html` |
| `decathlon` 迪卡侬 | 特惠专区 | `reports/decathlon/index.html` |

```
编号      商品                              上市价      现价     降幅       省   月销  标签
──────────────────────────────────────────────────────────────────────────────────────────
488089    抽褶裙                              ¥249       ¥59     -76%     ¥190  489,737  超值精选
482979    廓形针织T恤/短袖                    ¥149       ¥39     -74%     ¥110  157,687  超值精选
482274    PUFFTECH空气棉棉服无领茄克/外套      ¥499      ¥149     -70%     ¥350  317,370  超值精选
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

**两种视图。** 工具栏右上角切换。大图是分类页那种卡片墙；列表是一张**门店价签**——左边小图、中间名称、右边价格从上市价坍缩到现价，最右是那根**降价标尺**：横轴就是价格轴，左端上市价、右端零，墨条从上市价铺到现价，所以墨条长度直接等于降了多少。两个视图共用同一套筛选与搜索，切换视图不丢状态。

**窄屏（≤760）工具栏只留页签一行，并且钉在顶上。** 搜索/排序/视图/计数那一档全撤（屏幕金贵，而排序默认就是最该看的「降幅」），剩下的一行 `57px` 常驻——1302 件商品，滚到中段想「只看尾货」，不该一路滚回顶部。两家行为一致。

**商品图都是本地缓存。** 优衣库的图片 CDN 返回 `application/octet-stream`，Chrome 的 ORB 会拦掉跨域引用，报告里会是一片空白；两家的商品下架后图也会 404/410。所以图一律下到 `reports/<站点>/img/`，文件名带档位（优衣库是 `u0000000072656@561.jpg`、迪卡侬是 `346498@800.jpg`），换档位不会把旧档当缓存命中。

**两本账存在浏览器里。** 卡片行尾两个图标：爱心＝收进「待拔草」（实心，靠颜色表示收没收），闭眼＝这件从榜上消失（工具栏右端随即多出「已隐藏 N 件 · 放回」，一点全部放回——误点了只有这一条回头路）。两本账存在 `localStorage`，报告重新生成、重新抓取都还在，但换浏览器或清缓存就没了。

> **键名沿用旧的两个报告**（`uniql.picks` / `deca.picks` 等），商品 id 也沿用旧值，所以在合并前那两份报告里点过的收藏和「不再出现」，在这份新报告里原样还在。

## 关键概念

**上市价怎么来的。** 官方原价（或划线价）只降不涨，所以工具记录每次抓到的官方原价，**取历史最大值**作为上市价。首次抓取时它等于当前原价；之后若官方永久降价，工具会保留更高的历史值——那才是真正的上市价。这也是为什么 `sync` 值得每天跑。

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
scripts/             每天那次定时任务：daily.sh（干活）+ install-launchd.sh（装/卸/改时间）
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

合并后**功能上只增不减**：迪卡侬那份报告多了一行页脚（数据来源与免责声明，原来没有）、两份报告互相有入口、`history` 命令两家都能用、`deals all sync` 一次抓两家。两家的版面与交互没有做任何合并简化——各自的实测尺寸、配色、卡片信息层级、标尺排法都按原样保留。

逐像素对照过新旧四份报告（1440 / 900 / 760 / 700 / 390 五档宽度 × 大图/列表两个视图），只有两处**有意的**差别：

1. **迪卡侬列表视图的现价数字从 16px 变成 18px。** 迪卡侬那份样式表一直声明着 `--row-price-size: 18px`（理由是「这是一张要横着扫的表，16px 太轻」），但它旧版的行内价格是把符号和数字拼成一个字符串渲染的，那条规则实际没落到数字上。合并后两家共用一套「符号 / 整数 / 小数」三段式价格，于是这条早就写在样式表里的规则**第一次真正生效**。卡片视图两家仍严格用官网的 16px。
2. **迪卡侬页脚多了一行**（见上）。

顺带修掉的两个只在合并后才会暴露的坑：迪卡侬那条 `.picframe { max-width: 72px }` 原本是全局的，旧版卡片用的是另一个类名所以没被它砸到，合并后卡片共用 `.picframe`，会把 288px 的方图压成 72px 的缩略图（已收进列表行作用域）；以及超长的迪卡侬商品名在窄屏下会把整页顶出横向滚动（行的名称格要自己声明 `overflow: hidden`，卡片那格的两行截断管不到它）。

**新库是空库重新抓的**，没有迁移旧的 `uniql.db` / `deca.db`。所以开头几天「上市价」等于当前原价，降幅看着会偏小；等快照攒到几周，这个判断才真正准。想立刻要旧库的历史，见下面的「注意」。

## 部署

两份报告都是静态文件（一个自包含 HTML + 一目录本地商品图），随便往哪个静态托管上发都行。仓库里接好了两个目标，`--target` 切：

### Vercel（默认，每站一个项目）

```bash
vercel login                        # 只需一次
node src/cli.mjs uniqlo deploy      # 生成最新报告，再 vercel deploy reports/uniqlo --project uniql --prod --yes
node src/cli.mjs decathlon deploy   # 同理，项目 decathlon-deals
```

线上地址：优衣库 <https://uniql-tau.vercel.app>、迪卡侬 <https://decathlon-deals.vercel.app>。

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

**根路径 `/` 默认进优衣库。** 部署上去的是整个 `reports/`，两份各占一个子目录，所以 `/` 本来什么都没有、打开是 404。生成报告时会顺手写两个小文件到部署根：

- `reports/_redirects` → `/  /uniqlo/  302`（Cloudflare 给真 302，`curl -I /` 能看到 `location: /uniqlo/`）
- `reports/index.html` → 一份 meta refresh 落地页，**相对路径** `uniqlo/`。相对路径的好处是网页上解析成 `/uniqlo/`、本地双击解析成旁边的 `reports/uniqlo/`，两边都对；而且不依赖托管方特性，将来搬到阿里云 OSS 也一样用

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

每天 09:00 跑一轮，装成 launchd 任务（已经在这台机器上装好了）：

```bash
bash scripts/install-launchd.sh              # 装（默认 09:00）
bash scripts/install-launchd.sh --hour 21    # 想换时间
bash scripts/install-launchd.sh --uninstall  # 卸
launchctl kickstart -k gui/$(id -u)/com.$(whoami).deals.daily   # 立刻试跑一次
```

`scripts/daily.sh` 一轮做五件事，日志追加到 `logs/daily.log`（一天一段，带每步的退出码）：

| 步骤 | 为什么在 |
| --- | --- |
| `all sync` | 抓两家的最新价格写进历史库——**上市价就是靠这个一天一天攒出来的**，漏一天就少一天 |
| `all report --no-open` | 生成两份报告（`sync` 只动数据库，报告是另一个文件） |
| `all deploy --target cloudflare` | 把 `reports/` 推到 Cloudflare，**线上跟着当天更新**。这一步内部会把两份报告再生成一遍（交叉入口要改成同域相对路径），所以上一步可以理解成「保证本地一定有一份」——deploy 若在上传阶段失败，本地报告照样是新的，不会两头空 |
| `backup` | 这个项目里**只有价格库不可再生**，而它开着 WAL、直接 `cp` 不安全，所以走 `VACUUM INTO`；有 iCloud 就同时写一份到机器之外 |
| `alert` | 盯着的商品降价了、或数据断档（>36 小时没抓成功）就弹系统通知 |

任何一步失败都会**主动弹一条失败通知**（只写进日志等于没人知道）。实测一轮约 70 秒，其中部署那步 **3 秒**（日常只改两个 HTML，素材已在 Cloudflare 上，`check-missing` 只补变化的文件）。

**为什么是 launchd 而不是 crontab**（两个都是实测出来的）：

1. **cron 根本读不到项目。** `~/Desktop` 受 macOS 的 TCC 隐私保护，cron 跑起来是这样：

   ```
   ===== 2026-09-30 14:53:01 =====
   pwd=/Users/zhangshuai/Desktop/deals
   目录前几项: ls: .: Operation not permitted      ← 目标目录能进，但读不了
   ```

   除非去「系统设置 → 隐私与安全 → 完全磁盘访问权限」里把 `/usr/sbin/cron` 加进去（要管理员密码，而且等于给系统 cron 开了很宽的权限），否则这条路走不通。项目现在在 `~/deals`，不在保护目录里，launchd 直接就能读写——同一台机器上换成 `~/deals-cron-probe` 实测就一切正常。
2. **笔记本 9 点多半在睡觉。** cron 错过的时间点直接跳过；launchd 的 `StartCalendarInterval` 会在唤醒之后补跑一次。

`install-launchd.sh` 里的 plist 是**现生成**的：仓库路径、node 路径、用户名都取当前机器，所以换台机器、或者仓库改个目录名，重跑一遍这个脚本就行（`daily.sh` 自己也是按脚本位置定位仓库的，不写死路径）。

## 注意

- 价格以结账页为准，接口数据仅作参考。
- 本工具与迅销集团、优衣库官方、迪卡侬官方均无关，仅供个人比价使用。请控制抓取频率，别给人家服务器添麻烦。
- 想让新的 `data/deals.db` 直接继承旧库的历史，可以自己写个导入脚本：旧库的 `products` / `price_history` 加上 `site` 列就能塞进来，字段名的对应关系见上面的「关于合并」一节。工具本身不再往回读旧库。
