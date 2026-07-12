// admin/cloudflare.js — Cloudflare API 用量查询
// 功能：调用 Cloudflare API 查询所有 zone 的 Spectrum 事件统计
// 支持三种认证方式：API Token、Global API Key + Email、UsageAPI

/**
 * 查询 Cloudflare 账户的 Spectrum 用量统计
 * @param {string} email - Cloudflare 邮箱
 * @param {string} globalAPIKey - Global API Key
 * @param {string} accountID - 账户 ID
 * @param {string} apiToken - API Token
 * @returns {Promise<{success:boolean, pages?:number, workers?:number, total?:number, max?:number, error?:string}>}
 */
export async function getCloudflareUsage(email, globalAPIKey, accountID, apiToken) {
  const API = 'https://api.cloudflare.com/client/v4';
  const headers = { 'Content-Type': 'application/json' };

  // 认证策略：优先 API Token，其次 Global Key + Email
  if (apiToken) {
    headers['Authorization'] = 'Bearer ' + apiToken;
  } else if (email && globalAPIKey) {
    headers['X-Auth-Email'] = email;
    headers['X-Auth-Key'] = globalAPIKey;
  } else {
    return { success: false, error: '缺少认证信息（需要 Email+GlobalAPIKey 或 APIToken）' };
  }

  try {
    // 第一步：获取所有 zone
    const zonesRes = await fetch(API + '/zones?per_page=50', { headers });
    const zonesData = await zonesRes.json();
    if (!zonesData.success) {
      return { success: false, error: zonesData.errors?.[0]?.message || '获取 zone 列表失败' };
    }

    const zones = zonesData.result;
    if (!zones || zones.length === 0) {
      return { success: true, pages: 0, workers: 0, total: 0, max: 100000 };
    }

    // 第二步：并发查询所有 zone 的 spectrum analytics
    const since = '2024-01-01T00:00:00Z';
    const until = '2099-12-31T23:59:59Z';
    const sumRequests = (dataArray) =>
      (dataArray || []).reduce((total, item) => total + (item?.sum?.requests || 0), 0);

    const results = await Promise.all(
      zones.map(zone =>
        fetch(
          API + '/zones/' + zone.id + '/spectrum/analytics/events/summary?since=' + since + '&until=' + until,
          { headers }
        )
          .then(r => r.json())
          .then(data => (data.success ? sumRequests(data.result?.data) : 0))
          .catch(() => 0)
      )
    );

    const total = results.reduce((a, b) => a + b, 0);
    return {
      success: true,
      pages: total,
      workers: 0,
      total,
      max: 100000,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}