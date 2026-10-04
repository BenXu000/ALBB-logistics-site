// ===== 全站配置（部署后只需要改这一个文件）=====
// API_BASE：Cloudflare Worker 的地址。绑定自有域名后填 https://order.alibaba-log.com
//           未绑域名前填 workers.dev 地址，例如 https://albb-order.你的子域.workers.dev
// TRACK_API：现有运踪查询接口，保持不变
window.ALBB_CONFIG = {
  API_BASE: "https://albb-order.benxu19820101.workers.dev",
  TRACK_API: "https://track.alibaba-log.com",
};
