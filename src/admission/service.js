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

export function createAdmissionService({ userAdmin, config, quotaDO }) {
  return {
    async admit(route) {
      if (!route || !isValidUuidV4(route.userID)) {
        throw new AppError('INVALID_DATA_FLOW_ROUTE', 404);
      }

      if (!userAdmin) throw new AppError('USER_ADMIN_BINDING_REQUIRED', 500);

      // 通过 Service Binding 向管理层查询用户状态（准入决策）
      let admission = { allowed: false, reason: 'ADMISSION_SERVICE_UNAVAILABLE' };
      try {
        const resp = await userAdmin.fetch(`https://user-admin/internal/admit?userId=${route.userID}`);
        admission = await resp.json();
      } catch {
        throw new AppError('ADMISSION_SERVICE_UNAVAILABLE', 503);
      }

      if (!admission.allowed) {
        throw new AppError(admission.reason || 'ADMISSION_DENIED', 403);
      }

      // 从 DO 获取当前 stopVersion（用于 meter 的 stop 标志检查）
      let stopVersion = 0;
      if (quotaDO) {
        try {
          const id = quotaDO.idFromName(route.userID);
          const stub = quotaDO.get(id);
          const resp = await stub.fetch('https://do/status');
          const status = await resp.json();
          stopVersion = status.stopVersion || 0;
        } catch {}
      }

      // 从 KV 读取全局传输配置
      const runtimeConfig = await config.getRuntime();
      const protocol = resolveProtocol(route, runtimeConfig);
      const allowedTransports = resolveTransports(runtimeConfig);
      if (!allowedTransports.includes(route.transport)) {
        throw new AppError('TRANSPORT_DISABLED', 403);
      }

      return createDataFlowSession({
        user: admission.user,
        protocol,
        transport: route.transport,
        usage: { upload: 0, download: 0, total: admission.used || 0 },
        quotaBytes: admission.quotaBytes || 0,
        budget: 0,
        resetVersion: stopVersion,
      });
    },
  };
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
