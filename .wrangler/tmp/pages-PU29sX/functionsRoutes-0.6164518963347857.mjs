import { onRequestGet as __api_img__id__js_onRequestGet } from "/Users/zhangshuai/deals/functions/api/img/[id].js"
import { onRequestPost as __api_delete_js_onRequestPost } from "/Users/zhangshuai/deals/functions/api/delete.js"
import { onRequestGet as __api_listings_js_onRequestGet } from "/Users/zhangshuai/deals/functions/api/listings.js"
import { onRequestPost as __api_listings_js_onRequestPost } from "/Users/zhangshuai/deals/functions/api/listings.js"
import { onRequestPost as __api_report_js_onRequestPost } from "/Users/zhangshuai/deals/functions/api/report.js"

export const routes = [
    {
      routePath: "/api/img/:id",
      mountPath: "/api/img",
      method: "GET",
      middlewares: [],
      modules: [__api_img__id__js_onRequestGet],
    },
  {
      routePath: "/api/delete",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_delete_js_onRequestPost],
    },
  {
      routePath: "/api/listings",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_listings_js_onRequestGet],
    },
  {
      routePath: "/api/listings",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_listings_js_onRequestPost],
    },
  {
      routePath: "/api/report",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_report_js_onRequestPost],
    },
  ]