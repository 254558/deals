# 报告数据契约（web/ 与 core 之间唯一接口）

这份文件是权威约定。`src/core/report.mjs` 按它产出数据，`web/` 按它渲染。
两边都不许私自加字段或改语义——要改先改这份文件。

## 一、注入方式

报告是**自包含单文件**（`file://` 双击就能看），所以数据不能用 `fetch`，
必须内联成一个全局变量，再由同一份 IIFE bundle 读取：

```html
<html lang="zh-CN" data-site="uniqlo">
  ...
  <script>window.__DEALS_DATA__ = { ... };</script>
  <script>/* app.js 内联 */</script>
```

- 全局变量名固定 `window.__DEALS_DATA__`（旧仓库叫 `__UNIQL_DATA__`，合并后用这一个）。
- `<html>` 上的 `data-site` 由 `renderHtml` 写入；前端也要在 `main.js` 里
  `document.documentElement.dataset.site = DATA.site`，这样 `uniql dev` 的开发页也对得上。
- `data-site` 是**版面差异的唯一开关**：共用一个 `styles.css`，
  站点特有的几何（图片比例、网格列宽、标尺配色…）全部挂在 `[data-site="…"]` 下。
- 一次构建只有**一个站点**的数据。不存在「一份页面里多站切换」这回事。

## 二、payload 结构

```jsonc
{
  "site": "uniqlo",                      
  "generatedAt": "2026-09-27T10:00:00.000Z",
  "recorded": 1234,                       // 数据库里的累计记录数。当前不显示它
                                          // （`meta.showRecorded` 都是 false），留着是数据
  "meta": { /* 见下节，站点描述符 */ },
  "categories": [ /* 见第五节：分类树，只带前两层 */ ],
  // 「我的 → 双十一指南」那一页的数据。**可能是 null**（内容文件读不到 / 写坏了 /
  // 是没跑过 buildGuide 的老报告），引用它一律 `?.` 兜底。见第六节。
  "guide": { /* 见第六节 */ },
  // deals 已经过两道过滤（都在生成阶段，页面不做判断）：
  //   ① 谢绝名单里的不发（库里 blocked 表，按吊牌号，见 README 的 block 命令）
  //   ② 没有本地图的商品不发（官网自己就没图 / 图在 CDN 上挂了）
  "deals": [ /* 见第四节 */ ]
}
```

（曾经还有一个顶层键 `top`——页顶「降得最狠的 N 件」那份算好的榜单。榜单改成前端
从 `deals` 现算之后它就没人读了，**已删**。别再照老代码往 payload 里塞它。）

## 三、meta — 站点描述符

`meta` 是**唯一的文案与开关来源**。组件里不许出现 `site === 'uniqlo' ? ... : ...`
这种判断，也不许出现硬编码的中文标签：能读 meta 的一律读 meta。

```jsonc
{
  "label": "优衣库",                    // 站点名，报头 eyebrow
  "pageTitle": "优衣库捡漏榜",           // <title> 与 aria-label 用
  "currency": { "sym": "¥", "zero": "¥ 0" },   // 货币符号；零值的写法
  "imageAspect": "3/4",                 // '3/4' | '1/1'，商品图画框比例
  "searchPlaceholder": "搜商品名或吊牌编号",
  "searchLabel": "名称或编号",           // 空结果提示里的措辞："没有「名称或编号」包含…"
  "storagePrefix": "uniql",             // localStorage 键前缀，见第七节
  "showRecorded": false,                // 报头是否显示「共记录 N 件」
  // 报头行尾那组入口（数组为空就一个都不渲染）。
  "features": {                         // 界面开关，全部是布尔；缺省即 false
    "rankBoard": true,          // 页顶「本期降得最狠的 N 件」榜单（uniqlo）
    "stickerTags": false,       // 商品图上的角标（尾货/新品）
    "brandMark": false,         // 名称前那块品牌小字
    "priceOffBadge": false,     // 价格行里的黄底「-xx%」角标
    "dealBarNumber": true,      // 卡片横条尾部的红色降幅数字（uniqlo）
    "cardChips": false,         // 卡片底部的 chips 行
    "trackChip": false          // ★ 待拔草 chip
  },

  "tagLabels": { "time_doptimal": "限时特优", "concessional_rate": "超值精选" },
  "chipTags": ["endlife", "new_arrival"],   // 哪些标签画成 chip / 角标，顺序即显示顺序

  // 页脚整块撤了（2026-09-30）：foot / fontNotice / source 三个字段一起删。
  // 理由：名词解释、数据来源、版面说明、字体署名那几段，用户不看。
  // ⚠️ 内嵌字体的授权署名**不能删**（Apache-2.0），它现在落在内嵌 CSS 的注释里
  //    （core/fonts.mjs 的 buildFontCss 把 fonts.notice 写成 /* … */）——页面上不显示，
  //    但随文件一起分发出去了。
}
```

