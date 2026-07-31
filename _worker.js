// src/config/loader.js
async function getUser(env, userID) {
  return env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userID).first().then(rowToUser);
}
async function getUserByUsername(env, username) {
  return env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first().then(rowToUser);
}
async function putUser(env, userID, user) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const record = {
    userID,
    username: user.username,
    password: user.password,
    disabled: user.disabled ? 1 : 0,
    settings: JSON.stringify(user.settings || {}),
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now
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
    record.updatedAt
  ).run();
  return user;
}
async function listUsers(env) {
  const result = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
  return (result.results || []).map(rowToUser);
}
async function getBan(env, userID) {
  return env.DB.prepare("SELECT * FROM bans WHERE user_id = ?").bind(userID).first().then(rowToBan);
}
async function putBan(env, userID, ban) {
  await env.DB.prepare(`
    INSERT INTO bans (user_id, reason, until, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      reason = excluded.reason,
      until = excluded.until,
      created_at = excluded.created_at
  `).bind(userID, ban.reason || "", ban.until || null, ban.createdAt).run();
  return ban;
}
async function deleteBan(env, userID) {
  await env.DB.prepare("DELETE FROM bans WHERE user_id = ?").bind(userID).run();
}
async function getUsage(env, userID) {
  const row = await env.DB.prepare("SELECT * FROM usage WHERE user_id = ?").bind(userID).first();
  return rowToUsage(row);
}
async function listUsage(env) {
  const result = await env.DB.prepare("SELECT * FROM usage ORDER BY total DESC").all();
  return (result.results || []).map(rowToUsage);
}
async function getGlobalConfig(env) {
  const row = await env.DB.prepare("SELECT value FROM global_config WHERE key = ?").bind("global").first();
  return parseJson(row?.value, {});
}
async function putGlobalConfig(env, config) {
  await env.DB.prepare(`
    INSERT INTO global_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind("global", JSON.stringify(config), (/* @__PURE__ */ new Date()).toISOString()).run();
  return config;
}
async function insertNotification(env, notification) {
  await env.DB.prepare(`
    INSERT INTO notifications (id, user_id, type, message, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    notification.id,
    notification.targetUserID || null,
    notification.type,
    notification.message,
    notification.readAt || null,
    notification.createdAt
  ).run();
  return notification;
}
async function listNotificationsForUser(env, userID) {
  const result = await env.DB.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC
  `).bind(userID).all();
  return (result.results || []).map(rowToNotification);
}
async function countUnreadNotificationsForUser(env, userID) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM notifications
    WHERE user_id = ? AND read_at IS NULL
  `).bind(userID).first();
  return Number(row?.count || 0);
}
async function markNotificationReadForUser(env, userID, notificationID) {
  const readAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`
    UPDATE notifications SET read_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(readAt, notificationID, userID).run();
  const row = await env.DB.prepare("SELECT * FROM notifications WHERE id = ?").bind(notificationID).first();
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
    updatedAt: row.updated_at
  };
}
function rowToBan(row) {
  if (!row) return null;
  return {
    userID: row.user_id,
    reason: row.reason,
    until: row.until,
    createdAt: row.created_at
  };
}
function rowToUsage(row) {
  if (!row) return { upload: 0, download: 0, total: 0 };
  return {
    userID: row.user_id,
    upload: Number(row.upload || 0),
    download: Number(row.download || 0),
    total: Number(row.total || 0),
    updatedAt: row.updated_at
  };
}
function rowToNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    targetUserID: row.user_id || "",
    readAt: row.read_at,
    createdAt: row.created_at
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

// src/config/schema.js
var DEFAULT_TRANSPORT = "websocket";
var DEFAULT_PROTOCOL = "vless";
var TRANSPORTS = /* @__PURE__ */ new Set(["websocket", "grpc", "xhttp"]);
var PROTOCOLS = /* @__PURE__ */ new Set(["vless", "trojan", "shadowsocks"]);
function normalizeUserConfig(input, fallback = {}) {
  const config = input && typeof input === "object" ? input : {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...fallback,
    userID: String(config.userID || fallback.userID || ""),
    username: String(config.username || fallback.username || "").trim().toLowerCase(),
    password: String(config.password || fallback.password || ""),
    disabled: Boolean(config.disabled ?? fallback.disabled ?? false),
    settings: normalizeObject(config.settings ?? fallback.settings),
    createdAt: fallback.createdAt || now,
    updatedAt: now
  };
}
function normalizeGlobalConfig(input, fallback = {}) {
  const config = input && typeof input === "object" ? input : {};
  return {
    ...fallback,
    siteName: String(config.siteName || fallback.siteName || "edgetunnel"),
    transport: normalizeEnum(config.transport || config.defaultTransport, TRANSPORTS, fallback.transport || fallback.defaultTransport || DEFAULT_TRANSPORT),
    protocol: normalizeEnum(config.protocol || config.defaultProtocol, PROTOCOLS, fallback.protocol || fallback.defaultProtocol || DEFAULT_PROTOCOL),
    settings: normalizeObject(config.settings ?? fallback.settings),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function normalizeBan(input) {
  const ban = input && typeof input === "object" ? input : {};
  return {
    reason: String(ban.reason || ""),
    until: ban.until || null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function normalizeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}
function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// src/utils/crypto.js
var UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var textEncoder = new TextEncoder();
var SHA224_K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function isValidUuidV4(value) {
  return typeof value === "string" && UUID_V4_RE.test(value);
}
async function generateUserID(username, envID) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("username is required");
  }
  if (!isValidUuidV4(envID)) {
    throw new Error("env ID must be UUID v4");
  }
  const input = `${envID}:${normalizedUsername}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  return bytesToUuid(bytes);
}
function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}
function sha224Text(value) {
  return bytesToHex(sha224Bytes(textEncoder.encode(String(value ?? ""))));
}
function sha224Bytes(input) {
  const bytes = toUint8Array(input);
  const padded = padSha256Block(bytes);
  const words = new Uint32Array(64);
  const hash = new Uint32Array([
    3238371032,
    914150663,
    812702999,
    4144912697,
    4290775857,
    1750603025,
    1694076839,
    3204075428
  ]);
  for (let offset = 0; offset < padded.byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (padded[wordOffset] << 24 | padded[wordOffset + 1] << 16 | padded[wordOffset + 2] << 8 | padded[wordOffset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = words[index - 16] + s0 + words[index - 7] + s1 >>> 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + s1 + ch + SHA224_K[index] + words[index] >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = s0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    hash[0] = hash[0] + a >>> 0;
    hash[1] = hash[1] + b >>> 0;
    hash[2] = hash[2] + c >>> 0;
    hash[3] = hash[3] + d >>> 0;
    hash[4] = hash[4] + e >>> 0;
    hash[5] = hash[5] + f >>> 0;
    hash[6] = hash[6] + g >>> 0;
    hash[7] = hash[7] + h >>> 0;
  }
  const digest = new Uint8Array(28);
  for (let wordIndex = 0; wordIndex < 7; wordIndex += 1) {
    const word = hash[wordIndex];
    digest[wordIndex * 4] = word >>> 24 & 255;
    digest[wordIndex * 4 + 1] = word >>> 16 & 255;
    digest[wordIndex * 4 + 2] = word >>> 8 & 255;
    digest[wordIndex * 4 + 3] = word & 255;
  }
  return digest;
}
function bytesToUuid(bytes) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}
function padSha256Block(bytes) {
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 128;
  const bitLength = BigInt(bytes.byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number(bitLength >> BigInt(index * 8) & 0xffn);
  }
  return padded;
}
function rotateRight(value, bits) {
  return (value >>> bits | value << 32 - bits) >>> 0;
}
function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}

