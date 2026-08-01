import { AppError } from '../core/errors.js';
import { createDataFlowSession } from '../core/types.js';
import { isValidUuidV4 } from '../utils/crypto.js';

const TRANSPORT_PATHS = Object.freeze({
  ws: 'websocket',
  grpc: 'grpc',
  xhttp: 'xhttp',
});

const TRANSPORT_ALIASES = Object.freeze({ ws: 'websocket', grpc: 'grpc', xhttp: 'xhttp' });
const ALLOWED_TRANSPORTS = Object.freeze(['websocket', 'grpc', 'xhttp']);

export function parseDataFlowRoute(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 3) return null;
  const transport = TRANSPORT_PATHS[segments[0]];
  const userID = segments[1] || url.searchParams.get('uid') || '';
  const protocol = segments[2] || url.searchParams.get('protocol') || '';

  if (!transport || !isValidUuidV4(userID) || !['vless', 'trojan'].includes(protocol)) return null;
  return { transport, userID, protocol, suffix: segments.slice(3) };
}

export function createAdmissionService({ users, bans, usage, config, quotaDO }) {
  return {
    async admit(route) {
      if (!route || !isValidUuidV4(route.userID)) {
        throw new AppError('INVALID_DATA_FLOW_ROUTE', 404);
      }

      const user = await users.getByID(route.userID);
      if (!user) throw new AppError('USER_NOT_FOUND', 404);
      if (user.disabled) throw new AppError('USER_DISABLED', 403);

      const activeBan = await bans.getActive(user.userID);
      if (activeBan) throw new AppError('USER_BANNED', 403);

      // 从 DO 拿权威余额(毫秒级,同机执行)
      const runtimeConfig = await config.getRuntime();
      const quotaBytes = resolveQuota(user, runtimeConfig);

      let admission = { allowed: true, remaining: 0, budget: 0, resetVersion: 0 };
      if (quotaDO && quotaBytes > 0) {
        const id = quotaDO.idFromName(route.userID);
        const stub = quotaDO.get(id);
        const resp = await stub.fetch('https://do/admit');
        admission = await resp.json().catch(() => admission);
        if (!admission.allowed) throw new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403);
      }

      const protocol = resolveProtocol(route, runtimeConfig);
      const allowedTransports = resolveTransports(runtimeConfig);
      if (!allowedTransports.includes(route.transport)) {
        throw new AppError('TRANSPORT_DISABLED', 403);
      }

      return createDataFlowSession({
        user,
        protocol,
        transport: route.transport,
        usage: { upload: 0, download: 0, total: quotaBytes > 0 ? (quotaBytes - admission.remaining) : 0 },
        quotaBytes,
        budget: admission.budget,
        resetVersion: admission.resetVersion,
      });
    },
  };
}

function resolveQuota(user, config) {
  const value = user.quotaBytes ?? config.quotaBytes ?? config.settings?.quotaBytes ?? 0;
  const quota = Number(value);
  return Number.isFinite(quota) && quota > 0 ? quota : 0;
}

function resolveProtocol(route, config) {
  let enabled = config.protocols;
  if (typeof enabled === 'string') enabled = enabled.split(',').map((s) => s.trim());
  if (!Array.isArray(enabled)) enabled = [config.protocol || 'vless'];
  if (!enabled.includes(route.protocol)) {
    throw new AppError('PROTOCOL_DISABLED', 403);
  }
  return route.protocol;
}

function resolveTransports(config) {
  const configured = Array.isArray(config.transports)
    ? config.transports
    : [config.transport || 'websocket'];
  return configured
    .map((value) => TRANSPORT_ALIASES[value] || value)
    .filter((value) => ALLOWED_TRANSPORTS.includes(value));
}
