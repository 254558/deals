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

- 全局变量名固定 `window.__DEALS_DATA__`（旧的两个仓库分别是 `__UNIQL_DATA__` / `__DECA_DATA__`，合并后用这一个）。
- `<html>` 上的 `data-site` 由 `renderHtml` 写入；React 侧也要在 `main.jsx` 里
  `document.documentElement.dataset.site = DATA.site`，这样 `uniql dev` 的开发页也对得上。
- `data-site` 是**版面差异的唯一开关**：两家共用一个 `styles.css`，
  站点特有的几何（图片比例、网格列宽、标尺配色…）全部挂在 `[data-site="…"]` 下。
- 一次构建只有**一个站点**的数据。不存在「一份页面里两家切换」这回事。

## 二、payload 结构

```jsonc
{
  "site": "uniqlo",                       // 'uniqlo' | 'decathlon'
  "generatedAt": "2026-09-27T10:00:00.000Z",
  "recorded": 1234,                       // 数据库里这件商品的累计记录数（deca 报头用）
  "meta": { /* 见下节，站点描述符 */ },
  "deals": [ /* 见第四节 */ ]
}
```

## 三、meta — 站点描述符

`meta` 是**唯一的文案与开关来源**。组件里不许出现 `site === 'uniqlo' ? ... : ...`
这种判断，也不许出现硬编码的中文标签：能读 meta 的一律读 meta。

```jsonc
{
  "label": "优衣库",                    // 站点名，报头 eyebrow
  "pageTitle": "优衣库捡漏榜",           // <title> 与 aria-label 用
  "source": "uniqlo.cn 公开搜索接口",    // 页脚那行数据来源
  "currency": { "sym": "¥", "zero": "¥ 0" },   // 货币符号；零值的写法（两家不同，见下）
  "imageAspect": "3/4",                 // '3/4' | '1/1'，商品图画框比例
  "searchPlaceholder": "搜商品名或吊牌编号",
  "searchLabel": "名称或编号",           // 空结果提示里的措辞："没有「名称或编号」包含…"
  "storagePrefix": "uniql",             // localStorage 键前缀，见第五节
  "showRecorded": false,                // 报头是否显示「共记录 N 件」
  "crossLink": {                        // 报头行尾另一个站点的入口；不需要就 null
    "href": "https://decathlon-deals.vercel.app",
    "label": "迪卡侬",
    "title": "迪卡侬比价报告（新标签打开）"
  },

  "filters": [                          // 工具条页签。匹配语义固定为「标签成员」(tracked 除外)
    { "key": "all", "label": "全部" },
    { "key": "time_doptimal", "label": "限时特优" },
    { "key": "concessional_rate", "label": "超值精选" },
    { "key": "tracked", "label": "待拔草" }
  ],

  // 能按哪些字段排序：工具条那个下拉框照这个渲染（列表视图撤掉后，
  // 这份声明只剩排序一个用途，所以叫 sorts 不叫 columns）。
  // "text": true = 这个字段是文本：排序走中文 localeCompare，默认方向取升序。
  "sorts": [
    { "key": "name",        "label": "商品",   "text": true },
    { "key": "launchPrice", "label": "上市价" },
    { "key": "price",       "label": "现价"   },
    { "key": "rate",        "label": "降幅"   }
  ],

  "features": {                         // 界面开关，全部是布尔；缺省即 false
    "rankBoard": true,          // 页顶「本期降得最狠的 N 件」榜单（uniqlo）
    "stickerTags": false,       // 商品图上的角标（deca 的 尾货/新品）
    "brandMark": false,         // 名称前那块品牌小字（deca）
    "priceOffBadge": false,     // 价格行里的黄底「-xx%」角标（deca）
    "dealBarNumber": true,      // 卡片横条尾部的红色降幅数字（uniqlo）
    "cardChips": false,         // 卡片底部的 chips 行（deca；托住底边对齐）
    "trackChip": false          // ★ 待拔草 chip（deca 的卡片）
  },

  "tagLabels": { "time_doptimal": "限时特优", "concessional_rate": "超值精选" },
  "chipTags": ["endlife", "new_arrival"],   // 哪些标签画成 chip / 角标，顺序即显示顺序

  "foot": {
    "terms": [ { "t": "上市价", "d": "…" } ],   // 页脚名词解释 dl；没有就空数组
    "source": "数据源 uniqlo.cn 公开搜索接口 · 价格以结账页为准 · 本工具与官方无关",
    "notes": ["版面尺寸量自 uniqlo.cn；配色与价格排版跟迪卡侬那份报告统一…"]
  },

  "fontNotice": "Source Han Sans CN (思源黑体) — Copyright © 2014 Adobe …"  // 没有内嵌字体就 null
}
```