// src/utils/http.js
function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}
async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function getPathSegments(url, prefix = "/api") {
  const pathname = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
  return pathname.split("/").map((part) => part.trim()).filter(Boolean);
}

// src/api/notification.js
async function sendNotification(env, userID, message, type = "private") {
  return insertNotification(env, createNotification({ type, message, targetUserID: userID }));
}
async function broadcastNotification(env, message) {
  return insertNotification(env, createNotification({ type: "global", message }));
}
async function sendSystemNotification(env, userID, message) {
  return sendNotification(env, userID, message, "system");
}
async function listNotifications(env, userID) {
  return listNotificationsForUser(env, userID);
}
async function countUnreadNotifications(env, userID) {
  return countUnreadNotificationsForUser(env, userID);
}
async function markNotificationRead(env, userID, notificationID) {
  return markNotificationReadForUser(env, userID, notificationID);
}
function createNotification({ type, message, targetUserID = "" }) {
  return {
    id: crypto.randomUUID(),
    type,
    message: String(message || ""),
    targetUserID,
    readAt: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/api/handler.js
async function handleApiRoute(context) {
  const { segments } = context;
  if (segments.length === 0) {
    return jsonResponse({ ok: true, name: "edgetunnel api" });
  }
  const [resource, action] = segments;
  if (resource === "login") return handleLoginRoute(context);
  if (resource === "admin") return handleLoginRoute(context);
  if (resource === "sub") return handleSubRoute(context);
  if (resource === "user") return handleUserRoute(context, action, segments[2]);
  if (resource === "config") return handleConfigRoute(context, action);
  if (resource === "subscription") return handleSubscriptionRoute(context, action);
  if (resource === "usage") return handleUsageRoute(context, action);
  if (resource === "notification") return handleNotificationRoute(context, action);
  return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404);
}
async function handleLoginRoute(context) {
  const { auth, env } = context;
  const user = auth.isAdmin ? null : await getUser(env, auth.userID);
  return jsonResponse({
    ok: true,
    auth: {
      username: auth.username,
      userID: auth.userID,
      isAdmin: auth.isAdmin,
      hasUser: Boolean(user)
    },
    user
  });
}
async function handleSubRoute(context) {
  const { auth, env, url } = context;
  const user = await requireUser(env, auth.userID);
  const config = normalizeGlobalConfig(await getGlobalConfig(env));
  const node = buildSubscriptionNode(url, user, config);
  return textResponse(node);
}
async function handleUserRoute(context, action, targetUserID) {
  const { auth, env, request } = context;
  if (action === "list") {
    requireAdmin(auth);
    return jsonResponse({ ok: true, users: await listUsers(env) });
  }
  if (action === "add") {
    requireAdmin(auth);
    const body = await requireJson(request);
    const username = body.username;
    const userID2 = body.userID || await generateUserID(username, env.ID);
    const user2 = normalizeUserConfig({ ...body, userID: userID2, username });
    await putUser(env, userID2, user2);
    return jsonResponse({ ok: true, user: user2 });
  }
  if (action === "update") {
    const body = await requireJson(request);
    const userID2 = body.userID || auth.userID;
    requireSelfOrAdmin(auth, userID2);
    const current = await getUser(env, userID2);
    const update = auth.isAdmin ? body : pickOwnUserUpdate(body);
    const user2 = normalizeUserConfig({ ...current, ...update, userID: userID2 }, current || {});
    await putUser(env, userID2, user2);
    return jsonResponse({ ok: true, user: user2 });
  }
  if (action === "disable") {
    requireAdmin(auth);
    const body = await requireJson(request);
    const userID2 = body.userID || targetUserID;
    const current = await requireUser(env, userID2);
    const user2 = normalizeUserConfig({ ...current, disabled: true }, current);
    await putUser(env, userID2, user2);
    return jsonResponse({ ok: true, user: user2 });
  }
  if (action === "ban") {
    requireAdmin(auth);
    const body = await requireJson(request);
    const userID2 = body.userID || targetUserID;
    await requireUser(env, userID2);
    const ban2 = normalizeBan(body);
    await putBan(env, userID2, ban2);
    await sendSystemNotification(env, userID2, `account banned: ${ban2.reason || "no reason"}`);
    return jsonResponse({ ok: true, ban: ban2 });
  }
  if (action === "unban") {
    requireAdmin(auth);
    const body = await readJson(request) || {};
    const userID2 = body.userID || targetUserID;
    await deleteBan(env, userID2);
    await sendSystemNotification(env, userID2, "account unbanned");
    return jsonResponse({ ok: true });
  }
  const userID = action || auth.userID;
  requireSelfOrAdmin(auth, userID);
  const user = await requireUser(env, userID);
  const ban = await getBan(env, userID);
  return jsonResponse({ ok: true, user, ban });
}
async function handleConfigRoute(context, action) {
  const { auth, env, request } = context;
  if (action !== "global") {
    return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404);
  }
  requireAdmin(auth);
  if (request.method === "GET") {
    return jsonResponse({ ok: true, config: await getGlobalConfig(env) });
  }
  const body = await requireJson(request);
  const current = await getGlobalConfig(env);
  const config = normalizeGlobalConfig(body, current);
  await putGlobalConfig(env, config);
  return jsonResponse({ ok: true, config });
}
async function handleSubscriptionRoute(context, action) {
  const { auth, env, url } = context;
  const user = await requireUser(env, auth.userID);
  const config = normalizeGlobalConfig(await getGlobalConfig(env));
  if (action === "link") {
    const link = `${url.origin}/sub?userID=${encodeURIComponent(auth.userID)}`;
    return jsonResponse({ ok: true, link });
  }
  if (action === "nodes") {
    return jsonResponse({
      ok: true,
      nodes: [{
        userID: auth.userID,
        username: user.username,
        protocol: config.protocol,
        transport: config.transport,
        disabled: user.disabled,
        path: buildTransportPath(config.transport, auth.userID)
      }]
    });
  }
  return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404);
}
async function handleUsageRoute(context, action) {
  const { auth, env } = context;
  if (action === "list") {
    requireAdmin(auth);
    return jsonResponse({ ok: true, usage: await listUsage(env) });
  }
  const userID = action || auth.userID;
  requireSelfOrAdmin(auth, userID);
  return jsonResponse({ ok: true, usage: await getUsage(env, userID) });
}
async function handleNotificationRoute(context, action) {
  const { auth, env, request } = context;
  if (action === "send") {
    requireAdmin(auth);
    const body = await requireJson(request);
    const notification = await sendNotification(env, body.userID, body.message, "private");
    return jsonResponse({ ok: true, notification });
  }
  if (action === "broadcast") {
    requireAdmin(auth);
    const body = await requireJson(request);
    const notification = await broadcastNotification(env, body.message);
    return jsonResponse({ ok: true, notification });
  }
  if (action === "unread") {
    return jsonResponse({ ok: true, unread: await countUnreadNotifications(env, auth.userID) });
  }
  if (action === "read") {
    const body = await requireJson(request);
    const notification = await markNotificationRead(env, auth.userID, body.notificationID);
    return jsonResponse({ ok: true, notification });
  }
  return jsonResponse({ ok: true, notifications: await listNotifications(env, auth.userID) });
}
async function requireJson(request) {
  const body = await readJson(request);
  if (!body) {
    throw new ApiError("INVALID_JSON", 400);
  }
  return body;
}
async function requireUser(env, userID) {
  const user = await getUser(env, userID);
  if (!user) {
    throw new ApiError("USER_NOT_FOUND", 404);
  }
  return user;
}
function requireAdmin(auth) {
  if (!auth.isAdmin) {
    throw new ApiError("ADMIN_REQUIRED", 403);
  }
}
function requireSelfOrAdmin(auth, userID) {
  if (!auth.isAdmin && auth.userID !== userID) {
    throw new ApiError("FORBIDDEN", 403);
  }
}
function buildSubscriptionNode(url, user, config) {
  const protocol = config.protocol;
  const transport = config.transport;
  const path = buildTransportPath(transport, user.userID);
  const host = url.host;
  const params = new URLSearchParams({
    type: transport,
    path
  });
  const echParams = buildECHParams(config, host);
  if (echParams) {
    params.set("ech", echParams);
  }
  const name = encodeURIComponent(user.username);
  if (protocol === "trojan") {
    return `trojan://${sha224Text(user.userID)}@${url.host}:443?${params.toString()}#${name}`;
  }
  return `${protocol}://${user.userID}@${url.host}:443?${params.toString()}#${name}`;
}
function buildTransportPath(transport, userID) {
  const encodedUserID = encodeURIComponent(userID);
  if (transport === "grpc") return `/grpc/${encodedUserID}`;
  if (transport === "websocket") return `/ws/${encodedUserID}`;
  return `/xhttp/${encodedUserID}`;
}
function buildECHParams(config, host) {
  if (!config?.ECH) return "";
  const echConfig = config.ECHConfig || {};
  const dns = String(echConfig.dns || echConfig.DNS || "").trim();
  const domainRaw = echConfig.domain ?? echConfig.sni ?? echConfig.SNI ?? "";
  const domain = String(domainRaw).trim();
  const target = domain === "0" ? `${host}+${dns}` : (domain ? `${domain}+${dns}` : dns);
  return target ? encodeURIComponent(target) : "";
}
function pickOwnUserUpdate(body) {
  const allowed = /* @__PURE__ */ new Set(["password"]);
  const blocked = Object.keys(body).filter((key) => !allowed.has(key));
  if (blocked.length > 0) {
    throw new ApiError(`USER_CAN_ONLY_UPDATE_PASSWORD: ${blocked.join(",")}`, 403);
  }
  if (!Object.hasOwn(body, "password")) {
    throw new ApiError("PASSWORD_REQUIRED", 400);
  }
  return { password: String(body.password || "") };
}
var ApiError = class extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
};

