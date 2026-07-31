export async function getUser(env, userID) {
  return env.DB.prepare('SELECT * FROM users WHERE user_id = ?')
    .bind(userID)
    .first()
    .then(rowToUser);
}

export async function getUserByUsername(env, username) {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username)
    .first()
    .then(rowToUser);
}

export async function putUser(env, userID, user) {
  const now = new Date().toISOString();
  const record = {
    userID,
    username: user.username,
    password: user.password,
    disabled: user.disabled ? 1 : 0,
    settings: JSON.stringify(user.settings || {}),
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
  };

  await env.DB.prepare(`
    INSERT INTO users (user_id, username, password, disabled, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      password = excluded.password,
      disabled = excluded.disabled,
      settings = excluded.settings,
      updated_at = excluded.updated_at
  `).bind(
    record.userID,
    record.username,
    record.password,
    record.disabled,
    record.settings,
    record.createdAt,
    record.updatedAt,
  ).run();

  return user;
}

export async function listUsers(env) {
  const result = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  return (result.results || []).map(rowToUser);
}

export async function getBan(env, userID) {
  return env.DB.prepare('SELECT * FROM bans WHERE user_id = ?')
    .bind(userID)
    .first()
    .then(rowToBan);
}

export async function putBan(env, userID, ban) {
  await env.DB.prepare(`
    INSERT INTO bans (user_id, reason, until, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      reason = excluded.reason,
      until = excluded.until,
      created_at = excluded.created_at
  `).bind(userID, ban.reason || '', ban.until || null, ban.createdAt).run();

  return ban;
}

export async function deleteBan(env, userID) {
  await env.DB.prepare('DELETE FROM bans WHERE user_id = ?').bind(userID).run();
}

export async function getUsage(env, userID) {
  const row = await env.DB.prepare('SELECT * FROM usage WHERE user_id = ?').bind(userID).first();
  return rowToUsage(row);
}

export async function listUsage(env) {
  const result = await env.DB.prepare('SELECT * FROM usage ORDER BY total DESC').all();
  return (result.results || []).map(rowToUsage);
}

export async function putUsage(env, userID, usage) {
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO usage (user_id, upload, download, total, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      upload = excluded.upload,
      download = excluded.download,
      total = excluded.total,
      updated_at = excluded.updated_at
  `).bind(
    userID,
    Number(usage.upload || 0),
    Number(usage.download || 0),
    Number(usage.total || 0),
    now,
  ).run();

  return usage;
}

export async function getGlobalConfig(env) {
  const row = await env.DB.prepare('SELECT value FROM global_config WHERE key = ?')
    .bind('global')
    .first();

  return parseJson(row?.value, {});
}

export async function putGlobalConfig(env, config) {
  await env.DB.prepare(`
    INSERT INTO global_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind('global', JSON.stringify(config), new Date().toISOString()).run();

  return config;
}

export async function insertNotification(env, notification) {
  await env.DB.prepare(`
    INSERT INTO notifications (id, user_id, type, message, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    notification.id,
    notification.targetUserID || null,
    notification.type,
    notification.message,
    notification.readAt || null,
    notification.createdAt,
  ).run();

  return notification;
}

export async function listNotificationsForUser(env, userID) {
  const result = await env.DB.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC
  `).bind(userID).all();

  return (result.results || []).map(rowToNotification);
}

export async function countUnreadNotificationsForUser(env, userID) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM notifications
    WHERE user_id = ? AND read_at IS NULL
  `).bind(userID).first();

  return Number(row?.count || 0);
}

export async function markNotificationReadForUser(env, userID, notificationID) {
  const readAt = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE notifications SET read_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(readAt, notificationID, userID).run();

  const row = await env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(notificationID).first();
  return rowToNotification(row);
}

function rowToUser(row) {
  if (!row) return null;

  return {
    userID: row.user_id,
    username: row.username,
    password: row.password,
    disabled: Boolean(row.disabled),
    settings: parseJson(row.settings, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBan(row) {
  if (!row) return null;

  return {
    userID: row.user_id,
    reason: row.reason,
    until: row.until,
    createdAt: row.created_at,
  };
}

function rowToUsage(row) {
  if (!row) return { upload: 0, download: 0, total: 0 };

  return {
    userID: row.user_id,
    upload: Number(row.upload || 0),
    download: Number(row.download || 0),
    total: Number(row.total || 0),
    updatedAt: row.updated_at,
  };
}

function rowToNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    message: row.message,
    targetUserID: row.user_id || '',
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