### 两家的 meta 差异（照抄用，别自己发明）

| 字段 | uniqlo | decathlon |
| --- | --- | --- |
| `currency` | `{sym:'¥', zero:'¥ 0'}` | `{sym:'￥', zero:'￥0'}` |
| `imageAspect` | `3/4` | `1/1` |
| `storagePrefix` | `uniql` | `deca` |
| `showRecorded` | `false` | `true` |
| `filters` | 全部 / 限时特优 / 超值精选 / 待拔草 | 全部 / 尾货 / 新品 / 待拔草 |
| `sorts` | 商品 / 上市价 / 现价 / 降幅 | 商品 / 上市价 / 现价 / 降幅 / 运动 |
| `features` | `rankBoard`、`dealBarNumber` | `stickerTags`、`brandMark`、`priceOffBadge`、`cardChips`、`trackChip` |
| `fontNotice` | 思源黑体子集声明 | `null` |

## 四、deals — 每件商品

**只有这里列出的字段**。每个键在每件商品上都存在（没有就空串 / 0 / null / false），
写代码时不用 `?.` 兜底。榜单是上千件，payload 每多一个字段就是上千份——
`catchLine` 单项就占 80KB，所以进 payload 的字段是挑过的。

```jsonc
{
  "id": "u0000000072656",   // 站点内唯一；也是 localStorage 里存的那个键
  "code": "488089",         // 显示用编号（uniqlo = 吊牌号；deca = dsm_code）
  "name": "抽褶裙",
  "brand": "",              // deca 有；uniqlo 空串
  "sports": "",             // deca 有；uniqlo 空串
  "season": "2025 秋冬",     // 报顶榜单的小灰字（可能为空）
  "sizeRange": "S ~ XL",    // 同上
  "url": "https://www.uniqlo.cn/product-detail.html?productCode=…",
  "image": "img/u0000000072656@561.jpg",   // 本地缓存相对路径。不会为 null ——
                                            // 没图的商品在生成阶段就被剔掉了（见下）
  "tags": ["concessional_rate"],
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

抓取池（优衣库那两个标签池 / 迪卡侬的特惠专区）里消失的商品，**不能继续留在榜上**：
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

## 五、两本账：localStorage

沿用两家原来的键，**不要改名**，否则用户已经点过的收藏会丢：

```
`${meta.storagePrefix}.picks`    在报告里点过爱心
`${meta.storagePrefix}.dropped`  在报告里点过取消收藏（压住终端 track 进来的）
`${meta.storagePrefix}.hidden`   点过闭眼：**永久**不再出现，没有放回
```

因为 `deals[].id` 沿用了旧仓库的 `productCode` / `dsmCode`，前缀也沿用
`uniql` / `deca`，**两个旧报告里的收藏、隐藏在新报告里原样还在**。

## 六、构建与开发

`vite.config.js` 由仓库根提供（不要改）：IIFE 输出、入口 `web/src/main.jsx`、
产物固定 `.build/app.js` + `.build/app.css`。`publicDir` 只在 build 时关掉。

- `web/index.html` 只给 `deals <site> dev`（Vite 开发服务器）用，它
  `<script src="/data.js">` 拿数据、`<link rel="stylesheet" href="/font.css">` 拿字体。
- 正式报告是 `deals <site> report` 生成的 `reports/<site>/index.html`，
  CSS/JS/数据/字体全部内联，**不许有任何外部请求**。
- 商品图必须用 payload 里那个本地相对路径（`img/…`），不能回头去引 CDN ——
  优衣库的 CDN 会被 ORB 拦成空白，这条是踩过的坑。
