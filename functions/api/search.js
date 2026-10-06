import { json, fail, clean } from './_lib.mjs';

const ENDPOINT = 'https://d.uniqlo.cn/p/hmall-sc-service/search/searchWithDescriptionAndConditions/zh_CN';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IMAGE_BASE = 'https://www.uniqlo.cn';

/**
 * GET /api/search?q=抽褶裙 —— 搜优衣库在售商品，写测评挑商品用。
 *
 * **为什么必须由后端代理**（而不是页面里直接 fetch 优衣库）：
 *   1. 它不给 CORS 头，浏览器直连会被同源策略挡掉；
 *   2. 请求要带 Origin / Referer / User-Agent，这三个浏览器里都改不了。
 * 这和适配器抓价用的是同一个接口、同一套请求体（见 src/sites/uniqlo.mjs 的 search()）。
 *
 * 2026-10-06 用户纠正了一次方向：测评**不该绑死在榜单上** ——
 * 「不一定非要去榜单上找一件你用过的，他可以测评任何优衣库的东西啊」。
 * 榜单只有几百件打折的，而优衣库在售的有几万件，所以这里给一个通用搜索。
 */
export async function onRequestGet({ request }) {
  const q = clean(new URL(request.url).searchParams.get('q'), 40);
  if (!q) return fail('搜点什么吧');

  const body = {
    url: `/search.html?description=${encodeURIComponent(q)}&searchType=1`,
    pageInfo: { page: 1, pageSize: 20, withSideBar: 'N' },
    belongTo: 'pc',
    rank: 'overall',
    priceRange: { low: 0, high: 0 },
    color: [], size: [], season: [], material: [], sex: [],
    categoryFilter: {},
    identity: [],
    insiteDescription: '',
    exist: [],
    searchFlag: true,
    description: q,
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://www.uniqlo.cn',
        Referer: 'https://www.uniqlo.cn/',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail('搜不动（优衣库那边没应答），过会儿再试', 502);
  }
  if (!res.ok) return fail('搜不动（优衣库返回 ' + res.status + '）', 502);

  let j;
  try {
    j = await res.json();
  } catch {
    return fail('优衣库返回的不是 JSON（大概被挡了）', 502);
  }

  // 只回写测评要用的那几个字段 —— 接口那边一个商品几十个字段，几百条回来太大。
  const items = (j.resp?.[1] || []).map((p) => ({
    productCode: p.productCode,
    code: p.code,
    name: p.name4zhCN || p.name || '',
    image: p.mainPic ? IMAGE_BASE + p.mainPic : '',
    price: p.minPrice ?? null,
    originPrice: p.originPrice ?? null,
  }));

  return json({ ok: true, items });
}