// src/api/index.js
async function handleApiRequest(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const credentials = readCredentials(request, url);
    if (!credentials.username) {
      return jsonResponse({
        ok: false,
        error: "MISSING_USERNAME",
        message: "username is required"
      }, 401);
    }
    const userID = await generateUserID(credentials.username, env.ID);
    const auth = {
      username: credentials.username,
      password: credentials.password,
      userID,
      isAdmin: isAdminRequest(credentials, userID, env)
    };
    return await handleApiRoute({
      request,
      env,
      ctx,
      url,
      segments: getPathSegments(url),
      auth
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error.code || "INTERNAL_ERROR",
      message: error.message || "internal error"
    }, error.status || 500);
  }
}
function isAdminRequest(credentials, userID, env) {
  if (userID === env.ID) return true;
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false;
  return credentials.username === normalizeUsername(env.ADMIN_USERNAME) && credentials.password === env.ADMIN_PASSWORD;
}
function readCredentials(request, url) {
  const basic = readBasicAuth(request.headers.get("authorization"));
  return {
    username: normalizeUsername(url.searchParams.get("username") || basic.username),
    password: url.searchParams.get("password") || basic.password || ""
  };
}
function readBasicAuth(header) {
  if (!header?.startsWith("Basic ")) {
    return { username: "", password: "" };
  }
  try {
    const decoded = atob(header.slice(6));
    const splitIndex = decoded.indexOf(":");
    if (splitIndex === -1) {
      return { username: decoded, password: "" };
    }
    return {
      username: decoded.slice(0, splitIndex),
      password: decoded.slice(splitIndex + 1)
    };
  } catch {
    return { username: "", password: "" };
  }
}

