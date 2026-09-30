# 尾货市集

**为什么要有它**：两份报告的价都是**线上**的。但优衣库/迪卡侬真正香的那些尾货，常常只在
某个线下门店的货架上——线上永远看不到。这个页面让用户把自家附近店里的漏拍下来发上去，
别人想要就联系他、寄快递。

一句话定性：**这里只是把东西摆出来，交易是买家和卖家之间的事**。本站不经手钱、不担保、
不介入纠纷。

---

## 一、为什么是这套结构

| 选择 | 为什么 |
| --- | --- |
| **挂在现有 Pages 项目里**（`functions/` 目录）而不是另起一个 Worker | 报告已经在这个 Pages 项目上。挂同一个项目里就是**同源**——不用 CORS、不用新域名，也不用动 DNS。（这个域名的 NS 在阿里云、不在 Cloudflare，所以 Worker Routes 那条路本来也走不通。） |
| **图片存 D1 的 BLOB**，不用 R2 / KV | R2 要绑支付方式；KV 又多一个要配的资源。这个量级（个人市集、几十上百件）D1 完全够，而且只需要**一个**绑定。代价是单行不能太大 → 图片在浏览器端先压到 ≤400KB（`market/index.html` 里那段 canvas 压缩），服务端再卡一遍。 |
| **没有账号体系** | 谁都能发（用户选的那条路）。身份靠「发帖时回一条删除凭据」+ 站长随时删 + 读者举报，不引入注册登录那一整套。 |
| **页面是手写的单页**，不走报告那套 React 管线 | 报告要能双击打开（`file://`）、要单文件内联；这个页面反过来——它必须有后端，也永远只在线上用。所以零构建，一个文件，改完直接部署。 |

```
goodprices.online/
├── uniqlo/  decathlon/      静态报告（Pages）
├── market/                  市集页面（market/index.html 拷过去的）
└── api/...                  Pages Functions ── D1（deals-market）
```

`reports/_routes.json` 里把 Functions 限定在 `/api/*`：只有市集走函数，两份报告和 2000 多张
图仍然由 Pages 直接发静态文件，不为了市集给整站加一层调用。

## 二、接口

| 方法 | 路径 | 干什么 |
| --- | --- | --- |
| `GET` | `/api/listings` | 在售列表，最新在前（最多 200 条）。**不含图片字节** |
| `POST` | `/api/listings` | 发一件。`{title, price, size, store, contact, note, image}`，`image` 是 data URL |
| `GET` | `/api/img/<id>` | 商品图（`Cache-Control: immutable`，id 随机、内容永不改） |
| `POST` | `/api/delete` | 发帖人自己下架。`{id, token}` |
| `POST` | `/api/report` | 举报。累加到 5 次自动下架，等站长回看 |

发帖成功那一刻会回一条 `token`——**这是唯一的删除凭据**，服务端只存它的 SHA-256。
浏览器会把它存进 `localStorage`（所以发帖那个浏览器里，自己那件下面会有「下架」按钮）。
换个浏览器或清了缓存，就只剩站长能删了。这是没有账号体系的必然代价，写在这里免得以后奇怪。

## 三、防刷与审核

- **蜜罐字段**：表单里有个肉眼看不见的 `website`，机器人会填 → 直接静默丢弃（返回成功，不落库）。
- **限速**：每 IP 24 小时最多 5 件；全站每天最多 200 件。IP 只存**哈希**，不存原始地址。
- **举报**：同一件被举报 5 次自动下架。
- **站长工具**（不需要往线上放任何管理密钥）：

  ```bash
  node scripts/market-admin.mjs list          # 在售的（带举报数）
  node scripts/market-admin.mjs reported      # 被举报过的
  node scripts/market-admin.mjs hide <id>     # 下架
  node scripts/market-admin.mjs unhide <id>   # 放回
  node scripts/market-admin.mjs remove <id>   # 连图真删
  ```

  走本机已经登录过的 wrangler（`d1 execute --remote`），只有你自己能用。

> 想做「先审后发」或者接 Turnstile 人机验证：都是在这个结构上加——`validate` 之后插一步、
> 或者把 `status` 从「直接上架」改成「待审」。现在没做，是因为用户选的是「任何人可发，随时删」。

## 四、部署与运维

```bash
# 建表（只在新环境/改了 schema 时做）
npx wrangler d1 execute deals-market --remote --file=market/schema.sql

# 部署：跟报告一起走
node src/cli.mjs all deploy --target cloudflare     # 会带上 functions/ 和 market/
```

改动记录：

- **2026-09-30**：D1 数据库 `deals-market`（区域 APAC）建好；Pages 项目的**生产环境**绑上了
  `DB` → 这个库（`fail_open: false`，production 与 preview 必须给同一个值——这是 Cloudflare
  的硬要求，踩过一次）。
- **踩过的坑**：D1 把 BLOB 回给函数时是**普通数组**（`[137,80,78,…]`），不是 `ArrayBuffer`。
  直接 `new Response(数组)` 会把它按字符串拼出来，图全废。必须套一层 `new Uint8Array(...)`
  （对数组 / ArrayBuffer / TypedArray 三种都对）。本地冒烟测试抓到的，见
  `scripts/market-smoke.mjs`。

## 五、边界（写清楚，免得日后扯皮）

1. **不经手钱。** 页面只显示卖家的联系方式，钱和货都在他们之间走。想加担保交易，那性质就变了
   （要实名、要备案、出纠纷要担责），不是一个页面能顺手加的东西。
2. **用户发布内容会改变这个站的性质。** 现在它是「个人比价工具」；一旦有用户发帖、尤其带交易，
   在国内通常被当作互联网信息服务，要求 ICP 备案 + 实名。**本站目前没有备案**——这是已知的
   取舍，不是漏掉的待办。
3. **没有账号 = 没有可信身份。** 骗子的成本只是换个浏览器再来。页面上已经把「建议走担保交易
   或当面交易」写在最显眼的位置，但这句话挡不住所有事。
4. **图片存 D1 只适合这个量级。** 上千件、或者单图超过 1MB 就该换 R2 + 图片处理。
