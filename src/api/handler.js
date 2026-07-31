import {
  deleteBan,
  getBan,
  getGlobalConfig,
  getUsage,
  getUser,
  listUsage,
  listUsers,
  putBan,
  putGlobalConfig,
  putUser,
} from '../config/loader.js';
import { normalizeBan, normalizeGlobalConfig, normalizeUserConfig } from '../config/schema.js';
import { generateUserID, sha224Text } from '../utils/crypto.js';
import { jsonResponse, readJson, textResponse } from '../utils/http.js';
import {
  broadcastNotification,
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  sendNotification,
  sendSystemNotification,
} from './notification.js';

export async function handleApiRoute(context) {
  const { segments } = context;

  if (segments.length === 0) {
    return jsonResponse({ ok: true, name: 'edgetunnel api' });
  }

  const [resource, action] = segments;

  if (resource === 'login') return handleLoginRoute(context);
  if (resource === 'admin') return handleLoginRoute(context);
  if (resource === 'sub') return handleSubRoute(context);

  if (resource === 'user') return handleUserRoute(context, action, segments[2]);
  if (resource === 'config') return handleConfigRoute(context, action);
  if (resource === 'subscription') return handleSubscriptionRoute(context, action);
  if (resource === 'usage') return handleUsageRoute(context, action);
  if (resource === 'notification') return handleNotificationRoute(context, action);

  return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
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
      hasUser: Boolean(user),
    },
    user,
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

  if (action === 'list') {
    requireAdmin(auth);
    return jsonResponse({ ok: true, users: await listUsers(env) });
  }

  if (action === 'add') {
    requireAdmin(auth);
    const body = await requireJson(request);
    const username = body.username;
    const userID = body.userID || await generateUserID(username, env.ID);
    const user = normalizeUserConfig({ ...body, userID, username });

    await putUser(env, userID, user);
    return jsonResponse({ ok: true, user });
  }

  if (action === 'update') {
    const body = await requireJson(request);
    const userID = body.userID || auth.userID;
    requireSelfOrAdmin(auth, userID);
    const current = await getUser(env, userID);
    const update = auth.isAdmin ? body : pickOwnUserUpdate(body);
    const user = normalizeUserConfig({ ...current, ...update, userID }, current || {});

    await putUser(env, userID, user);
    return jsonResponse({ ok: true, user });
  }

  if (action === 'disable') {
    requireAdmin(auth);
    const body = await requireJson(request);
    const userID = body.userID || targetUserID;
    const current = await requireUser(env, userID);
    const user = normalizeUserConfig({ ...current, disabled: true }, current);

    await putUser(env, userID, user);
    return jsonResponse({ ok: true, user });
  }

  if (action === 'ban') {
    requireAdmin(auth);
    const body = await requireJson(request);
    const userID = body.userID || targetUserID;
    await requireUser(env, userID);
    const ban = normalizeBan(body);

    await putBan(env, userID, ban);
    await sendSystemNotification(env, userID, `account banned: ${ban.reason || 'no reason'}`);
    return jsonResponse({ ok: true, ban });
  }

  if (action === 'unban') {
    requireAdmin(auth);
    const body = await readJson(request) || {};
    const userID = body.userID || targetUserID;

    await deleteBan(env, userID);
    await sendSystemNotification(env, userID, 'account unbanned');
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

  if (action !== 'global') {
    return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
  }

  requireAdmin(auth);

  if (request.method === 'GET') {
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

  if (action === 'link') {
    const link = `${url.origin}/sub?userID=${encodeURIComponent(auth.userID)}`;
    return jsonResponse({ ok: true, link });
  }

  if (action === 'nodes') {
    return jsonResponse({
      ok: true,
      nodes: [{
        userID: auth.userID,
        username: user.username,
        protocol: config.protocol,
        transport: config.transport,
        disabled: user.disabled,
        path: buildTransportPath(config.transport, auth.userID),
      }],
    });
  }

  return jsonResponse({ ok: false, error: 'NOT_FOUND' }, 404);
}

async function handleUsageRoute(context, action) {
  const { auth, env } = context;

  if (action === 'list') {
    requireAdmin(auth);
    return jsonResponse({ ok: true, usage: await listUsage(env) });
  }

  const userID = action || auth.userID;
  requireSelfOrAdmin(auth, userID);
  return jsonResponse({ ok: true, usage: await getUsage(env, userID) });
}

async function handleNotificationRoute(context, action) {
  const { auth, env, request } = context;

  if (action === 'send') {
    requireAdmin(auth);
    const body = await requireJson(request);
    const notification = await sendNotification(env, body.userID, body.message, 'private');
    return jsonResponse({ ok: true, notification });
  }

  if (action === 'broadcast') {
    requireAdmin(auth);
    const body = await requireJson(request);
    const notification = await broadcastNotification(env, body.message);
    return jsonResponse({ ok: true, notification });
  }

  if (action === 'unread') {
    return jsonResponse({ ok: true, unread: await countUnreadNotifications(env, auth.userID) });
  }

  if (action === 'read') {
    const body = await requireJson(request);
    const notification = await markNotificationRead(env, auth.userID, body.notificationID);
    return jsonResponse({ ok: true, notification });
  }

  return jsonResponse({ ok: true, notifications: await listNotifications(env, auth.userID) });
}

async function requireJson(request) {
  const body = await readJson(request);

  if (!body) {
    throw new ApiError('INVALID_JSON', 400);
  }

  return body;
}

async function requireUser(env, userID) {
  const user = await getUser(env, userID);

  if (!user) {
    throw new ApiError('USER_NOT_FOUND', 404);
  }

  return user;
}

function requireAdmin(auth) {
  if (!auth.isAdmin) {
    throw new ApiError('ADMIN_REQUIRED', 403);
  }
}

function requireSelfOrAdmin(auth, userID) {
  if (!auth.isAdmin && auth.userID !== userID) {
    throw new ApiError('FORBIDDEN', 403);
  }
}

function buildSubscriptionNode(url, user, config) {
  const protocol = config.protocol;
  const transport = config.transport;
  const host = pickHost(url.host, config.HOSTS);
  const path = buildTransportPath(transport, user.userID, config);
  const baseParams = new URLSearchParams({
    type: transport,
    path,
  });
  const customParams = parseCustomParams(config.订阅参数);
  const params = new URLSearchParams(baseParams);
  for (const [key, value] of customParams) {
    params.set(key, value);
  }
  const echParams = buildECHParams(config, host);
  if (echParams && !params.has('ech')) params.set('ech', echParams);
  if (config.Fingerprint) params.set('fp', config.Fingerprint);
  if (!params.has('host')) params.set('host', host);
  if (!params.has('sni')) params.set('sni', host);
  if (config['启用0RTT'] || config['0RTT']) params.set('ed', '2560');
  const fragment = normalizeFragment(config.TLS分片);
  if (fragment) params.set('fragment', fragment);
  const name = encodeURIComponent(user.username);

  if (protocol === 'trojan') {
    return `trojan://${sha224Text(user.userID)}@${url.host}:443?${params.toString()}#${name}`;
  }

  return `${protocol}://${user.userID}@${url.host}:443?${params.toString()}#${name}`;
}

function buildTransportPath(transport, userID, config) {
  const encodedUserID = encodeURIComponent(userID);
  const randomSuffix = config['随机路径'] ? `/${Math.random().toString(36).slice(2, 10)}` : '';

  if (transport === 'grpc') return `/grpc/${encodedUserID}${randomSuffix}`;
  if (transport === 'websocket') return `/ws/${encodedUserID}${randomSuffix}`;
  return `/xhttp/${encodedUserID}${randomSuffix}`;
}

function buildECHParams(config, host) {
  if (!config?.ECH) return '';

  const echConfig = config.ECHConfig || {};
  const dns = String(echConfig.dns || echConfig.DNS || '').trim();
  const domainRaw = echConfig.domain ?? echConfig.sni ?? echConfig.SNI ?? '';
  const domain = String(domainRaw).trim();
  const target = domain === '0' ? `${host}+${dns}` : (domain ? `${domain}+${dns}` : dns);

  return target ? encodeURIComponent(target) : '';
}

function normalizeFragment(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text === 'Shadowrocket') return '1,40-60,30-50,tlshello';
  if (text === 'Happ') return '3,1,tlshello';
  return text;
}

function pickHost(primaryHost, hosts = []) {
  const list = Array.isArray(hosts) && hosts.length ? hosts : [primaryHost];
  return list[Math.floor(Math.random() * list.length)] || primaryHost;
}

function parseCustomParams(input) {
  const text = String(input || '').trim();
  const params = new URLSearchParams();

  if (!text) return params;

  const normalized = text.replace(/^\?/, '');
  for (const part of normalized.split('&')) {
    if (!part) continue;
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim();
    if (!key) continue;
    const value = rest.join('=');
    params.set(key, value);
  }

  return params;
}

function pickOwnUserUpdate(body) {
  const allowed = new Set(['password']);
  const blocked = Object.keys(body).filter((key) => !allowed.has(key));

  if (blocked.length > 0) {
    throw new ApiError(`USER_CAN_ONLY_UPDATE_PASSWORD: ${blocked.join(',')}`, 403);
  }

  if (!Object.hasOwn(body, 'password')) {
    throw new ApiError('PASSWORD_REQUIRED', 400);
  }

  return { password: String(body.password || '') };
}

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