// src/protocol/address.js
var ADDRESS_TYPE_IPV4 = 1;
var ADDRESS_TYPE_DOMAIN = 2;
var ADDRESS_TYPE_IPV6 = 3;
var SOCKS_ADDRESS_TYPE_DOMAIN = 3;
var SOCKS_ADDRESS_TYPE_IPV6 = 4;
var textDecoder = new TextDecoder();
function parseVlessAddress(packet, offset) {
  if (packet.byteLength < offset + 1) return { status: "need_more" };
  const addressType = packet[offset];
  let cursor = offset + 1;
  if (addressType === ADDRESS_TYPE_IPV4) {
    if (packet.byteLength < cursor + 4) return { status: "need_more" };
    return {
      status: "ok",
      addressType,
      hostname: `${packet[cursor]}.${packet[cursor + 1]}.${packet[cursor + 2]}.${packet[cursor + 3]}`,
      offset: cursor + 4
    };
  }
  if (addressType === ADDRESS_TYPE_DOMAIN) {
    return parseDomainAddress(packet, cursor, addressType);
  }
  if (addressType === ADDRESS_TYPE_IPV6) {
    return parseIpv6Address(packet, cursor, addressType);
  }
  return { status: "invalid" };
}
function parseSocksAddress(packet, offset) {
  if (packet.byteLength < offset + 1) return { status: "need_more" };
  const addressType = packet[offset];
  let cursor = offset + 1;
  if (addressType === ADDRESS_TYPE_IPV4) {
    if (packet.byteLength < cursor + 4) return { status: "need_more" };
    return {
      status: "ok",
      addressType,
      hostname: `${packet[cursor]}.${packet[cursor + 1]}.${packet[cursor + 2]}.${packet[cursor + 3]}`,
      offset: cursor + 4
    };
  }
  if (addressType === SOCKS_ADDRESS_TYPE_DOMAIN) {
    return parseDomainAddress(packet, cursor, addressType);
  }
  if (addressType === SOCKS_ADDRESS_TYPE_IPV6) {
    return parseIpv6Address(packet, cursor, addressType);
  }
  return { status: "invalid" };
}
function readUint16(bytes, offset) {
  return bytes[offset] << 8 | bytes[offset + 1];
}
function parseDomainAddress(packet, cursor, addressType) {
  if (packet.byteLength < cursor + 1) return { status: "need_more" };
  const length = packet[cursor];
  cursor += 1;
  if (length === 0) return { status: "invalid" };
  if (packet.byteLength < cursor + length) return { status: "need_more" };
  return {
    status: "ok",
    addressType,
    hostname: textDecoder.decode(packet.subarray(cursor, cursor + length)),
    offset: cursor + length
  };
}
function parseIpv6Address(packet, cursor, addressType) {
  if (packet.byteLength < cursor + 16) return { status: "need_more" };
  return {
    status: "ok",
    addressType,
    hostname: formatIpv6(packet.subarray(cursor, cursor + 16)),
    offset: cursor + 16
  };
}
function formatIpv6(bytes) {
  const parts = [];
  for (let index = 0; index < 8; index += 1) {
    const base = index * 2;
    parts.push(readUint16(bytes, base).toString(16));
  }
  return parts.join(":");
}

