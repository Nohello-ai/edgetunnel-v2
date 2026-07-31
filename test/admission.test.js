import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmissionService, parseDataFlowRoute } from '../src/admission/service.js';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

test('parseDataFlowRoute accepts only canonical transport paths', () => {
  assert.deepEqual(
    parseDataFlowRoute(new URL(`https://example.com/ws/${USER_ID}/vless/random`)),
    { transport: 'websocket', userID: USER_ID, protocol: 'vless', suffix: ['random'] },
  );
  assert.equal(parseDataFlowRoute(new URL(`https://example.com/other/${USER_ID}`)), null);
  assert.equal(parseDataFlowRoute(new URL('https://example.com/ws/not-a-uuid')), null);
  assert.equal(parseDataFlowRoute(new URL(`https://example.com/ws/${USER_ID}`)), null);
});

test('admission selects only the protocol declared by the route', async () => {
  const service = createService({ protocols: ['vless', 'trojan'] });
  const session = await service.admit({ transport: 'websocket', userID: USER_ID, protocol: 'trojan' });
  assert.equal(session.protocol, 'trojan');
  await assert.rejects(
    createService({ protocols: ['vless'] }).admit({ transport: 'websocket', userID: USER_ID, protocol: 'trojan' }),
    { code: 'PROTOCOL_DISABLED' },
  );
});

test('admission checks user governance before returning a session', async () => {
  const service = createService();
  const session = await service.admit({ transport: 'grpc', userID: USER_ID, protocol: 'vless' });

  assert.equal(session.userID, USER_ID);
  assert.equal(session.protocol, 'vless');
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
  return { transport: 'grpc', userID: USER_ID, protocol: 'vless' };
}

function createService(options = {}) {
  return createAdmissionService({
    users: {
      getByID: async () => ({
        userID: USER_ID,
        username: 'alice',
        role: 'user',
        disabled: Boolean(options.disabled),
        quotaBytes: 1024,
        settings: {},
      }),
    },
    bans: { getActive: async () => options.ban || null },
    usage: { get: async () => ({ total: options.total || 0 }) },
    config: { getRuntime: async () => ({ protocols: options.protocols || ['vless'], transports: options.transports || ['websocket', 'grpc', 'xhttp'] }) },
  });
}
