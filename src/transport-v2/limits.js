export const DEFAULT_TRANSPORT_LIMITS = Object.freeze({
  maxFrameBytes: 256 * 1024,
  maxFirstPacketBytes: 16 * 1024,
  maxQueuedBytes: 512 * 1024,
  maxQueueSize: 256,
  maxConnections: 512,
});