// src/protocol/trojan.js
var TROJAN_HASH_HEX_LENGTH = 56;
var CR = 13;
var LF = 10;
var TROJAN_CMD_TCP = 1;
var TROJAN_CMD_UDP = 3;
var textDecoder2 = new TextDecoder();
function parseTrojanPacket(packet, session) {
  const user = session.user;
  const length = packet.byteLength;
  if (length < TROJAN_HASH_HEX_LENGTH + 2) return { status: "need_more" };
  if (packet[TROJAN_HASH_HEX_LENGTH] !== CR || packet[TROJAN_HASH_HEX_LENGTH + 1] !== LF) return { status: "invalid" };
  const passwordHash = textDecoder2.decode(packet.subarray(0, TROJAN_HASH_HEX_LENGTH));
  if (!constantTimeEqual(passwordHash, sha224Text(user.userID))) return { status: "invalid" };
  const socksStart = TROJAN_HASH_HEX_LENGTH + 2;
  if (length < socksStart + 2) return { status: "need_more" };
  const command = packet[socksStart];
  if (command !== TROJAN_CMD_TCP && command !== TROJAN_CMD_UDP) return { status: "invalid" };
  const address = parseSocksAddress(packet, socksStart + 1);
  if (address.status !== "ok") return address;
  if (length < address.offset + 4) return { status: "need_more" };
  const port = readUint16(packet, address.offset);
  if (packet[address.offset + 2] !== CR || packet[address.offset + 3] !== LF) return { status: "invalid" };
  return {
    status: "ok",
    result: {
      protocol: "trojan",
      user,
      hostname: address.hostname,
      port,
      isUDP: command === TROJAN_CMD_UDP,
      payload: packet.subarray(address.offset + 4),
      responseHeader: null,
      originalPacket: packet
    }
  };
}
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

// src/protocol/vless.js
var VLESS_CMD_TCP = 1;
var VLESS_CMD_UDP = 2;
function parseVlessPacket(packet, session) {
  const user = session.user;
  const length = packet.byteLength;
  if (length < 18) return { status: "need_more" };
  if (!uuidBytesMatch(packet, 1, user.userID)) return { status: "invalid" };
  const version = packet[0];
  const optLength = packet[17];
  const commandIndex = 18 + optLength;
  if (length < commandIndex + 4) return { status: "need_more" };
  const command = packet[commandIndex];
  if (command !== VLESS_CMD_TCP && command !== VLESS_CMD_UDP) return { status: "invalid" };
  const portIndex = commandIndex + 1;
  const port = readUint16(packet, portIndex);
  const address = parseVlessAddress(packet, portIndex + 2);
  if (address.status !== "ok") return address;
  return {
    status: "ok",
    result: {
      protocol: "vless",
      user,
      hostname: address.hostname,
      port,
      isUDP: command === VLESS_CMD_UDP,
      payload: packet.subarray(address.offset),
      responseHeader: new Uint8Array([version, 0]),
      originalPacket: null
    }
  };
}
function uuidBytesMatch(data, offset, uuid) {
  const expected = uuidToBytes(uuid);
  if (!expected || data.byteLength < offset + 16) return false;
  for (let index = 0; index < 16; index += 1) {
    if (data[offset + index] !== expected[index]) return false;
  }
  return true;
}
function uuidToBytes(uuid) {
  const clean = String(uuid || "").replace(/-/g, "");
  if (clean.length !== 32) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    const high = hexNibble(clean.charCodeAt(index * 2));
    const low = hexNibble(clean.charCodeAt(index * 2 + 1));
    if (high < 0 || low < 0) return null;
    bytes[index] = high << 4 | low;
  }
  return bytes;
}
function hexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48;
  const lower = code | 32;
  if (lower >= 97 && lower <= 102) return lower - 87;
  return -1;
}

