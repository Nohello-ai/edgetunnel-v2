export function createUsageMeter({ userID, repository, ctx, flushThreshold = 256 * 1024, maxBytes = 0 }) {
  let pendingUpload = 0;
  let pendingDownload = 0;
  let counted = 0;
  let flushing = null;
  let needsReschedule = false;

  const schedule = () => {
    const task = flush();
    if (ctx?.waitUntil) ctx.waitUntil(task);
    return task;
  };

  const flush = async () => {
    if (flushing) return flushing;
    needsReschedule = false;
    flushing = (async () => {
      while (pendingUpload !== 0 || pendingDownload !== 0) {
        const upload = pendingUpload;
        const download = pendingDownload;
        pendingUpload = 0;
        pendingDownload = 0;
        try {
          await repository.increment(userID, upload, download);
        } catch {
          pendingUpload += upload;
          pendingDownload += download;
          break;
        }
      }
    })().finally(() => {
      flushing = null;
      if ((pendingUpload !== 0 || pendingDownload !== 0) && !needsReschedule) {
        needsReschedule = true;
        if (ctx?.waitUntil) ctx.waitUntil(flush());
      }
    });
    return flushing;
  };

  const add = (direction, bytes) => {
    const value = validBytes(bytes);
    if (maxBytes > 0 && counted + value > maxBytes) throw new UsageLimitError();
    counted += value;
    if (direction === 'upload') pendingUpload += value;
    else pendingDownload += value;
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
  };
}

export class UsageLimitError extends Error {
  constructor() { super('TRAFFIC_QUOTA_EXHAUSTED'); this.code = 'TRAFFIC_QUOTA_EXHAUSTED'; }
}

function validBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}
