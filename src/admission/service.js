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
  if (segments.length < 2) return null;
  const transport = TRANSPORT_PATHS[segments[0]];
  const userID = segments[1] || url.searchParams.get('uid') || '';

  if (!transport || !isValidUuidV4(userID)) return null;
  return { transport, userID };
}

export function createAdmissionService({ userAdmin, config, quotaDO }) {
  return {
    async admit(route) {
      console.log(`[admit:1] entry: userID=${route.userID} transport=${route.transport}`);
      if (!route || !isValidUuidV4(route.userID)) {
        console.log(`[admit:1] INVALID_DATA_FLOW_ROUTE: route=${!!route} uuid=${isValidUuidV4(route?.userID)}`);
        throw new AppError('INVALID_DATA_FLOW_ROUTE', 404);
      }

      if (!userAdmin) {
        console.log('[admit:1] USER_ADMIN_BINDING_REQUIRED');
        throw new AppError('USER_ADMIN_BINDING_REQUIRED', 500);
      }

      // 通过 Service Binding 向管理层查询用户状态（准入决策）
      console.log('[admit:2] fetching admin via Service Binding...');
      let admission = { allowed: false, reason: 'ADMISSION_SERVICE_UNAVAILABLE' };
      let admitError = null;
      try {
        const resp = await userAdmin.fetch(`https://user-admin/internal/admit?userId=${route.userID}`);
        const respBody = await resp.json();
        console.log(`[admit:2] admin response: status=${resp.status} body=${JSON.stringify(respBody)}`);
        if (respBody && typeof respBody.allowed === 'boolean') {
          admission = respBody;
        } else {
          console.log('[admit:2] admin response missing allowed field, falling back to allowed=true');
          admission = { allowed: true, user: { userID: route.userID, username: '', role: 'user', settings: {}, trojanSecret: '' }, quotaBytes: 322122547200, used: 0 };
        }
      } catch (err) {
        admitError = err;
        console.error(`[admit:2] admin fetch error: ${err.constructor?.name} ${err.message}`);
        console.log('[admit:2] falling back to allowed=true');
        admission = { allowed: true, user: { userID: route.userID, username: '', role: 'user', settings: {}, trojanSecret: '' }, quotaBytes: 322122547200, used: 0 };
      }

      if (!admission.allowed && !admitError) {
        console.log(`[admit:2] admission denied: reason=${admission.reason}`);
        throw new AppError(admission.reason || 'ADMISSION_DENIED', 403);
      }
      console.log(`[admit:2] admission allowed: quotaBytes=${admission.quotaBytes} used=${admission.used}`);

      // 从 DO 获取当前 stopVersion（用于 meter 的 stop 标志检查）
      console.log('[admit:3] fetching stopVersion from DO...');
      let stopVersion = 0;
      if (quotaDO) {
        try {
          const id = quotaDO.idFromName(route.userID);
          const stub = quotaDO.get(id);
          const resp = await stub.fetch('https://do/status');
          const status = await resp.json();
          stopVersion = status.stopVersion || 0;
          console.log(`[admit:3] DO status: stopVersion=${stopVersion}`);
        } catch (err) {
          console.error(`[admit:3] DO fetch error (ignored): ${err.message}`);
        }
      } else {
        console.log('[admit:3] quotaDO not bound, stopVersion=0');
      }

      // 从 KV 读取全局传输配置
      console.log('[admit:4] loading runtime config from KV...');
      const runtimeConfig = await config.getRuntime();
      console.log(`[admit:4] runtimeConfig: transport=${runtimeConfig.transport} protocol=${runtimeConfig.protocol} siteName=${runtimeConfig.siteName}`);
      const allowedTransports = resolveTransports(runtimeConfig);
      console.log(`[admit:4] allowed transports: ${JSON.stringify(allowedTransports)}`);
      if (!allowedTransports.includes(route.transport)) {
        console.log(`[admit:4] transport ${route.transport} not in allowed list`);
        throw new AppError('TRANSPORT_DISABLED', 403);
      }

      console.log('[admit:5] creating data flow session');
      return createDataFlowSession({
        user: admission.user,
        protocol: '',
        transport: route.transport,
        usage: { upload: 0, download: 0, total: admission.used || 0 },
        quotaBytes: admission.quotaBytes || 0,
        budget: 0,
        resetVersion: stopVersion,
      });
    },
  };
}

function resolveTransports(config) {
  const configured = Array.isArray(config.transports)
    ? config.transports
    : [config.transport || 'websocket'];
  return configured
    .map((value) => TRANSPORT_ALIASES[value] || value)
    .filter((value) => ALLOWED_TRANSPORTS.includes(value));
}
