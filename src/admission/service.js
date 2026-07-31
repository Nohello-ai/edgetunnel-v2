import { AppError } from '../core/errors.js';
import { createDataFlowSession } from '../core/types.js';
import { isValidUuidV4 } from '../utils/crypto.js';

const TRANSPORT_PATHS = Object.freeze({
  ws: 'websocket',
  grpc: 'grpc',
  xhttp: 'xhttp',
});

export function parseDataFlowRoute(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const transport = TRANSPORT_PATHS[segments[0]];
  const userID = segments[1] || url.searchParams.get('uid') || '';
  const protocol = segments[2] || url.searchParams.get('protocol') || '';

  if (!transport || !isValidUuidV4(userID) || !['vless', 'trojan'].includes(protocol)) return null;
  return { transport, userID, protocol, suffix: segments.slice(3) };
}

export function createAdmissionService({ users, bans, usage, config }) {
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

      const currentUsage = await usage.get(user.userID);
      const runtimeConfig = await config.getRuntime();
      const quotaBytes = resolveQuota(user, runtimeConfig);
      if (quotaBytes > 0 && Number(currentUsage.total || 0) >= quotaBytes) {
        throw new AppError('TRAFFIC_QUOTA_EXHAUSTED', 403);
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
        usage: currentUsage,
        quotaBytes,
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
  const enabled = Array.isArray(config.protocols) ? config.protocols : [config.protocol || 'vless'];
  if (!enabled.includes(route.protocol)) {
    throw new AppError('PROTOCOL_DISABLED', 403);
  }
  return route.protocol;
}

function resolveTransports(config) {
  const configured = Array.isArray(config.transports)
    ? config.transports
    : [config.transport || 'websocket'];
  return configured.filter((value) => ['websocket', 'grpc', 'xhttp'].includes(value));
}
