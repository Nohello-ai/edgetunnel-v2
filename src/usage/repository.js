export function createUsageRepository(env) {
  return {
    async get(userID) {
      const row = await env.DB.prepare('SELECT upload, download, total, updated_at FROM usage WHERE user_id = ?')
        .bind(userID).first();
      return row ? {
        upload: Number(row.upload || 0),
        download: Number(row.download || 0),
        total: Number(row.total || 0),
        updatedAt: row.updated_at,
      } : { upload: 0, download: 0, total: 0 };
    },
    async increment(userID, upload, download) {
      const up = Number(upload || 0);
      const down = Number(download || 0);
      await env.DB.prepare(`
        INSERT INTO usage (user_id, upload, download, total, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          upload = usage.upload + excluded.upload,
          download = usage.download + excluded.download,
          total = usage.total + excluded.total,
          updated_at = excluded.updated_at
      `).bind(userID, up, down, up + down, new Date().toISOString()).run();
    },
  };
}