### meta 差异（照抄用，别自己发明）

| 字段 | uniqlo |
| --- | --- | --- |
| `currency` | `{sym:'¥', zero:'¥ 0'}` |
| `imageAspect` | `3/4` |
| `storagePrefix` | `uniql` |
| `features` | `rankBoard`、`dealBarNumber` |

## 四、deals — 每件商品

**只有这里列出的字段**。每个键在每件商品上都存在（没有就空串 / 0 / null / false），
写代码时不用 `?.` 兜底。榜单是上千件，payload 每多一个字段就是上千份——
`catchLine` 单项就占 80KB，所以进 payload 的字段是挑过的。

```jsonc
{
  "id": "u0000000072656",   // 站点内唯一；也是 localStorage 里存的那个键
  "code": "488089",         // 显示用编号（吊牌号）
  "name": "抽褶裙",   // 优衣库：**已经截断过**——官网名字是「主名/一堆形容词」拼的
                       // （「高性能修身防皱衬衫/长袖衬衣商务通勤」），只留斜线前面那截。
                       // 完整名字在库里的 extra.fullName，不进 payload
  "brand": "",              // 品牌（这一站空串）
  // 「还剩什么尺码」。优衣库卡片**用它代替商品名**（码全则照旧显示名字，2026-09-30 定）。
  // 三种值：
  //   null                     尺码翻译不出来（睡衣/帽子/手套那类接口连范围都没给）
  //   { full: true,  labels }  该款所有档都有货 → 卡片显示**商品名**（断码才显示尺码）
  //   { full: false, labels }  断码 → 卡片显示「剩余：W21 · W23」，名字改挂在 title/aria-label 上
  // labels 是给人看的短名，**一律是厘米**（'70cm'、'53cm'、'22.5cm'）或原本就有的字母码
  // （'M'、'AA65'、'均码'）——「W28」那种美制腰围码没人读得出来。换算规则见
  // src/sites/uniqlo.mjs 的 shortLabel。组件把它们渲染成一个个 `<kbd>` 方块，
  // 最多列 5 档（超过 5 档那行会折行、顶歪同排卡片的价格线），再多只显示 count。
  // 怎么算出来的见 src/sites/uniqlo.mjs 的 sizeInfo：词表存在库里（size_vocab 表），
  // 「都有」用「同家族内在售的码是否连成一段」判。
  "sizes": { "full": false, "labels": ["P21", "W23"], "count": 2 },
  "url": "https://www.uniqlo.cn/product-detail.html?productCode=…",
  "image": "img/u0000000072656@561.webp",  // 本地缓存相对路径（统一 WebP，见 docs/DESIGN-UNIQLO.md）。不会为 null ——
                                            // 没图的商品在生成阶段就被剔掉了（见下）
  "tags": ["3wskirtdrs", "1111WOMEN"],
                       // ⚠️ 这是**分类码**（二层子类码，再加「男女同款」带到的另一个顶层码），
                       // **不是**促销标签 —— 2026-10-06 起 `category` / `tags` 就是这样分工的
                       // （见 App.vue 的分类筛选）。所以**别**拿它去查 `meta.tagLabels`（那张表
                       // 是促销标签的译名，在这个字段上一条都命中不了）。分类名去 `categories` 里查。
  "launchPrice": 249,
  "price": 59,
  "saving": 190,
  "rate": 0.7631,           // 0~1 的精确降幅（不是四舍五入后的整数百分比）
  "tracked": false,         // 终端 track 进来的
  "gone": false,            // 已不在特价（见下）；只有 tracked 的可能是 true
  "lastSeenAt": null        // 只对 gone 的有值：最后一次见到的时间，如 "2026-09-25T…Z"
}
```

### `gone`：已不在特价的商品

抓取池（优衣库那两个标签池）里消失的商品，**不能继续留在榜上**：
`in_stock` 只在商品被抓到时才写，于是一件下架的商品会带着「在售」这个旧标记一直挂着，
用户点进去才发现官网早没了。

规则（实现见 `src/core/db.mjs` 的 `saveSnapshot`）：

- **连续 2 次成功抓取都没见到** → `missed >= 2` → 榜单不收它（`listDeals` 里 `missed < 2`）。
  不是 1 次：翻页抖动、接口偶发丢页、优衣库限时特优每周轮换都会造成单次缺失。
- **基准是最后一次「成功」的抓取**，失败的运行不参与对比——否则一次接口故障会让全站看起来都下架了。
- **安全阀**：本轮抓到件数不到上一次成功抓取的 60% 时，本轮一件都不标记。
- **历史一条不删**：库里照旧保留（价格历史是这个工具唯一不可再生的资产），只是不进报告。
- **`tracked` 例外**：手动 track 的商品即使 `gone` 也照旧进 payload（`listDeals` 排除它、
  `listTracked` 再把它带回来），页面标成「已不在特价 · 最后见到 9/25」——你等它降价，
  结果它先没了，这件事必须让你看见。`lastSeenAt` 就是给这句话用的。

