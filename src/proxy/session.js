import { getBan, getGlobalConfig, getUsage, getUser, getUserByUsername } from '../config/loader.js';
import { isValidUuidV4, normalizeUsername } from '../utils/crypto.js';

export async function resolveDataFlowSession(request, env) {
  const url = new URL(request.url);
  const user = await resolveUserFromRequest(url, env);

  if (!user) {
    return { ok: false, response: new Response('User not found', { status: 404 }) };
  }

  if (user.disabled) {
    return { ok: false, response: new Response('User is disabled', { status: 403 }) };
  }

  const ban = await getBan(env, user.userID);
  if (isActiveBan(ban)) {
    return { ok: false, response: new Response('User is banned', { status: 403 }) };
  }

  const usage = await getUsage(env, user.userID);
  const config = normalizeRuntimeConfig(await getGlobalConfig(env));

  if (!hasRemainingQuota(user, usage, config)) {
    return { ok: false, response: new Response('Traffic quota exhausted', { status: 403 }) };
  }

  return {
    ok: true,
    user,
    ban,
    usage,
    config,
    protocol: config.protocol || config.defaultProtocol || 'vless',
    transport: config.transport || config.defaultTransport || 'websocket',
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
    url.searchParams.get('userID'),
    url.searchParams.get('user_id'),
    url.searchParams.get('uid'),
    url.searchParams.get('id'),
    ...url.pathname.split('/'),
  ];

  return candidates.find((value) => isValidUuidV4(value)) || '';
}

function findUsername(url) {
  return normalizeUsername(
    url.searchParams.get('username') ||
    url.searchParams.get('user') ||
    '',
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
    protocol: config.protocol || config.defaultProtocol || 'vless',
    transport: config.transport || config.defaultTransport || 'websocket',
    settings: config.settings && typeof config.settings === 'object' ? config.settings : {},
  };
}
