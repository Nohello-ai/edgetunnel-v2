import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrpcFrameParser, decodeGrpcHunk, encodeGrpcFrame, encodeGrpcHunk } from '../src/transport-v2/grpc-frame.js';
import { openGrpcTransport } from '../src/transport-v2/grpc.js';
import { openXhttpTransport } from '../src/transport-v2/xhttp.js';

test('gRPC frame parser preserves messages across every chunk split', () => {
  const frame = encodeGrpcFrame(Uint8Array.of(1, 2, 3, 4));
  for (let split = 0; split <= frame.length; split += 1) {
    const parser = createGrpcFrameParser();
    const first = parser.push(frame.slice(0, split));
    const second = parser.push(frame.slice(split));
    assert.deepEqual([...first.messages, ...second.messages].map((v) => [...v]), [[1, 2, 3, 4]]);
    assert.equal(second.remainder.byteLength, 0);
  }
});

test('gRPC Hunk uses protobuf bytes field wire format', async () => {
  const hunk = encodeGrpcHunk(Uint8Array.of(1, 2, 3));
  assert.deepEqual([...hunk], [10, 3, 1, 2, 3]);
  assert.deepEqual([...decodeGrpcHunk(hunk)], [1, 2, 3]);

  const request = new Request('https://example.com/grpc/id', {
    method: 'POST', headers: { 'content-type': 'application/grpc' },
    body: encodeGrpcFrame(hunk), duplex: 'half',
  });
  const transport = openGrpcTransport(request);
  assert.deepEqual([...(await transport.readable.getReader().read()).value], [1, 2, 3]);
  const responseRead = transport.response.body.getReader().read();
  await transport.write(Uint8Array.of(4, 5));
  const parsed = createGrpcFrameParser().push((await responseRead).value).messages[0];
  assert.deepEqual([...decodeGrpcHunk(parsed)], [4, 5]);
  await transport.close();
});

test('gRPC parser rejects compression and oversized frames', () => {
  assert.throws(() => createGrpcFrameParser().push(Uint8Array.of(1, 0, 0, 0, 0)), /GRPC_COMPRESSION/);
  assert.throws(() => createGrpcFrameParser({ maxFrameBytes: 2 }).push(Uint8Array.of(0, 0, 0, 0, 3)), /TOO_LARGE/);
});

test('XHTTP exposes request and response as independent byte streams', async () => {
  const request = new Request('https://example.com/xhttp/id', {
    method: 'POST', headers: { 'content-type': 'application/x-http' }, body: Uint8Array.of(7, 8), duplex: 'half',
  });
  const transport = openXhttpTransport(request);
  const input = await transport.readable.getReader().read();
  assert.deepEqual([...input.value], [7, 8]);
  const responseRead = transport.response.body.getReader().read();
  await transport.write(Uint8Array.of(9));
  assert.deepEqual([...(await responseRead).value], [9]);
  await transport.close();
});