// src/protocol/index.js
function parseProxyPacket(packet, session) {
  if (session.protocol === "vless") return parseVlessPacket(packet, session);
  if (session.protocol === "trojan") return parseTrojanPacket(packet, session);
  return { status: "invalid" };
}

// src/protocol/parse.js
var MAX_FIRST_PACKET_BYTES = 16 * 1024;
async function readFirstProxyPacket(reader, session, options = {}) {
  const maxBytes = options.maxBytes || MAX_FIRST_PACKET_BYTES;
  let buffer = new Uint8Array(Math.min(1024, maxBytes));
  let offset = 0;
  while (offset < maxBytes) {
    const { done, value } = await reader.read();
    if (done) return null;
    const chunk = toUint8Array2(value);
    if (chunk.byteLength === 0) continue;
    if (offset + chunk.byteLength > maxBytes) {
      throw new Error("first packet exceeds maximum size");
    }
    if (offset + chunk.byteLength > buffer.byteLength) {
      const next = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, offset + chunk.byteLength)));
      next.set(buffer.subarray(0, offset));
      buffer = next;
    }
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
    const packet = buffer.subarray(0, offset);
    const parsed = parseProxyPacket(packet, session);
    if (parsed.status === "ok") return parsed.result;
    if (parsed.status === "invalid") return null;
  }
  throw new Error("first packet exceeds maximum size");
}
function toUint8Array2(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}

// src/connector/tcp.js
import { connect } from "cloudflare:sockets";
function createTcpConnector(request) {
  if (typeof request?.fetcher?.connect === "function") {
    return (target, options) => request.fetcher.connect(target, options);
  }
  return (target, options) => connect(target, options);
}

// src/proxy/session.js
async function resolveDataFlowSession(request, env) {
  const url = new URL(request.url);
  const user = await resolveUserFromRequest(url, env);
  if (!user) {
    return { ok: false, response: new Response("User not found", { status: 404 }) };
  }
  if (user.disabled) {
    return { ok: false, response: new Response("User is disabled", { status: 403 }) };
  }
  const ban = await getBan(env, user.userID);
  if (isActiveBan(ban)) {
    return { ok: false, response: new Response("User is banned", { status: 403 }) };
  }
  const usage = await getUsage(env, user.userID);
  const config = normalizeRuntimeConfig(await getGlobalConfig(env));
  if (!hasRemainingQuota(user, usage, config)) {
    return { ok: false, response: new Response("Traffic quota exhausted", { status: 403 }) };
  }
  return {
    ok: true,
    user,
    ban,
    usage,
    config,
    protocol: config.protocol || config.defaultProtocol || "vless",
    transport: config.transport || config.defaultTransport || "websocket"
  };
}
function isActiveBan(ban) {
  if (!ban) return false;
  if (!ban.until) return true;
  const until = Date.parse(ban.until);
  if (Number.isNaN(until)) return true;
  return until > Date.now();
}
async function resolveUserFromRequest(url, env) {
  const userID = findUserID(url);
  if (userID) return getUser(env, userID);
  const username = findUsername(url);
  if (username) return getUserByUsername(env, username);
  return null;
}
function findUserID(url) {
  const candidates = [
    url.searchParams.get("userID"),
    url.searchParams.get("user_id"),
    url.searchParams.get("uid"),
    url.searchParams.get("id"),
    ...url.pathname.split("/")
  ];
  return candidates.find((value) => isValidUuidV4(value)) || "";
}
function findUsername(url) {
  return normalizeUsername(
    url.searchParams.get("username") || url.searchParams.get("user") || ""
  );
}
function hasRemainingQuota(user, usage, config) {
  const limit = getTrafficLimit(user, config);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  return Number(usage?.total || 0) < limit;
}
function getTrafficLimit(user, config) {
  const globalSettings = config?.settings || {};
  const value = globalSettings.trafficLimitBytes ?? globalSettings.quotaBytes ?? globalSettings.totalLimitBytes ?? globalSettings.limitBytes;
  const limit = Number(value);
  return Number.isFinite(limit) ? limit : 0;
}
function normalizeRuntimeConfig(config = {}) {
  return {
    ...config,
    protocol: config.protocol || config.defaultProtocol || "vless",
    transport: config.transport || config.defaultTransport || "websocket",
    settings: config.settings && typeof config.settings === "object" ? config.settings : {}
  };
}

