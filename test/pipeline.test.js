import assert from 'node:assert/strict';
import test from 'node:test';
import { runPipeline } from '../src/proxy/pipeline.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const uuidBytes = Uint8Array.from(UUID.replaceAll('-', '').match(/../g), (v) => parseInt(v, 16));

test('pipeline composes VLESS parser, transport, connector, and usage', async () => {
  const packet = Uint8Array.from([1, ...uuidBytes, 0, 1, 0, 80, 2, 7, ...new TextEncoder().encode('example'), 1, 2]);
  const input = new ReadableStream({ start(c) { c.enqueue(packet); c.close(); } });
  const writes = [];
  const transport = { readable: input, write: async (v) => writes.push([...v]), close: async () => {} };
  const socket = fakeSocket([Uint8Array.of(8, 9)]);
  const counts = { upload: 0, download: 0 };
  await runPipeline({
    transport,
    session: { protocol: 'vless', userID: UUID, user: { trojanSecret: '' } },
    connector: { connect: () => socket },
    meter: { addUpload: (n) => counts.upload += n, addDownload: (n) => counts.download += n },
  });
  assert.deepEqual(socket.writes, [[1, 2]]);
  assert.deepEqual(writes, [[1, 0], [8, 9]]);
  assert.equal(counts.upload, packet.length);
  assert.equal(counts.download, 4);
});

test('pipeline finishes when remote TCP closes before client transport', async () => {
  const packet = Uint8Array.from([1, ...uuidBytes, 0, 1, 0, 80, 2, 7, ...new TextEncoder().encode('example')]);
  let inputController;
  const input = new ReadableStream({
    start(controller) {
      inputController = controller;
      controller.enqueue(packet);
    },
  });
  let transportClosed = false;
  const transport = {
    readable: input,
    write: async () => {},
    close: async () => { transportClosed = true; },
  };
  const socket = fakeSocket([]);

  await runPipeline({
    transport,
    session: { protocol: 'vless', userID: UUID, user: { trojanSecret: '' } },
    connector: { connect: () => socket },
    meter: { addUpload() {}, addDownload() {} },
  });

  assert.equal(transportClosed, true);
  assert.equal(inputController.desiredSize, 0);
});

function fakeSocket(downloads) {
  const writes = [];
  return {
    writes,
    writable: new WritableStream({ write(value) { writes.push([...value]); } }),
    readable: new ReadableStream({ start(controller) { for (const item of downloads) controller.enqueue(item); controller.close(); } }),
    close() {},
  };
}
