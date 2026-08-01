export function createAuthIdentity(user) {
  return Object.freeze({
    userID: user.userID,
    username: user.username,
    role: user.role,
  });
}

export function createDataFlowSession({ user, protocol, transport, usage, quotaBytes, budget = 0, resetVersion = 0 }) {
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
    budget: Number(budget || 0),
    resetVersion: Number(resetVersion || 0),
  });
}

export function createProxyRequest(input) {
  return Object.freeze({
    hostname: input.hostname,
    port: input.port,
    isUDP: Boolean(input.isUDP),
    payload: new Uint8Array(input.payload || []),
    responseHeader: new Uint8Array(input.responseHeader || []),
  });
}
