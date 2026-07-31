import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRequest } from '../src/routes/router.js';

const UID = '123e4567-e89b-42d3-a456-426614174000';

test('control-plane POST never enters xhttp', () => {
  const request = new Request('https://example.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(classifyRequest(request).kind, 'api');
});

test('data transports require canonical path and matching request shape', () => {
  const grpc = new Request(`https://example.com/grpc/${UID}/vless`, {
    method: 'POST', headers: { 'content-type': 'application/grpc+proto' }, body: new Uint8Array(),
  });
  const wrong = new Request(`https://example.com/grpc/${UID}/vless`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const generic = new Request('https://example.com/random', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(),
  });

  assert.equal(classifyRequest(grpc).kind, 'data-flow');
  assert.equal(classifyRequest(wrong).kind, 'status');
  assert.equal(classifyRequest(generic).kind, 'status');
});
