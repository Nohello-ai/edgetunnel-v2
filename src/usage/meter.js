export function createUsageMeter({ userID, quotaDO, ctx, flushThreshold = 256 * 1024, resetVersion = 0, onLimit = null }) {
  let pendingUpload = 0;
  let pendingDownload = 0;
  let counted = 0;
  let budget = 0;
  let flushing = null;
  let needsReschedule = false;

  const schedule = () => {
    const task = flush();
    if (ctx?.waitUntil) ctx.waitUntil(task.catch(() => {}));
    return task;
  };

  const flush = async () => {
    if (flushing) return flushing;
    needsReschedule = false;
    flushing = (async () => {
      while (pendingUpload !== 0 || pendingDownload !== 0) {
        const upload = pendingUpload;
        const download = pendingDownload;
        const delta = upload + download;
        pendingUpload = 0;
        pendingDownload = 0;
        try {
          const resp = await quotaDO.fetch(`https://do/report`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ delta, resetVersion }),
          });
          const result = await resp.json().catch(() => ({}));
        if (!result.allowed) {
          if (onLimit) try { onLimit(new UsageLimitError()); } catch {}
          throw new UsageLimitError();
        }
          budget = result.budget || budget;
        } catch (error) {
          if (error instanceof UsageLimitError) throw error;
          pendingUpload += upload;
          pendingDownload += download;
          break;
        }
      }
    })().finally(() => {
      flushing = null;
      if ((pendingUpload !== 0 || pendingDownload !== 0) && !needsReschedule) {
        needsReschedule = true;
        if (ctx?.waitUntil) ctx.waitUntil(flush().catch(() => {}));
      }
    });
    return flushing;
  };

  const add = (direction, bytes) => {
    const value = validBytes(bytes);
    counted += value;
    if (direction === 'upload') pendingUpload += value;
    else pendingDownload += value;

    // 本地预算检查:超过预算触发立即上报
    if (budget > 0 && counted >= budget) {
      schedule();
      return;
    }
    if (pendingUpload + pendingDownload >= flushThreshold) schedule();
  };

  return {
    addUpload(bytes) {
      add('upload', bytes);
    },
    addDownload(bytes) {
      add('download', bytes);
    },
    flush,
    setBudget(b) { budget = b; },
    getBudget() { return budget; },
  };
}

export class UsageLimitError extends Error {
  constructor() { super('TRAFFIC_QUOTA_EXHAUSTED'); this.code = 'TRAFFIC_QUOTA_EXHAUSTED'; }
}

function validBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}