// src/stream/forward.js
async function forwardTcpSession({ firstPacket, reader, bridge, connectTcp }) {
  const socket = connectTcp({ hostname: firstPacket.hostname, port: firstPacket.port });
  let remoteWriter;
  let uploadError;
  const downloadPump = pumpRemoteToBridge(socket, bridge).catch((error) => {
    bridge.close(error);
  });
  try {
    remoteWriter = socket.writable.getWriter();
    if (firstPacket.payload.byteLength > 0) {
      await remoteWriter.write(firstPacket.payload);
    }
    while (!bridge.closed) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toUint8Array3(value);
      if (chunk.byteLength === 0) continue;
      await remoteWriter.write(chunk);
    }
  } catch (error) {
    uploadError = error;
    bridge.close(error);
  } finally {
    if (remoteWriter) {
      try {
        await remoteWriter.close();
      } catch {
        try {
          remoteWriter.releaseLock();
        } catch {
        }
      }
    }
    try {
      await downloadPump;
    } catch {
    }
    closeSocket(socket);
  }
  if (uploadError) throw uploadError;
}
async function pumpRemoteToBridge(socket, bridge) {
  const remoteReader = socket.readable.getReader();
  try {
    while (!bridge.closed) {
      const { done, value } = await remoteReader.read();
      if (done) break;
      if (!bridge.send(value)) break;
    }
  } finally {
    try {
      remoteReader.releaseLock();
    } catch {
    }
  }
}
function closeSocket(socket) {
  try {
    socket?.close?.();
  } catch {
  }
}
function toUint8Array3(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}

// src/transport/ws.js
var WS_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/octet-stream"
};
async function handleWebSocketRequest(request, env, ctx, options = {}) {
  const upgradeHeader = request.headers.get("upgrade") || "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Bad Request", { status: 400 });
  }
  const session = await resolveDataFlowSession(request, env);
  if (!session.ok) return session.response;
  if (session.transport !== "ws") {
    return new Response("Transport is not enabled for this user", { status: 403 });
  }
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  server.binaryType = "arraybuffer";
  let firstPacketReader;
  let bridge;
  let stopped = false;
  const inboundQueue = createWebSocketChunkQueue();
  const inboundReader = inboundQueue.reader();
  server.addEventListener("message", (event) => {
    if (stopped) return;
    inboundQueue.push(event.data);
  });
  server.addEventListener("close", () => {
    stopped = true;
    inboundQueue.close();
    bridge?.close();
  });
  server.addEventListener("error", () => {
    stopped = true;
    inboundQueue.close();
    bridge?.close();
  });
  firstPacketReader = inboundReader;
  let firstPacket;
  try {
    firstPacket = await readFirstProxyPacket(firstPacketReader, session, options);
  } catch (error) {
    inboundQueue.close();
    try {
      server.close(1002, error?.message || "Invalid request");
    } catch {
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }
  if (!firstPacket) {
    inboundQueue.close();
    try {
      server.close(1002, "Invalid request");
    } catch {
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }
  if (firstPacket.isUDP && firstPacket.protocol !== "trojan" && firstPacket.port !== 53) {
    inboundQueue.close();
    try {
      server.close(1003, "UDP is not supported");
    } catch {
    }
    return new Response(null, { status: 101, webSocket: client, headers: WS_RESPONSE_HEADERS });
  }
  bridge = createWebSocketBridge(server);
  queueMicrotask(async () => {
    try {
      await runWebSocketSession({ request, firstPacket, bridge, inboundQueue, reader: firstPacketReader, queueReader: inboundReader });
    } catch (error) {
      bridge.close(error);
    } finally {
      stopped = true;
      inboundQueue.close();
      try {
        server.close();
      } catch {
      }
    }
  });
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: WS_RESPONSE_HEADERS
  });
}
async function runWebSocketSession({ request, firstPacket, bridge, inboundQueue, reader, queueReader }) {
  await writeProtocolResponseHeader(firstPacket, bridge);
  if (firstPacket.isUDP) {
    throw new Error("UDP outbound is not implemented yet");
  }
  const combinedReader = createCombinedReader(reader, queueReader);
  await forwardTcpSession({
    firstPacket,
    reader: combinedReader,
    bridge,
    connectTcp: createTcpConnector(request)
  });
}
async function writeProtocolResponseHeader(firstPacket, bridge) {
  if (firstPacket.responseHeader?.byteLength) {
    bridge.send(firstPacket.responseHeader);
  }
}
function createWebSocketBridge(socket) {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    send(value) {
      if (closed) return false;
      try {
        socket.send(toUint8Array4(value));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      try {
        if (error) {
          socket.close(1011, error?.message || "internal error");
        } else {
          socket.close();
        }
      } catch {
      }
    }
  };
}
function createWebSocketChunkQueue() {
  const chunks = [];
  const waiters = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const chunk = toUint8Array4(value);
      if (chunk.byteLength === 0) return;
      if (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter({ done: false, value: chunk });
        return;
      }
      chunks.push(chunk);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter({ done: true });
      }
    },
    reader() {
      return {
        read() {
          if (chunks.length > 0) {
            return Promise.resolve({ done: false, value: chunks.shift() });
          }
          if (closed) return Promise.resolve({ done: true });
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        releaseLock() {
        }
      };
    }
  };
}
function createCombinedReader(initialReader, queueReader) {
  let initialDone = false;
  return {
    async read() {
      if (!initialDone) {
        const first = await initialReader.read();
        if (!first.done) return first;
        initialDone = true;
      }
      return queueReader.read();
    },
    releaseLock() {
      try {
        initialReader.releaseLock();
      } catch {
      }
    }
  };
}
function toUint8Array4(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(value || 0);
}

