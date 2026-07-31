import assert from 'node:assert/strict';
import test from 'node:test';

import { buildECHValue, withECH } from '../src/subscription/ech.js';
import { generateNodeInputs, generateSubscription } from '../src/subscription/generator.js';
import { buildNodeURI } from '../src/subscription/node-builder.js';
import { normalizeNodeParams } from '../src/subscription/params.js';

test('VLESS websocket URI snapshot uses exactly one encoding layer', () => {
  const params = normalizeNodeParams({
    path: '/ws route?token=a/b',
    fingerprint: 'chrome',
    zeroRTT: true,
    tlsFragment: 'Shadowrocket',
    customQuery: 'alpn=h2%2Chttp%2F1.1&security=reality',
  });
  const uri = buildNodeURI({
    protocol: 'vless',
    uuid: '00000000-0000-4000-8000-000000000001',
    address: '203.0.113.8',
    port: 443,
    transport: 'websocket',
    host: 'edge.example.com',
    sni: 'sni.example.com',
    path: params.path,
    query: params.query,
    name: 'VLESS WS 香港',
  });

  assert.equal(uri, 'vless://00000000-0000-4000-8000-000000000001@203.0.113.8:443?security=reality&type=ws&host=edge.example.com&sni=sni.example.com&path=%2Fws+route%3Ftoken%3Da%252Fb%26ed%3D2560&encryption=none&fp=chrome&fragment=1%2C40-60%2C30-50%2Ctlshello&alpn=h2%2Chttp%2F1.1#VLESS%20WS%20%E9%A6%99%E6%B8%AF');
  assert.equal(new URL(uri).searchParams.get('path'), '/ws route?token=a%2Fb&ed=2560');
  assert.equal(new URL(uri).searchParams.get('alpn'), 'h2,http/1.1');
});

test('Trojan gRPC and XHTTP URI snapshots', () => {
  const grpc = buildNodeURI({
    protocol: 'trojan', password: 'p@ss:/word', address: '2001:db8::1', port: 443,
    transport: 'grpc', host: 'grpc.example.com', path: 'Tunnel Service', security: 'tls',
    fingerprint: 'firefox', name: 'Trojan gRPC',
  });
  const xhttp = buildNodeURI({
    protocol: 'trojan', password: 'secret', address: 'edge.example.net', port: 8443,
    transport: 'xhttp', host: 'x.example.com', path: '/stream?x=1', mode: 'auto',
    security: 'none', name: 'Trojan XHTTP',
  });

  assert.equal(grpc, 'trojan://p%40ss%3A%2Fword@[2001:db8::1]:443?security=tls&type=grpc&authority=grpc.example.com&sni=grpc.example.com&serviceName=Tunnel+Service&fp=firefox#Trojan%20gRPC');
  assert.equal(xhttp, 'trojan://secret@edge.example.net:8443?security=none&type=xhttp&host=x.example.com&path=%2Fstream%3Fx%3D1&mode=auto#Trojan%20XHTTP');
});

test('random paths are deterministic through injection and 0RTT preserves query', () => {
  const result = normalizeNodeParams(
    { path: '/base?token=a%2Fb', randomPath: true, zeroRTT: true },
    { randomPath: (path) => `/fixed${path}` },
  );
  assert.equal(result.path, '/fixed/base?token=a%2Fb&ed=2560');
});

test("ECH domain='0' follows the current node host and combines DNS", () => {
  const config = { enabled: true, domain: '0', dns: 'https://dns.example/dns-query' };
  assert.equal(buildECHValue(config, 'node.example.com'), 'node.example.com+https://dns.example/dns-query');
  assert.deepEqual(withECH({ host: 'node.example.com', query: { alpn: 'h2' } }, config), {
    host: 'node.example.com',
    query: { alpn: 'h2', ech: 'node.example.com+https://dns.example/dns-query' },
  });
  assert.equal(buildECHValue({ enabled: false, domain: '0', dns: 'dns.example' }, 'node.example.com'), null);
});

test('generator expands protocols x transports x hosts without I/O', () => {
  const nodes = generateNodeInputs({
    protocols: [
      { protocol: 'vless', uuid: '00000000-0000-4000-8000-000000000001' },
      { protocol: 'trojan', password: 'secret' },
    ],
    transports: ['websocket', 'grpc', 'xhttp'],
    hosts: ['one.example.com', { host: 'two.example.com', sni: 'tls.example.com' }],
    address: '198.51.100.10', port: 443, path: '/tunnel', name: 'base',
  });
  const output = generateSubscription(nodes);

  assert.equal(nodes.length, 12);
  assert.equal(output.split('\n').length, 12);
  assert.deepEqual(nodes.slice(0, 4).map(({ protocol, transport, host }) => ({ protocol, transport, host })), [
    { protocol: 'vless', transport: 'websocket', host: 'one.example.com' },
    { protocol: 'vless', transport: 'websocket', host: 'two.example.com' },
    { protocol: 'vless', transport: 'grpc', host: 'one.example.com' },
    { protocol: 'vless', transport: 'grpc', host: 'two.example.com' },
  ]);
  assert.match(output, /^vless:\/\//);
  assert.match(output, /\ntrojan:\/\//);
});