**文案为什么是「已不在特价」而不是「已下架」**：从池子里消失有两种可能——真下架，
或者活动结束回了原价；我们无法从池成员关系区分这两者，所以不替官方下结论。

## 五、categories — 分类树（只带前两层）

站名下面那个枝杈菜单用。**只带前两层**（顶层 4 支 + 二层 50 个）是有意的：
接口一共给了 1141 条，三层及以下占 1087 条，全塞进单文件报告要多约 45KB，
而菜单只展开到第二层——50 条约 2KB。层级靠 `level` / `parent` 表达，界面按 `parent` 挂枝杈。

```jsonc
{ "code": "1111WOMEN", "name": "女装", "level": 0, "parent": null }
```

`deals[].category` 存的就是这里的顶层 `code`（每件恰好一个，稳定）。

## 六、guide — 「我的 → 双十一指南」

这一页每天随报告重新生成（用户 2026-10-12：「我希望你能每天抓一些信息生成报告，
如果抓不到，就写清楚让用户自己手动去查……用户一点到这个页面，看一下教程，
就明白怎么买最划算了」）。组装在 `src/core/guide.mjs` 的 `buildGuide`，由 `cli.mjs` 算一次、
传给 `buildPayload` —— **`buildPayload` 自己不组装它**，因为那要联网探测，
而下图那一趟（`remote: true`）不该为了指南多打几个请求。

`guide` **可能是 `null`**（内容文件读不到 / 写坏了 / 老报告），组件那边有兜底，
所以引用它一律 `GUIDE?.xxx`。内容分四层，页面上标出各自的成色：

| 层 | 来源 | 每天会变吗 | 页面上的说法 |
| --- | --- | --- | --- |
| 今日实况 | **不在这里**——前端从 `deals` 现算 | 会 | 「随报告每天更新」 |
| 领取入口可达性 | `probeOne` 探测 `content/double11.json` 里的 url | 会 | 「今天可达」/「今天没抓到，点这里自己去查」/「本次没探测」 |
| 往年经验 | `content/double11.json` 的 `reference`（人工维护，**可以为 null**） | 不会 | 「人工整理 · 未经核实」 |
| 时间表·券档位·凑单·避坑 | `content/double11.json`（人工维护） | 不会 | 「人工整理 · 更新于 X · 以官方页为准」 |

```jsonc
{
  "updatedAt": "2026-10-12",            // 人工整理的日期（给人看的那句「更新于 X」）
  "expiresAt": "2026-11-13",            // 过了这天页顶挂一条「窗口已经过去了」。可以为 null
  "intro": "就三件事：…",
  "generatedAt": "2026-10-12T…Z",       // 这份报告生成的时刻
  "probedAt": "2026-10-12T…Z",          // 探测那一刻；**`--no-probe` 时为 null**
  "sync": {                             // 价格库的新鲜度（口径与 `deals alert` 的断档判定同一个常量）
    "lastAt": "2026-10-12T…Z",          // 最后一次成功抓取；从来没成功过是 null
    "hoursAgo": 3.2,                    // 距那一刻多少小时；没抓到过是 null
    "stale": false,                     // 超过 STALE_HOURS（36）→ true，页顶挂提示
    "staleHours": 36
  },
  // 时间表。**倒计时不在这里算**：报告可能是几天前生成的，用 generatedAt 算出来的
  // 「还有 2 天」到读的人手里就是错的。只把 at 原样带过去，由页面按读者的时钟现算。
  "schedule": [
    { "when": "今晚（10/12）20:00",      // 给人看的标签
      "at": "2026-10-12T20:00:00+08:00", // 机器算倒计时用；人工没写就是 null
      "what": "京东现货首发开卖，不用付定金，直接下单",
      "todo": "数码家电刚需今晚看；衣服也可以先比价" }
  ],
  "timeNotes": ["…"],
  // 往年经验：官方口径还没公布时先顶上的参考层（用户 2026-10-12：「没开始之前，
  // 你能先按照往年的经验写一些参考性的建议吗……告诉大家等活动开始了、能抓到了，
  // 再给大家详细准确的信息」）。**可以为 null** —— 内容里没写 / 写空了，
  // 页面上就整段没有（不渲染半页）。headline 是页顶那条置顶说明。
  "reference": {
    "headline": "现在还没有官方口径：今年的档期、券面额都还没公布…官方口径出来之后会换成准确版…",
    "items": [{ "t": "节奏：10 月中下旬启动，11 月 11 日收尾", "d": "…" }],
    "note": "以上都是往年的规律、不是今年的承诺…"
  },
  "sources": [                          // 领券入口。probe 的三种值分得很清（见下）
    { "name": "平台红包会场", "how": "淘宝 APP 搜双11红包口令进会场…",
      "url": "https://www.taobao.com",
      "probe": { "ok": true, "status": 200, "title": "淘宝网", "ms": 312 } }
  ],
  "formula": "把商品的折后价凑到 300 的整数倍…",
  "formulaTips": ["…"],
  "stackOrder": ["官方立减 / 商品直降", "店铺券", "跨店满减", "88VIP 95 折", "平台红包", "支付优惠"],
  "stackNote": "顺序反了优惠基数会变大、省得少。",
  "byCategory": [{ "t": "羽绒服 / 厚冬装", "d": "…" }],
  "pitfalls": [{ "t": "凑完退货会重算优惠", "d": "…" }],
  "summary": "今晚 8 点京东开卖可以先看价…"
}
```