// src/stream/bridge.js
function createStreamBridge(controller) {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    send(value) {
      if (closed) return false;
      try {
        controller.enqueue(toUint8Array5(value));
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close(error) {
      if (closed) return;
      closed = true;
      try {
        if (error) controller.error(error);
        else controller.close();
      } catch {
      }
    }
  };
}
function toUint8Array5(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}

// src/transport/xhttp.js
var XHTTP_RESPONSE_HEADERS = {
  "content-type": "application/octet-stream",
  "x-accel-buffering": "no",
  "cache-control": "no-store"
};
async function handleXhttpRequest(request, env, ctx, options = {}) {
  if (!request.body) {
    return new Response("Bad Request", { status: 400 });
  }
  const session = await resolveDataFlowSession(request, env);
  if (!session.ok) return session.response;
  if (session.transport !== "xhttp") {
    return new Response("Transport is not enabled for this user", { status: 403 });
  }
  const reader = request.body.getReader();
  let firstPacket;
  try {
    firstPacket = await readFirstProxyPacket(reader, session, options);
  } catch (error) {
    releaseReader(reader);
    return new Response(error?.message || "Invalid request", { status: 400 });
  }
  if (!firstPacket) {
    releaseReader(reader);
    return new Response("Invalid request", { status: 400 });
  }
  if (firstPacket.isUDP && firstPacket.protocol !== "trojan" && firstPacket.port !== 53) {
    releaseReader(reader);
    return new Response("UDP is not supported", { status: 400 });
  }
  return new Response(new ReadableStream({
    async start(controller) {
      const bridge = createStreamBridge(controller);
      try {
        await runXhttpSession({
          request,
          env,
          ctx,
          reader,
          firstPacket,
          bridge
        });
      } catch (error) {
        bridge.close(error);
      } finally {
        releaseReader(reader);
        bridge.close();
      }
    },
    cancel() {
      cancelReader(reader);
    }
  }), {
    status: 200,
    headers: XHTTP_RESPONSE_HEADERS
  });
}
async function runXhttpSession({ request, reader, firstPacket, bridge }) {
  await writeProtocolResponseHeader2(firstPacket, bridge);
  if (firstPacket.isUDP) {
    throw new Error("UDP outbound is not implemented yet");
  }
  await forwardTcpSession({
    firstPacket,
    reader,
    bridge,
    connectTcp: createTcpConnector(request)
  });
}
async function writeProtocolResponseHeader2(firstPacket, bridge) {
  if (firstPacket.responseHeader?.byteLength) {
    bridge.send(firstPacket.responseHeader);
  }
}
function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch {
  }
}
function cancelReader(reader) {
  try {
    const cancelled = reader.cancel();
    if (cancelled?.catch) cancelled.catch(() => {
    });
  } catch {
  }
}

// src/proxy/index.js
async function handleDataFlowRequest(request, env, ctx) {
  if (isWebSocketRequest(request)) {
    return handleWebSocketRequest(request, env, ctx);
  }
  if (isXhttpRequest(request)) {
    return handleXhttpRequest(request, env, ctx);
  }
  return jsonResponse({
    ok: false,
    error: "DATA_FLOW_NOT_IMPLEMENTED",
    message: "only xhttp tcp forwarding is wired"
  }, 501);
}
function isXhttpRequest(request) {
  const contentType = request.headers.get("content-type") || "";
  return request.method === "POST" && !contentType.includes("application/grpc");
}
function isWebSocketRequest(request) {
  const upgrade = request.headers.get("upgrade") || "";
  return upgrade.toLowerCase() === "websocket";
}

// src/index.js
var index_default = {
  async fetch(request, env, ctx) {
    if (!isValidRuntimeEnv(env)) {
      return jsonResponse({
        ok: false,
        error: "INVALID_ENV",
        message: "ID must be a UUID v4 and DB binding is required"
      }, 500);
    }
    const url = new URL(request.url);
    if (isApiRequest(url, request)) {
      return handleApiRequest(request, env, ctx);
    }
    if (isDataFlowRequest(request)) {
      return handleDataFlowRequest(request, env, ctx);
    }
    return textResponse("edgetunnel core is running", 200);
  }
};
function isValidRuntimeEnv(env) {
  return Boolean(env?.DB) && isValidUuidV4(env?.ID);
}
function isApiRequest(url, request) {
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname === "/login") return true;
  if (url.pathname === "/admin") return true;
  if (url.pathname === "/sub") return true;
  if (request.headers.get("accept")?.includes("application/json")) return true;
  return false;
}
function isDataFlowRequest(request) {
  const upgrade = request.headers.get("upgrade") || "";
  const contentType = request.headers.get("content-type") || "";
  if (upgrade.toLowerCase() === "websocket") return true;
  if (contentType.includes("application/grpc")) return true;
  if (contentType.includes("application/x-http")) return true;
  if (request.method === "POST" && request.body) return true;
  return false;
}
export {
  index_default as default
};
