/**
 * Usage Meter — 本地流量累计 + 5MB 攒批上报 + 256KB stop 标志检查。
 *
 * 改造后：
 *   - 每 256KB 检查 DO /status（同 Worker，快速），发现 stopVersion 变化则断连
 *   - 每 5MB 通过 Service Binding 上报管理层（跨 Worker），管理层写 D1 + 返回决策
 *   - 连接结束时 flush 剩余流量
 */

export function createUsageMeter({ userID, quotaDO, userAdmin, ctx, checkThreshold = 256 * 1024, reportThreshold = 5 * 1024 * 1024, stopVersion = 0, onLimit = null }) {
  let pendingUpload = 0;
  let pendingDownload = 0;
  let counted = 0;
  let lastCheck = 0;
  let reporting = null;
  let stopped = false;

  const checkStopFlag = async () => {
    if (!quotaDO) return;
    try {
      const id = quotaDO.idFromName(userID);
      const stub = quotaDO.get(id);
      const resp = await stub.fetch('https://do/status');
      const result = await resp.json();
      console.log(`[meter] checkStop: stopVersion=${result.stopVersion} expected=${stopVersion}`);
      if (result.stopVersion > stopVersion) {
        console.log('[meter] checkStop: STOPPED!');
        stopped = true;
        if (onLimit) try { onLimit(new UsageLimitError()); } catch {}
      }
    } catch (err) {
      console.error(`[meter] checkStop error: ${err.message}`);
    }
  };

  const report = async () => {
    if (reporting) return reporting;
    reporting = (async () => {
      while (pendingUpload !== 0 || pendingDownload !== 0) {
        const upload = pendingUpload;
        const download = pendingDownload;
        pendingUpload = 0;
        pendingDownload = 0;
        console.log(`[meter] report: upload=${upload} download=${download}`);
        try {
          if (!userAdmin) {
            console.log('[meter] report: no userAdmin, break');
            break;
          }
          const resp = await userAdmin.fetch('https://user-admin/internal/report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: userID, upload, download }),
          });
          const result = await resp.json().catch(() => ({}));
          console.log(`[meter] report response: status=${resp.status} allowed=${result.allowed}`);
          if (!result.allowed) {
            console.log('[meter] report: not allowed, stopping');
            stopped = true;
            if (quotaDO) {
              try {
                const id = quotaDO.idFromName(userID);
                const stub = quotaDO.get(id);
                await stub.fetch('https://do/stop', { method: 'POST' });
              } catch {}
            }
            if (onLimit) try { onLimit(new UsageLimitError()); } catch {}
            throw new UsageLimitError();
          }
        } catch (error) {
          console.error(`[meter] report error: ${error.constructor?.name} ${error.message}`);
          if (error instanceof UsageLimitError) throw error;
          pendingUpload += upload;
          pendingDownload += download;
          break;
        }
      }
    })().finally(() => {
      reporting = null;
    });
    return reporting;
  };

  const add = (direction, bytes) => {
    if (stopped) {
      console.log(`[meter] add ${direction} ${bytes}b - stopped, ignored`);
      return;
    }
    const value = validBytes(bytes);
    counted += value;
    if (direction === 'upload') pendingUpload += value;
    else pendingDownload += value;
    if (counted % (256 * 1024) === 0) console.log(`[meter] add ${direction} ${value}b counted=${counted} pendingU=${pendingUpload} pendingD=${pendingDownload}`);

    if (quotaDO && counted - lastCheck >= checkThreshold) {
      lastCheck = counted;
      const task = checkStopFlag();
      if (ctx?.waitUntil) ctx.waitUntil(task.catch(() => {}));
    }

    if (pendingUpload + pendingDownload >= reportThreshold) {
      const task = report();
      if (ctx?.waitUntil) ctx.waitUntil(task.catch(() => {}));
    }
  };

  return {
    addUpload(bytes) { add('upload', bytes); },
    addDownload(bytes) { add('download', bytes); },
    flush: report,
    setBudget() { /* no-op: budget 不再使用 */ },
    getBudget() { return 0; },
  };
}

export class UsageLimitError extends Error {
  constructor() { super('TRAFFIC_QUOTA_EXHAUSTED'); this.code = 'TRAFFIC_QUOTA_EXHAUSTED'; }
}

function validBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}
