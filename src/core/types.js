export function createAuthIdentity(user) {
  return Object.freeze({
    userID: user.userID,
    username: user.username,
    role: user.role,
  });
}

export function createDataFlowSession({ user, protocol, transport, usage, quotaBytes }) {
  return Object.freeze({
    user: Object.freeze({
      userID: user.userID,
      username: user.username,
      role: user.role,
      settings: user.settings || {},
      trojanSecret: user.trojanSecret || '',
    }),
    userID: user.userID,
    protocol,
    transport,
    usage: Object.freeze(usage || { upload: 0, download: 0, total: 0 }),
    quotaBytes: Number(quotaBytes || 0),
  });
}

export function createProxyRequest(input) {
  return Object.freeze({
    hostname: input.hostname,
    port: input.port,
    isUDP: Boolean(input.isUDP),
    payload: input.payload || new Uint8Array(),
    responseHeader: input.responseHeader || new Uint8Array(),
  });
}
