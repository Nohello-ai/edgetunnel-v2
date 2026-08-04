import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmissionService, parseDataFlowRoute } from '../src/admission/service.js';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

test('parseDataFlowRoute accepts only canonical transport paths', () => {
  assert.deepEqual(
    parseDataFlowRoute(new URL(`https://example.com/ws/${USER_ID}/vless/random`)),
    { transport: 'websocket', userID: USER_ID },
  );
  assert.deepEqual(
    parseDataFlowRoute(new URL(`https://example.com/ws/${USER_ID}`)),
    { transport: 'websocket', userID: USER_ID },
  );
  assert.equal(parseDataFlowRoute(new URL(`https://example.com/other/${USER_ID}`)), null);
  assert.equal(parseDataFlowRoute(new URL('https://example.com/ws/not-a-uuid')), null);
});

test('admission auto-detects protocol from data stream', async () => {
  const service = createService();
  const session = await service.admit({ transport: 'websocket', userID: USER_ID });
  assert.equal(session.protocol, '');
  assert.equal(session.userID, USER_ID);
  assert.equal(session.transport, 'websocket');
});

test('admission checks user governance before returning a session', async () => {
  const service = createService();
  const session = await service.admit({ transport: 'grpc', userID: USER_ID });

  assert.equal(session.userID, USER_ID);
  assert.equal(session.protocol, '');
  assert.equal(session.transport, 'grpc');
  assert.equal(session.quotaBytes, 1024);
});

test('admission rejects disabled, banned, exhausted, and disabled transport', async () => {
  await assert.rejects(createService({ disabled: true }).admit(route()), { code: 'USER_DISABLED' });
  await assert.rejects(createService({ ban: { reason: 'test' } }).admit(route()), { code: 'USER_BANNED' });
  await assert.rejects(createService({ total: 1024 }).admit(route()), { code: 'TRAFFIC_QUOTA_EXHAUSTED' });
  await assert.rejects(createService({ transports: ['websocket'] }).admit(route()), { code: 'TRANSPORT_DISABLED' });
});

function route() {
  return { transport: 'grpc', userID: USER_ID };
}

function createService(options = {}) {
  const exhausted = (options.total || 0) >= 1024;
  const userAdmin = {
    fetch: async () => {
      if (options.disabled) return jsonResponse({ allowed: false, reason: 'USER_DISABLED' });
      if (options.ban) return jsonResponse({ allowed: false, reason: 'USER_BANNED' });
      if (exhausted) return jsonResponse({ allowed: false, reason: 'TRAFFIC_QUOTA_EXHAUSTED' });
      return jsonResponse({
        allowed: true,
        quotaBytes: 1024,
        used: options.total || 0,
        user: { userID: USER_ID, username: 'alice', role: 'user', settings: {}, trojanSecret: '' },
      });
    },
  };
  return createAdmissionService({
    userAdmin,
    config: { getRuntime: async () => ({ protocols: options.protocols || ['vless'], transports: options.transports || ['websocket', 'grpc', 'xhttp'] }) },
    quotaDO: {
      idFromName: () => 'do-id',
      get: () => ({
        fetch: async () => jsonResponse({ stopVersion: 0 }),
      }),
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