### `sources[].probe` 的三种值

- `null` —— **这一趟没探测**（`report --no-probe` / `deals dev`）。不是失败，页面上说「本次没探测」。
- `{ ok: true, status, title, ms }` —— HTTP 打通了。**只说明页面能打开，不代表券还在发**：
  平台会拿一个验证页顶掉 HTTP 200（2026-10-12 实测京东搜索页就是「京东验证」拦截页）。
  所以页面上那句「以官方页为准」不能省，别让一个 200 被读成"券还在"。
- `{ ok: false, status: 0, error, ms }` —— 探测了但没打通（超时 / WAF / DNS）。页面上说
  「今天没抓到，点这里自己去查」，链接照给。

`probeOne` **永不抛**：超时、DNS 没了都只是 `ok: false`，绝不会因为一个打不开的入口
让整份报告生成失败。

### 为什么不解析券面额

2026-10-12 实测：京东搜索页返回「京东验证」拦截页；天猫、优衣库首页都是 JS 空壳
（6KB，正文里没有「限时特优/双十一/预售」任何一个词）。所以「抓券档位」在这些站点上
做不成——与其写一个假装能抓到、实际永远返回空的解析器，不如老实只报入口通不通，
券的档位继续走人工整理那一层。**这是刻意的边界，不是没做完。**

### 「往年经验」那层为什么只能写成条件句

用户当时的判断是"抓不到是因为活动还没开始"，并希望页面上告诉大家"等活动开始了、
能抓到了，再给大家详细准确的信息"。但上面那段实测说明：拦路的是 **JS 空壳和反爬**
（京东返回验证页），不是时间 —— 活动真开始了，同一个 URL 大概率还是同样拿不到正文。
所以这句话**不能写成承诺**（"开卖后就能自动给你准确档期"），只能写成条件句：

- 页面上说的是"官方口径出来之后会换成准确版"，**换的人/途径**是**人工改这份 JSON**
  （`content/double11.json` 的 `reference` / `schedule`），不是这边新写了个解析器；
- 兜底永远是同一句可执行的指示：**以你点进去看到的官方页为准**；
- 真要有一天能从官方页读出档期，那就属于改 `core/guide.mjs` 的抓取层（②），
  到时候把这段和 `reference` 一起改掉。

`reference` 是**可选**层：官方口径公布之后，要么整段删掉、要么把 `headline` 改成已核实，
`test/guide.test.mjs` 里那几行钉真内容形状的断言会跟着红一次 —— 那是提醒，照着改。

## 七、两本账：localStorage

沿用原来的键，**不要改名**，否则用户已经点过的收藏会丢：

```
`${meta.storagePrefix}.picks`    在报告里点过爱心
`${meta.storagePrefix}.dropped`  在报告里点过取消收藏（压住终端 track 进来的）
`${meta.storagePrefix}.hidden`   点过闭眼：**永久**不再出现，没有放回
```

因为 `deals[].id` 沿用了旧仓库的 `productCode`，前缀也沿用
`uniql`，**旧报告里的收藏、隐藏在新报告里原样还在**。

## 八、构建与开发

`vite.config.js` 由仓库根提供（不要改）：IIFE 输出、入口 `web/src/main.js`、
产物固定 `.build/app.js` + `.build/app.css`。`publicDir` 只在 build 时关掉。

- `web/index.html` 只给 `deals <site> dev`（Vite 开发服务器）用，它
  `<script src="/data.js">` 拿数据、`<link rel="stylesheet" href="/font.css">` 拿字体。
- 正式报告是 `deals <site> report` 生成的 `reports/<site>/index.html`，
  CSS/JS/数据/字体全部内联，**不许有任何外部请求**。
- 商品图必须用 payload 里那个本地相对路径（`img/…`），不能回头去引 CDN ——
  优衣库的 CDN 会被 ORB 拦成空白，这条是踩过的坑。
