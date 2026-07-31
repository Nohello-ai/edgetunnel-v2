// edgetunnel-core 3.0.0
// src/config/loader.js
async function getGlobalConfig(env) {
  const row = await env.DB.prepare("SELECT value FROM global_config WHERE key = ?").bind("global").first();
  return parseJson(row?.value, {});
}
async function putGlobalConfig(env, config) {
  await env.DB.prepare(`
    INSERT INTO global_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).bind("global", JSON.stringify(config), (/* @__PURE__ */ new Date()).toISOString()).run();
  return config;
}
function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// src/config/schema.js
var DEFAULT_TRANSPORT = "websocket";
var DEFAULT_PROTOCOL = "vless";
var TRANSPORTS = /* @__PURE__ */ new Set(["websocket", "grpc", "xhttp"]);
var PROTOCOLS = /* @__PURE__ */ new Set(["vless", "trojan"]);
var DEFAULT_ECH_DNS = "https://odvr.nic.cz/doh";
var DEFAULT_ECH_SNI = "cloudflare-ech.com";
function normalizeGlobalConfig(input, fallback = {}) {
  const config = input && typeof input === "object" ? input : {};
  const hosts = normalizeHosts(config.HOSTS ?? fallback.HOSTS ?? [fallback.siteName || "edgetunnel"]);
  const proxyGroup = normalizeProxyGroup(config.\u53CD\u4EE3 ?? fallback.\u53CD\u4EE3);
  const nodeGroup = normalizeNodeGroup(config.\u8282\u70B9\u53C2\u6570 ?? fallback.\u8282\u70B9\u53C2\u6570);
  const protocol = normalizeEnum(config.protocol || config.defaultProtocol, PROTOCOLS, fallback.protocol || fallback.defaultProtocol || DEFAULT_PROTOCOL);
  const transport = normalizeEnum(config.transport || config.defaultTransport, TRANSPORTS, fallback.transport || fallback.defaultTransport || DEFAULT_TRANSPORT);
  return {
    ...fallback,
    siteName: String(config.siteName || fallback.siteName || "edgetunnel"),
    transport,
    transports: normalizeEnums(config.transports ?? fallback.transports ?? [transport], TRANSPORTS, [transport]),
    protocol,
    protocols: normalizeEnums(config.protocols ?? fallback.protocols ?? [protocol], PROTOCOLS, [protocol]),
    HOST: String(config.HOST || fallback.HOST || hosts[0] || "edgetunnel"),
    HOSTS: hosts,
    \u8BA2\u9605\u53C2\u6570: String(config.\u8BA2\u9605\u53C2\u6570 ?? fallback.\u8BA2\u9605\u53C2\u6570 ?? ""),
    \u53CD\u4EE3: proxyGroup,
    \u8282\u70B9\u53C2\u6570: nodeGroup,
    ECH: Boolean(config.ECH ?? fallback.ECH ?? false),
    ECHConfig: normalizeECHConfig(config.ECHConfig, fallback.ECHConfig),
    settings: normalizeObject(config.settings ?? fallback.settings),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function normalizeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}
function normalizeEnums(value, allowed, fallback) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(values.filter((item) => allowed.has(item)))];
  return normalized.length ? normalized : fallback;
}
function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizeHosts(value) {
  const items = Array.isArray(value) ? value : [value];
  const hosts = items.flatMap((item) => String(item || "").split(/[\n,，]/g)).map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0]).filter(Boolean);
  return hosts.length ? [...new Set(hosts)] : ["edgetunnel"];
}
function normalizeProxyGroup(value) {
  const config = normalizeObject(value);
  return {
    PROXYIP: String(config.PROXYIP || "auto"),
    SOCKS5: normalizeSocks5Config(config.SOCKS5)
  };
}
function normalizeNodeGroup(value) {
  const config = normalizeObject(value);
  return {
    Fingerprint: normalizeFingerprint(config.Fingerprint),
    \u968F\u673A\u8DEF\u5F84: Boolean(config.\u968F\u673A\u8DEF\u5F84 ?? false),
    \u542F\u75280RTT: Boolean(config.\u542F\u75280RTT ?? false),
    TLS\u5206\u7247: normalizeTlsFragment(config.TLS\u5206\u7247)
  };
}
function normalizeFingerprint(value) {
  const text = String(value || "").trim();
  return text || "chrome";
}
function normalizeTlsFragment(value) {
  const text = String(value || "").trim();
  return text || null;
}
function normalizeSocks5Config(value) {
  const config = normalizeObject(value);
  return {
    \u542F\u7528: config.\u542F\u7528 ?? null,
    \u5168\u5C40: Boolean(config.\u5168\u5C40 ?? false),
    \u8D26\u53F7: String(config.\u8D26\u53F7 || ""),
    \u767D\u540D\u5355: Array.isArray(config.\u767D\u540D\u5355) ? config.\u767D\u540D\u5355.map((item) => String(item || "").trim()).filter(Boolean) : []
  };
}
function normalizeECHConfig(value, fallback = {}) {
  const config = normalizeObject(value);
  const normalizedDNS = normalizeECHDNS(config.dns ?? config.DNS ?? fallback.dns ?? fallback.DNS);
  const normalizedDomain = normalizeECHDomain(config.domain ?? config.sni ?? config.SNI ?? fallback.domain ?? fallback.sni ?? fallback.SNI);
  return {
    dns: normalizedDNS,
    domain: normalizedDomain,
    dnsService: normalizedDNS,
    sni: normalizedDomain,
    DNS: normalizedDNS,
    SNI: normalizedDomain
  };
}
function normalizeECHDNS(value) {
  const text = String(value || "").trim();
  return text || DEFAULT_ECH_DNS;
}
function normalizeECHDomain(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return DEFAULT_ECH_SNI;
  }
  if (text === "0") {
    return "0";
  }
  return text;
}

// src/config/runtime.js
function createRuntimeConfigService(env) {
  return {
    async getRuntime() {
      return normalizeGlobalConfig(await getGlobalConfig(env));
    }
  };
}

// src/usage/repository.js
function createUsageRepository(env) {
  return {
    async get(userID) {
      const row = await env.DB.prepare("SELECT upload, download, total, updated_at FROM usage WHERE user_id = ?").bind(userID).first();
      return row ? {
        upload: Number(row.upload || 0),
        download: Number(row.download || 0),
        total: Number(row.total || 0),
        updatedAt: row.updated_at
      } : { upload: 0, download: 0, total: 0 };
    },
    async increment(userID, upload, download) {
      const up = Number(upload || 0);
      const down = Number(download || 0);
      await env.DB.prepare(`
        INSERT INTO usage (user_id, upload, download, total, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          upload = usage.upload + excluded.upload,
          download = usage.download + excluded.download,
          total = usage.total + excluded.total,
          updated_at = excluded.updated_at
      `).bind(userID, up, down, up + down, (/* @__PURE__ */ new Date()).toISOString()).run();
    }
  };
}

// src/users/repository.js
function createUserRepository(env) {
  return {
    async count() {
      const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
      return Number(row?.count || 0);
    },
    async getByID(userID) {
      return mapUser(await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userID).first());
    },
    async getByUsername(username) {
      return mapUser(await env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(username).first());
    },
    async list() {
      const result = await env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
      return (result.results || []).map(mapUser);
    },
    async countAdmins() {
      const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").first();
      return Number(row?.count || 0);
    },
    async create(user) {
      await env.DB.prepare(`INSERT INTO users (user_id,username,password_hash,role,disabled,quota_bytes,trojan_secret,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(user.userID, user.username, user.passwordHash, user.role, user.disabled ? 1 : 0, user.quotaBytes, user.trojanSecret, JSON.stringify(user.settings || {}), user.createdAt, user.updatedAt).run();
      return user;
    },
    async update(userID, fields) {
      const columns = {
        username: ["username", (value) => value],
        passwordHash: ["password_hash", (value) => value],
        role: ["role", (value) => value],
        disabled: ["disabled", (value) => value ? 1 : 0],
        quotaBytes: ["quota_bytes", (value) => value],
        trojanSecret: ["trojan_secret", (value) => value],
        settings: ["settings", (value) => JSON.stringify(value || {})]
      };
      const selected = Object.entries(fields).filter(([key]) => columns[key]);
      if (selected.length === 0) return this.getByID(userID);
      const assignments = selected.map(([key]) => `${columns[key][0]}=?`);
      const values = selected.map(([key, value]) => columns[key][1](value));
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const result = await env.DB.prepare(`UPDATE users SET ${assignments.join(",")},updated_at=? WHERE user_id=?`).bind(...values, updatedAt, userID).run();
      if (Number(result.meta?.changes || 0) === 0) return null;
      return this.getByID(userID);
    },
    async revokeSessions(userID) {
      await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind((/* @__PURE__ */ new Date()).toISOString(), userID).run();
    },
    async delete(userID) {
      await env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(userID).run();
    }
  };
}
function publicUser(user) {
  if (!user) return null;
  const { passwordHash, subscriptionTokenHash, trojanSecret, ...safe } = user;
  return safe;
}
function mapUser(row) {
  if (!row) return null;
  return {
    userID: row.user_id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    disabled: Boolean(row.disabled),
    quotaBytes: Number(row.quota_bytes || 0),
    trojanSecret: row.trojan_secret,
    subscriptionTokenHash: row.subscription_token_hash,
    settings: parse(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function parse(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

// src/admission/repositories.js
function createAdmissionDependencies(env) {
  return {
    users: createUserRepository(env),
    bans: {
      async getActive(userID) {
        const row = await env.DB.prepare("SELECT * FROM bans WHERE user_id = ?").bind(userID).first();
        if (!row) return null;
        if (!row.until || Number.isNaN(Date.parse(row.until)) || Date.parse(row.until) > Date.now()) return row;
        return null;
      }
    },
    usage: createUsageRepository(env),
    config: createRuntimeConfigService(env)
  };
}

// src/core/errors.js
var AppError = class extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
};
function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", 500, "internal error");
}

// src/core/types.js
function createDataFlowSession({ user, protocol, transport, usage, quotaBytes }) {
  return Object.freeze({
    user: Object.freeze({
      userID: user.userID,
      username: user.username,
      role: user.role,
      settings: user.settings || {},
      trojanSecret: user.trojanSecret || ""
    }),
    userID: user.userID,
    protocol,
    transport,
    usage: Object.freeze(usage || { upload: 0, download: 0, total: 0 }),
    quotaBytes: Number(quotaBytes || 0)
  });
}
function createProxyRequest(input) {
  return Object.freeze({
    hostname: input.hostname,
    port: input.port,
    isUDP: Boolean(input.isUDP),
    payload: input.payload || new Uint8Array(),
    responseHeader: input.responseHeader || new Uint8Array()
  });
}

// src/utils/crypto.js
var UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var textEncoder = new TextEncoder();
var SHA224_K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
function isValidUuidV4(value) {
  return typeof value === "string" && UUID_V4_RE.test(value);
}
function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}
function sha224Text(value) {
  return bytesToHex(sha224Bytes(textEncoder.encode(String(value ?? ""))));
}
function sha224Bytes(input) {
  const bytes = toUint8Array(input);
  const padded = padSha256Block(bytes);
  const words = new Uint32Array(64);
  const hash = new Uint32Array([
    3238371032,
    914150663,
    812702999,
    4144912697,
    4290775857,
    1750603025,
    1694076839,
    3204075428
  ]);
  for (let offset = 0; offset < padded.byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (padded[wordOffset] << 24 | padded[wordOffset + 1] << 16 | padded[wordOffset + 2] << 8 | padded[wordOffset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = words[index - 16] + s0 + words[index - 7] + s1 >>> 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + s1 + ch + SHA224_K[index] + words[index] >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = s0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    hash[0] = hash[0] + a >>> 0;
    hash[1] = hash[1] + b >>> 0;
    hash[2] = hash[2] + c >>> 0;
    hash[3] = hash[3] + d >>> 0;
    hash[4] = hash[4] + e >>> 0;
    hash[5] = hash[5] + f >>> 0;
    hash[6] = hash[6] + g >>> 0;
    hash[7] = hash[7] + h >>> 0;
  }
  const digest2 = new Uint8Array(28);
  for (let wordIndex = 0; wordIndex < 7; wordIndex += 1) {
    const word = hash[wordIndex];
    digest2[wordIndex * 4] = word >>> 24 & 255;
    digest2[wordIndex * 4 + 1] = word >>> 16 & 255;
    digest2[wordIndex * 4 + 2] = word >>> 8 & 255;
    digest2[wordIndex * 4 + 3] = word & 255;
  }
  return digest2;
}
function padSha256Block(bytes) {
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 128;
  const bitLength = BigInt(bytes.byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number(bitLength >> BigInt(index * 8) & 0xffn);
  }
  return padded;
}
function rotateRight(value, bits) {
  return (value >>> bits | value << 32 - bits) >>> 0;
}
function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || 0);
}

// src/admission/service.js
var TRANSPORT_PATHS = Object.freeze({
  ws: "websocket",
  grpc: "grpc",
  xhttp: "xhttp"
});
function parseDataFlowRoute(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const transport = TRANSPORT_PATHS[segments[0]];
  const userID = segments[1] || url.searchParams.get("uid") || "";
  const protocol = segments[2] || url.searchParams.get("protocol") || "";
  if (!transport || !isValidUuidV4(userID) || !["vless", "trojan"].includes(protocol)) return null;
  return { transport, userID, protocol, suffix: segments.slice(3) };
}
function createAdmissionService({ users, bans, usage, config }) {
  return {
    async admit(route) {
      if (!route || !isValidUuidV4(route.userID)) {
        throw new AppError("INVALID_DATA_FLOW_ROUTE", 404);
      }
      const user = await users.getByID(route.userID);
      if (!user) throw new AppError("USER_NOT_FOUND", 404);
      if (user.disabled) throw new AppError("USER_DISABLED", 403);
      const activeBan = await bans.getActive(user.userID);
      if (activeBan) throw new AppError("USER_BANNED", 403);
      const currentUsage = await usage.get(user.userID);
      const runtimeConfig = await config.getRuntime();
      const quotaBytes = resolveQuota(user, runtimeConfig);
      if (quotaBytes > 0 && Number(currentUsage.total || 0) >= quotaBytes) {
        throw new AppError("TRAFFIC_QUOTA_EXHAUSTED", 403);
      }
      const protocol = resolveProtocol(route, runtimeConfig);
      const allowedTransports = resolveTransports(runtimeConfig);
      if (!allowedTransports.includes(route.transport)) {
        throw new AppError("TRANSPORT_DISABLED", 403);
      }
      return createDataFlowSession({
        user,
        protocol,
        transport: route.transport,
        usage: currentUsage,
        quotaBytes
      });
    }
  };
}
function resolveQuota(user, config) {
  const value = user.quotaBytes ?? config.quotaBytes ?? config.settings?.quotaBytes ?? 0;
  const quota = Number(value);
  return Number.isFinite(quota) && quota > 0 ? quota : 0;
}
function resolveProtocol(route, config) {
  const enabled = Array.isArray(config.protocols) ? config.protocols : [config.protocol || "vless"];
  if (!enabled.includes(route.protocol)) {
    throw new AppError("PROTOCOL_DISABLED", 403);
  }
  return route.protocol;
}
function resolveTransports(config) {
  const configured = Array.isArray(config.transports) ? config.transports : [config.transport || "websocket"];
  return configured.filter((value) => ["websocket", "grpc", "xhttp"].includes(value));
}

// src/auth/password.js
var encoder = new TextEncoder();
var ITERATIONS = 21e4;
async function hashPassword(password, options = {}) {
  validatePassword(password);
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const iterations = options.iterations || ITERATIONS;
  const key = await derive(String(password), salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(key)}`;
}
async function verifyPassword(password, encoded) {
  const [algorithm, rawIterations, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "pbkdf2-sha256") return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 1e5) return false;
  try {
    const expected = fromBase64(hashText);
    const actual = await derive(String(password), fromBase64(saltText), iterations, expected.byteLength);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
function validatePassword(password) {
  const value = String(password || "");
  if (value.length < 10 || value.length > 256) throw new TypeError("PASSWORD_LENGTH_INVALID");
}
async function derive(password, salt, iterations, length = 32) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, length * 8);
  return new Uint8Array(bits);
}
function timingSafeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

// src/auth/service.js
var DUMMY_HASH = "pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
function createAuthService(users, sessions, loginAttempts) {
  return {
    async login(username, password, fingerprint) {
      const normalized = String(username || "").trim().toLowerCase();
      if (loginAttempts) await loginAttempts.check(fingerprint);
      const user = await users.getByUsername(normalized);
      const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH) && Boolean(user);
      if (!valid) {
        if (loginAttempts) await loginAttempts.failure(fingerprint);
        throw new AppError("INVALID_CREDENTIALS", 401);
      }
      if (user.disabled) throw new AppError("USER_DISABLED", 403);
      if (loginAttempts) await loginAttempts.success(fingerprint);
      return { user, session: await sessions.create(user.userID) };
    },
    resolve: (request) => sessions.resolve(request),
    logout: (request) => sessions.revoke(request)
  };
}

// src/auth/login-attempts.js
var MAX_FAILURES = 5;
var LOCK_MINUTES = 15;
function createLoginAttemptService(env) {
  return {
    async check(fingerprint) {
      const key = normalizeFingerprint2(fingerprint);
      if (!key) return;
      const row = await env.DB.prepare("SELECT failures, locked_until FROM login_attempts WHERE fingerprint = ?").bind(key).first();
      if (row && row.locked_until && Date.parse(row.locked_until) > Date.now()) {
        throw new AppError("LOGIN_RATE_LIMITED", 429);
      }
      if (row?.locked_until) {
        await env.DB.prepare("DELETE FROM login_attempts WHERE fingerprint = ?").bind(key).run();
      }
    },
    async success(fingerprint) {
      const key = normalizeFingerprint2(fingerprint);
      if (!key) return;
      await env.DB.prepare("DELETE FROM login_attempts WHERE fingerprint = ?").bind(key).run();
    },
    async failure(fingerprint) {
      const key = normalizeFingerprint2(fingerprint);
      if (!key) return;
      const now = /* @__PURE__ */ new Date();
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1e3).toISOString();
      await env.DB.prepare(`
        INSERT INTO login_attempts (fingerprint, failures, locked_until, updated_at)
        VALUES (?, 1, NULL, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          failures = login_attempts.failures + 1,
          locked_until = CASE WHEN login_attempts.failures + 1 >= ? THEN ? ELSE login_attempts.locked_until END,
          updated_at = excluded.updated_at
      `).bind(key, now.toISOString(), MAX_FAILURES, lockedUntil).run();
    }
  };
}
function normalizeFingerprint2(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > 128 ? text.slice(0, 128) : text;
}

// src/auth/guards.js
function requireUser(user) {
  if (!user) throw new AppError("AUTH_REQUIRED", 401);
  if (user.disabled) throw new AppError("USER_DISABLED", 403);
  return user;
}
function requireAdmin(user) {
  requireUser(user);
  if (user.role !== "admin") throw new AppError("ADMIN_REQUIRED", 403);
  return user;
}

// src/subscription/node-builder.js
var TRANSPORTS2 = Object.freeze({
  websocket: Object.freeze({ type: "ws", hostKey: "host", pathKey: "path" }),
  ws: Object.freeze({ type: "ws", hostKey: "host", pathKey: "path" }),
  grpc: Object.freeze({ type: "grpc", hostKey: "authority", pathKey: "serviceName" }),
  xhttp: Object.freeze({ type: "xhttp", hostKey: "host", pathKey: "path" })
});
function required(input, keys, label) {
  for (const key of keys) {
    if (input[key] !== void 0 && input[key] !== null && String(input[key]) !== "") {
      return String(input[key]);
    }
  }
  throw new TypeError(`${label} is required`);
}
function formatAddress(address) {
  const value = String(address).trim();
  if (value.includes(":") && !(value.startsWith("[") && value.endsWith("]"))) return `[${value}]`;
  return value;
}
function addQuery(query, source) {
  if (!source) return;
  const entries = source instanceof URLSearchParams ? source.entries() : typeof source === "string" ? new URLSearchParams(source.replace(/^[?&]+/, "")).entries() : Object.entries(source);
  for (const [key, value] of entries) {
    if (value !== void 0 && value !== null) query.set(String(key), String(value));
  }
}
function buildNodeURI(node) {
  if (!node || typeof node !== "object") throw new TypeError("node input is required");
  const protocol = required(node, ["protocol"], "protocol").toLowerCase();
  if (protocol !== "vless" && protocol !== "trojan") {
    throw new TypeError(`unsupported protocol: ${protocol}`);
  }
  const transportName = required(node, ["transport"], "transport").toLowerCase();
  const transport = TRANSPORTS2[transportName];
  if (!transport) throw new TypeError(`unsupported transport: ${transportName}`);
  const credential = protocol === "vless" ? required(node, ["credential", "uuid", "userID"], "VLESS credential") : required(node, ["credential", "password", "secret"], "Trojan credential");
  const address = formatAddress(required(node, ["address", "server"], "address"));
  const port = Number(required(node, ["port"], "port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("port must be between 1 and 65535");
  const host = required(node, ["host"], "host");
  const sni = String(node.sni ?? host);
  const security = String(node.security ?? "tls");
  const query = new URLSearchParams();
  query.set("security", security);
  query.set("type", transport.type);
  query.set(transport.hostKey, host);
  if (security === "tls" && sni) query.set("sni", sni);
  const path = String(node.path || "/");
  query.set(transport.pathKey, path);
  if (protocol === "vless") query.set("encryption", String(node.encryption ?? "none"));
  if (transport.type === "xhttp" && node.mode) query.set("mode", String(node.mode));
  if (node.fingerprint || node.fp) query.set("fp", String(node.fingerprint ?? node.fp));
  addQuery(query, node.query);
  const name = String(node.name ?? `${protocol}-${transportName}-${host}`);
  return `${protocol}://${encodeURIComponent(credential)}@${address}:${port}?${query.toString()}#${encodeURIComponent(name)}`;
}

// src/subscription/generator.js
function list(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  return value;
}
function namedValue(value, key) {
  return typeof value === "string" ? value : value?.[key] ?? value?.name;
}
function generateNodeInputs({ protocols, transports, hosts, ...defaults }) {
  const nodes = [];
  for (const protocolInput of list(protocols, "protocols")) {
    for (const transportInput of list(transports, "transports")) {
      for (const hostInput of list(hosts, "hosts")) {
        const protocol = namedValue(protocolInput, "protocol");
        const transport = namedValue(transportInput, "transport");
        const host = namedValue(hostInput, "host");
        const protocolFields = typeof protocolInput === "object" ? protocolInput : {};
        const transportFields = typeof transportInput === "object" ? transportInput : {};
        const hostFields = typeof hostInput === "object" ? hostInput : {};
        nodes.push({
          ...defaults,
          ...protocolFields,
          ...transportFields,
          ...hostFields,
          protocol,
          transport,
          host
        });
      }
    }
  }
  return nodes;
}
function generateSubscription(nodes, build = buildNodeURI) {
  if (!Array.isArray(nodes)) throw new TypeError("nodes must be an array");
  return nodes.map((node) => build(node)).join("\n");
}

// src/subscription/params.js
var TLS_FRAGMENT_PRESETS = Object.freeze({
  shadowrocket: "1,40-60,30-50,tlshello",
  happ: "3,1,tlshello"
});
function asBoolean(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}
function normalizePath(path) {
  const value = String(path || "/").trim() || "/";
  return value.startsWith("/") ? value : `/${value}`;
}
function toQueryEntries(query) {
  if (!query) return [];
  if (query instanceof URLSearchParams) return [...query.entries()];
  if (typeof query === "string") {
    return [...new URLSearchParams(query.replace(/^[?&]+/, "")).entries()];
  }
  if (typeof query === "object" && !Array.isArray(query)) {
    return Object.entries(query).filter(([, value]) => value !== void 0 && value !== null);
  }
  throw new TypeError("customQuery must be a string, object, or URLSearchParams");
}
function normalizeNodeParams(input = {}, options = {}) {
  const randomPath = options.randomPath || input.randomPathFn;
  let path = normalizePath(input.path);
  if (asBoolean(input.randomPath ?? input["\u968F\u673A\u8DEF\u5F84"]) && typeof randomPath === "function") {
    path = normalizePath(randomPath(path));
  }
  const pathUrl = new URL(path, "https://node.invalid");
  const pathQuery = new URLSearchParams(pathUrl.search);
  if (asBoolean(input.zeroRTT ?? input.enable0RTT ?? input["\u542F\u75280RTT"])) {
    pathQuery.set("ed", String(input.earlyData ?? 2560));
  }
  const fragmentInput = input.fragment ?? input.tlsFragment ?? input["TLS\u5206\u7247"];
  const preset = TLS_FRAGMENT_PRESETS[String(fragmentInput || "").toLowerCase()];
  const fragment = preset || (fragmentInput && !/^(false|none|off)$/i.test(String(fragmentInput)) ? String(fragmentInput) : null);
  const query = new URLSearchParams();
  const fingerprint = input.fingerprint ?? input.Fingerprint ?? input.fp;
  if (fingerprint) query.set("fp", String(fingerprint));
  if (fragment) query.set("fragment", fragment);
  const customQuery = input.customQuery ?? input.query;
  for (const [key, value] of toQueryEntries(customQuery)) {
    query.set(String(key), String(value));
  }
  const pathSearch = pathQuery.toString();
  let pathname = pathUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
  }
  return Object.freeze({
    path: `${pathname}${pathSearch ? `?${pathSearch}` : ""}`,
    query
  });
}

// src/subscription/ech.js
function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== void 0 && object[key] !== null) return object[key];
  }
  return void 0;
}
function buildECHValue(config, nodeHost) {
  if (!config || config.enabled === false || config.enable === false) return null;
  const dns = firstDefined(config, ["dns", "DNS"]);
  if (!dns || !String(dns).trim()) return null;
  const configuredDomain = firstDefined(config, ["domain", "sni", "SNI"]);
  const domain = String(configuredDomain) === "0" ? nodeHost : configuredDomain;
  if (!domain || !String(domain).trim()) return String(dns).trim();
  return `${String(domain).trim()}+${String(dns).trim()}`;
}
function withECH(node, config = node?.ech) {
  const ech = buildECHValue(config, node?.host);
  if (!ech) return { ...node };
  return {
    ...node,
    query: { ...node.query || {}, ech }
  };
}

// src/users/service.js
function createUserService(repository) {
  return {
    async create(input) {
      const username = normalizeUsername(input.username);
      if (!/^[a-z0-9_.-]{3,64}$/.test(username)) throw new AppError("USERNAME_INVALID", 400);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const user = {
        userID: crypto.randomUUID(),
        username,
        passwordHash: await hashPassword(input.password),
        role: input.role === "admin" ? "admin" : "user",
        disabled: false,
        quotaBytes: validQuota(input.quotaBytes),
        trojanSecret: randomToken(32),
        settings: input.settings || {},
        createdAt: now,
        updatedAt: now
      };
      await repository.create(user);
      return publicUser(user);
    },
    async update(userID, fields, actor) {
      const allowed = {};
      if ("disabled" in fields) allowed.disabled = Boolean(fields.disabled);
      if ("quotaBytes" in fields) allowed.quotaBytes = validQuota(fields.quotaBytes);
      if ("role" in fields) allowed.role = fields.role === "admin" ? "admin" : "user";
      if ("settings" in fields) allowed.settings = fields.settings && typeof fields.settings === "object" ? fields.settings : {};
      if (fields.password) allowed.passwordHash = await hashPassword(fields.password);
      const current = await repository.getByID(userID);
      if (!current) throw new AppError("USER_NOT_FOUND", 404);
      if (actor?.userID === userID && (allowed.role === "user" || allowed.disabled)) throw new AppError("SELF_LOCKOUT", 400);
      if (current.role === "admin" && (allowed.role === "user" || allowed.disabled) && await repository.countAdmins() <= 1) {
        throw new AppError("LAST_ADMIN_REQUIRED", 400);
      }
      const user = await repository.update(userID, allowed);
      if (!user) throw new AppError("USER_NOT_FOUND", 404);
      if ("disabled" in allowed || "role" in allowed || "passwordHash" in allowed) await repository.revokeSessions(userID);
      return publicUser(user);
    },
    async get(userID) {
      return publicUser(await repository.getByID(userID));
    },
    async list() {
      return Promise.all((await repository.list()).map(publicUser));
    },
    async delete(userID, actor) {
      if (actor?.userID === userID) throw new AppError("SELF_DELETE_FORBIDDEN", 400);
      const user = await repository.getByID(userID);
      if (user?.role === "admin" && await repository.countAdmins() <= 1) throw new AppError("LAST_ADMIN_REQUIRED", 400);
      await repository.delete(userID);
    }
  };
}
function validQuota(value) {
  if (value === void 0 || value === null || value === "") return 0;
  const quota = Number(value);
  if (!Number.isSafeInteger(quota) || quota < 0) throw new AppError("QUOTA_INVALID", 400);
  return quota;
}
function randomToken(bytes) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// src/users/governance.js
function createGovernanceService(env) {
  return {
    async ban(userID, input = {}) {
      const reason = String(input.reason || "");
      const until = input.until ? new Date(input.until).toISOString() : null;
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare(`INSERT INTO bans (user_id,reason,until,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,until=excluded.until,created_at=excluded.created_at`).bind(userID, reason, until, createdAt).run();
      return { userID, reason, until, createdAt };
    },
    async unban(userID) {
      await env.DB.prepare("DELETE FROM bans WHERE user_id = ?").bind(userID).run();
    },
    async getBan(userID) {
      return env.DB.prepare("SELECT user_id AS userID,reason,until,created_at AS createdAt FROM bans WHERE user_id = ?").bind(userID).first();
    }
  };
}
function validateBanTarget(user) {
  if (!user) throw new AppError("USER_NOT_FOUND", 404);
  return user;
}

// src/utils/http.js
function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}

// src/api-v2/router.js
function createApiRouter({ users, sessions }) {
  const userService = createUserService(users);
  const governance = createGovernanceService;
  return async function handle(request, env) {
    try {
      const url = new URL(request.url);
      const auth = createAuthService(users, sessions, createLoginAttemptService(env));
      const current = await auth.resolve(request);
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await readBody(request);
        const result = await auth.login(body.username, body.password, loginFingerprint(request, body.username));
        return jsonResponse({ ok: true, user: publicUser(result.user) }, 200, { "set-cookie": result.session.cookie });
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") return jsonResponse({ ok: true }, 200, { "set-cookie": await auth.logout(request) });
      if (url.pathname === "/api/auth/me" && request.method === "GET") return jsonResponse({ ok: true, user: publicUser(requireUser(current)) });
      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        requireAdmin(current);
        return jsonResponse({ ok: true, users: await userService.list() });
      }
      if (url.pathname === "/api/admin/users" && request.method === "POST") {
        requireAdmin(current);
        return jsonResponse({ ok: true, user: await userService.create(await readBody(request)) }, 201);
      }
      const match = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
      if (match && request.method === "PATCH") {
        requireAdmin(current);
        return jsonResponse({ ok: true, user: await userService.update(match[1], await readBody(request), current) });
      }
      if (match && request.method === "DELETE") {
        requireAdmin(current);
        await userService.delete(match[1], current);
        return jsonResponse({ ok: true });
      }
      const banMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/ban$/i);
      if (banMatch && request.method === "POST") {
        requireAdmin(current);
        validateBanTarget(await users.getByID(banMatch[1]));
        return jsonResponse({ ok: true, ban: await governance(env).ban(banMatch[1], await readBody(request)) });
      }
      if (banMatch && request.method === "DELETE") {
        requireAdmin(current);
        await governance(env).unban(banMatch[1]);
        return jsonResponse({ ok: true });
      }
      if (url.pathname === "/api/admin/config" && request.method === "GET") {
        requireAdmin(current);
        return jsonResponse({ ok: true, config: normalizeGlobalConfig(await getGlobalConfig(env)) });
      }
      if (url.pathname === "/api/admin/config" && request.method === "PATCH") {
        requireAdmin(current);
        const config = normalizeGlobalConfig(await readBody(request), await getGlobalConfig(env));
        await putGlobalConfig(env, config);
        return jsonResponse({ ok: true, config });
      }
      if (url.pathname === "/api/users/me/subscription" && request.method === "GET") return textResponse(await buildSubscription(env, requireUser(current), url));
      throw new AppError("NOT_FOUND", 404);
    } catch (error) {
      const appError = asAppError(error);
      return jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status);
    }
  };
}
async function readBody(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError("JSON_REQUIRED", 415);
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", 400);
  }
}
async function buildSubscription(env, user, url) {
  const config = normalizeGlobalConfig(await getGlobalConfig(env));
  const protocols = config.protocols.map((protocol) => protocol === "vless" ? { protocol, uuid: user.userID } : { protocol, password: user.trojanSecret });
  const transports = config.transports.map((transport) => ({
    transport,
    ...transport === "xhttp" ? { mode: "stream-one" } : {}
  }));
  let nodes = generateNodeInputs({ protocols, transports, hosts: config.HOSTS, address: url.hostname, port: 443 });
  nodes = nodes.map((node) => {
    const prefix = node.transport === "websocket" ? "ws" : node.transport;
    const params = normalizeNodeParams({ ...config.\u8282\u70B9\u53C2\u6570, path: `/${prefix}/${user.userID}/${node.protocol}` }, {
      randomPath: (path) => `${path}/${randomPathSegment()}`
    });
    return { ...node, path: params.path, query: params.query };
  });
  if (config.ECH) nodes = nodes.map((node) => withECH(node, { enabled: true, ...config.ECHConfig }));
  return generateSubscription(nodes);
}
function randomPathSegment() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function loginFingerprint(request, username) {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const normalized = String(username || "").trim().toLowerCase();
  return `${address}:${normalized}`;
}

// src/auth/bootstrap.js
async function bootstrapAdmin(env, repository) {
  if (await repository.count() !== 0) return false;
  if (!env.BOOTSTRAP_ADMIN_USER || !env.BOOTSTRAP_ADMIN_PASSWORD) return false;
  try {
    await createUserService(repository).create({ username: env.BOOTSTRAP_ADMIN_USER, password: env.BOOTSTRAP_ADMIN_PASSWORD, role: "admin" });
  } catch (error) {
    if (await repository.count() === 0) throw error;
    return false;
  }
  return true;
}

// src/auth/session.js
var COOKIE = "edt_session";
function createSessionService(env, users, options = {}) {
  const ttlSeconds = Number(options.ttlSeconds || 86400);
  return {
    async create(userID) {
      const token = randomToken2(32);
      const tokenHash = await digest(token);
      const now = /* @__PURE__ */ new Date();
      const expires = new Date(now.getTime() + ttlSeconds * 1e3);
      await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(tokenHash, userID, expires.toISOString(), now.toISOString()).run();
      return { token, cookie: `${COOKIE}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict` };
    },
    async resolve(request) {
      const token = readCookie(request.headers.get("cookie"), COOKIE);
      if (!token) return null;
      const hash = await digest(token);
      const row = await env.DB.prepare("SELECT user_id,expires_at,revoked_at FROM sessions WHERE token_hash = ?").bind(hash).first();
      if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
      const user = await users.getByID(row.user_id);
      if (!user || user.disabled) return null;
      const ban = await env.DB.prepare("SELECT 1 AS ok FROM bans WHERE user_id = ? AND (until IS NULL OR until > ?) LIMIT 1").bind(row.user_id, (/* @__PURE__ */ new Date()).toISOString()).first();
      return ban ? null : user;
    },
    async revoke(request) {
      const token = readCookie(request.headers.get("cookie"), COOKIE);
      if (token) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").bind((/* @__PURE__ */ new Date()).toISOString(), await digest(token)).run();
      return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
    }
  };
}
async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function randomToken2(length) {
  const b = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

// src/connector/direct.js
import { connect } from "cloudflare:sockets";
function createDirectConnector(connectImpl = connect) {
  return {
    connect(target) {
      return connectImpl({ hostname: target.hostname, port: target.port });
    }
  };
}

// src/dns/service.js
async function resolveDnsOverTcp({ payload, connector, hostname = "8.8.4.4", port = 53 }) {
  const query = toBytes(payload);
  if (query.byteLength === 0 || query.byteLength > 65535) {
    throw new AppError("INVALID_DNS_PAYLOAD", 400);
  }
  const socket = connector.connect({ hostname, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const frame = new Uint8Array(query.byteLength + 2);
    frame[0] = query.byteLength >>> 8;
    frame[1] = query.byteLength & 255;
    frame.set(query, 2);
    await writer.write(frame);
    const response = await readDnsFrame(reader);
    if (!response) throw new AppError("DNS_UPSTREAM_CLOSED", 502);
    return response;
  } finally {
    try {
      writer.releaseLock();
    } catch {
    }
    try {
      reader.releaseLock();
    } catch {
    }
    try {
      await socket.close();
    } catch {
    }
  }
}
async function readDnsFrame(reader) {
  let buffer = new Uint8Array();
  let expected = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return null;
    buffer = concat(buffer, toBytes(value));
    if (expected < 0 && buffer.byteLength >= 2) expected = buffer[0] << 8 | buffer[1];
    if (expected >= 0 && buffer.byteLength >= expected + 2) return buffer.slice(2, expected + 2);
  }
}
function concat(a, b) {
  const output = new Uint8Array(a.byteLength + b.byteLength);
  output.set(a);
  output.set(b, a.byteLength);
  return output;
}
function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

// src/protocol-v2/address.js
function parseAddress(bytes, offset) {
  return parseTypedAddress(bytes, offset, { domain: 2, ipv6: 3 });
}
function parseSocksAddress(bytes, offset) {
  return parseTypedAddress(bytes, offset, { domain: 3, ipv6: 4 });
}
function parseTypedAddress(bytes, offset, types) {
  if (offset >= bytes.byteLength) return { needMore: true };
  const type = bytes[offset];
  if (type === 1) {
    if (bytes.byteLength < offset + 5) return { needMore: true };
    return { hostname: [...bytes.slice(offset + 1, offset + 5)].join("."), offset: offset + 5 };
  }
  if (type === types.domain) {
    if (bytes.byteLength < offset + 2) return { needMore: true };
    const length = bytes[offset + 1];
    if (length === 0) return { error: "INVALID_ADDRESS" };
    if (bytes.byteLength < offset + 2 + length) return { needMore: true };
    return { hostname: new TextDecoder().decode(bytes.slice(offset + 2, offset + 2 + length)), offset: offset + 2 + length };
  }
  if (type === types.ipv6) {
    if (bytes.byteLength < offset + 17) return { needMore: true };
    const groups = [];
    for (let index = offset + 1; index < offset + 17; index += 2) {
      groups.push((bytes[index] << 8 | bytes[index + 1]).toString(16));
    }
    return { hostname: groups.join(":"), offset: offset + 17 };
  }
  return { error: "UNSUPPORTED_ADDRESS_TYPE" };
}

// src/protocol-v2/helpers.js
function appendBytes(current, value) {
  const chunk = toBytes2(value);
  const output = new Uint8Array(current.byteLength + chunk.byteLength);
  output.set(current);
  output.set(chunk, current.byteLength);
  return output;
}
function toBytes2(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}
function uuidToBytes(uuid) {
  const hex = String(uuid).replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}
function equalBytes(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

// src/protocol-v2/types.js
var NEED_MORE = Object.freeze({ status: "need-more" });
function ready(request, remainder = new Uint8Array()) {
  return { status: "ready", request, remainder };
}
function protocolError(code) {
  return { status: "error", code };
}

// src/protocol-v2/trojan.js
var encoder2 = new TextEncoder();
function createTrojanParser(credentials, limits = {}) {
  const expected = encoder2.encode(sha224Text(credentials?.secret || credentials?.trojanSecret || ""));
  const maxBytes = Number(limits.maxFirstPacketBytes || 64 * 1024);
  let buffer = new Uint8Array();
  let finished = false;
  return {
    push(chunk) {
      if (finished) return protocolError("PARSER_FINISHED");
      buffer = appendBytes(buffer, chunk);
      if (buffer.byteLength > maxBytes) return protocolError("FIRST_PACKET_TOO_LARGE");
      if (buffer.byteLength < 59) return NEED_MORE;
      if (!equalBytes(buffer.slice(0, 56), expected)) return protocolError("INVALID_CREDENTIALS");
      if (buffer[56] !== 13 || buffer[57] !== 10) return protocolError("INVALID_TROJAN_HEADER");
      const command = buffer[58];
      if (command !== 1 && command !== 3) return protocolError("UNSUPPORTED_COMMAND");
      const address = parseSocksAddress(buffer, 59);
      if (address.needMore) return NEED_MORE;
      if (address.error) return protocolError(address.error);
      if (buffer.byteLength < address.offset + 4) return NEED_MORE;
      const port = buffer[address.offset] << 8 | buffer[address.offset + 1];
      if (port === 0) return protocolError("INVALID_PORT");
      if (buffer[address.offset + 2] !== 13 || buffer[address.offset + 3] !== 10) {
        return protocolError("INVALID_TROJAN_HEADER");
      }
      finished = true;
      const payload = buffer.slice(address.offset + 4);
      return ready(createProxyRequest({
        hostname: address.hostname,
        port,
        isUDP: command === 3,
        payload
      }), payload);
    }
  };
}

// src/protocol-v2/vless.js
function createVlessParser(credentials, limits = {}) {
  const expectedUser = uuidToBytes(credentials?.userID || credentials?.uuid);
  const maxBytes = Number(limits.maxFirstPacketBytes || 64 * 1024);
  let buffer = new Uint8Array();
  let finished = false;
  return {
    push(chunk) {
      if (finished) return protocolError("PARSER_FINISHED");
      buffer = appendBytes(buffer, chunk);
      if (buffer.byteLength > maxBytes) return protocolError("FIRST_PACKET_TOO_LARGE");
      if (buffer.byteLength < 18) return NEED_MORE;
      if (!expectedUser || !equalBytes(buffer.slice(1, 17), expectedUser)) return protocolError("INVALID_CREDENTIALS");
      const version = buffer[0];
      const commandOffset = 18 + buffer[17];
      if (buffer.byteLength < commandOffset + 4) return NEED_MORE;
      const command = buffer[commandOffset];
      if (command !== 1 && command !== 2) return protocolError("UNSUPPORTED_COMMAND");
      const port = buffer[commandOffset + 1] << 8 | buffer[commandOffset + 2];
      if (port === 0) return protocolError("INVALID_PORT");
      const address = parseAddress(buffer, commandOffset + 3);
      if (address.needMore) return NEED_MORE;
      if (address.error) return protocolError(address.error);
      finished = true;
      const payload = buffer.slice(address.offset);
      return ready(createProxyRequest({
        hostname: address.hostname,
        port,
        isUDP: command === 2,
        payload,
        responseHeader: Uint8Array.of(version, 0)
      }), payload);
    }
  };
}

// src/protocol-v2/registry.js
var FACTORIES = Object.freeze({ vless: createVlessParser, trojan: createTrojanParser });
function createProtocolParser(protocol, credentials, limits) {
  const factory = FACTORIES[protocol];
  if (!factory) throw new TypeError(`unsupported protocol: ${protocol}`);
  return factory(credentials, limits);
}

// src/protocol-v2/datagram.js
function createDatagramCodec(protocol, defaults = {}) {
  if (protocol === "vless") return createVlessDatagramCodec(defaults);
  if (protocol === "trojan") return createTrojanDatagramCodec();
  throw new TypeError(`unsupported datagram protocol: ${protocol}`);
}
function createVlessDatagramCodec(defaults) {
  let buffer = new Uint8Array();
  return {
    push(chunk) {
      buffer = appendBytes(buffer, chunk);
      const datagrams = [];
      while (buffer.byteLength >= 2) {
        const length = buffer[0] << 8 | buffer[1];
        if (length === 0) throw new Error("INVALID_UDP_DATAGRAM");
        if (buffer.byteLength < length + 2) break;
        datagrams.push({ hostname: defaults.hostname, port: defaults.port, payload: buffer.slice(2, length + 2) });
        buffer = buffer.slice(length + 2);
      }
      return datagrams;
    },
    encode(datagram) {
      const payload = toBytes3(datagram.payload);
      const output = new Uint8Array(payload.byteLength + 2);
      output[0] = payload.byteLength >>> 8;
      output[1] = payload.byteLength & 255;
      output.set(payload, 2);
      return output;
    },
    finish() {
      if (buffer.byteLength) throw new Error("INCOMPLETE_UDP_DATAGRAM");
    }
  };
}
function createTrojanDatagramCodec() {
  let buffer = new Uint8Array();
  return {
    push(chunk) {
      buffer = appendBytes(buffer, chunk);
      const datagrams = [];
      while (buffer.byteLength) {
        const address = parseSocksAddress(buffer, 0);
        if (address.needMore) break;
        if (address.error) throw new Error(address.error);
        if (buffer.byteLength < address.offset + 6) break;
        const port = buffer[address.offset] << 8 | buffer[address.offset + 1];
        const length = buffer[address.offset + 2] << 8 | buffer[address.offset + 3];
        if (port === 0 || length === 0 || buffer[address.offset + 4] !== 13 || buffer[address.offset + 5] !== 10) {
          throw new Error("INVALID_UDP_DATAGRAM");
        }
        const payloadOffset = address.offset + 6;
        if (buffer.byteLength < payloadOffset + length) break;
        datagrams.push({
          hostname: address.hostname,
          port,
          payload: buffer.slice(payloadOffset, payloadOffset + length),
          addressHeader: buffer.slice(0, address.offset + 2)
        });
        buffer = buffer.slice(payloadOffset + length);
      }
      return datagrams;
    },
    encode(datagram) {
      const payload = toBytes3(datagram.payload);
      const header = toBytes3(datagram.addressHeader);
      if (!header.byteLength) throw new Error("UDP_ADDRESS_REQUIRED");
      const output = new Uint8Array(header.byteLength + 4 + payload.byteLength);
      output.set(header);
      output[header.byteLength] = payload.byteLength >>> 8;
      output[header.byteLength + 1] = payload.byteLength & 255;
      output[header.byteLength + 2] = 13;
      output[header.byteLength + 3] = 10;
      output.set(payload, header.byteLength + 4);
      return output;
    },
    finish() {
      if (buffer.byteLength) throw new Error("INCOMPLETE_UDP_DATAGRAM");
    }
  };
}
function toBytes3(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

// src/transport-v2/limits.js
var DEFAULT_TRANSPORT_LIMITS = Object.freeze({
  maxFrameBytes: 1024 * 1024,
  maxFirstPacketBytes: 64 * 1024,
  maxQueuedBytes: 4 * 1024 * 1024
});

// src/transport-v2/grpc-frame.js
function createGrpcFrameParser(limits = {}) {
  const maxFrameBytes = Number(limits.maxFrameBytes || DEFAULT_TRANSPORT_LIMITS.maxFrameBytes);
  let buffer = new Uint8Array();
  return {
    push(value) {
      buffer = concat2(buffer, toBytes4(value));
      const messages = [];
      let offset = 0;
      while (buffer.byteLength - offset >= 5) {
        if (buffer[offset] !== 0) throw new Error("GRPC_COMPRESSION_UNSUPPORTED");
        const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0);
        if (length > maxFrameBytes) throw new Error("GRPC_FRAME_TOO_LARGE");
        if (buffer.byteLength - offset - 5 < length) break;
        messages.push(buffer.slice(offset + 5, offset + 5 + length));
        offset += 5 + length;
      }
      buffer = buffer.slice(offset);
      return { messages, remainder: buffer };
    }
  };
}
function encodeGrpcFrame(value) {
  const payload = toBytes4(value);
  const output = new Uint8Array(payload.byteLength + 5);
  new DataView(output.buffer).setUint32(1, payload.byteLength);
  output.set(payload, 5);
  return output;
}
function decodeGrpcHunk(value) {
  const message = toBytes4(value);
  if (message[0] !== 10) throw new Error("GRPC_HUNK_INVALID");
  const length = readVarint(message, 1);
  if (!length || length.value > message.byteLength - length.offset) throw new Error("GRPC_HUNK_INVALID");
  if (length.offset + length.value !== message.byteLength) throw new Error("GRPC_HUNK_INVALID");
  return message.slice(length.offset, length.offset + length.value);
}
function encodeGrpcHunk(value) {
  const payload = toBytes4(value);
  const length = writeVarint(payload.byteLength);
  const output = new Uint8Array(1 + length.byteLength + payload.byteLength);
  output[0] = 10;
  output.set(length, 1);
  output.set(payload, 1 + length.byteLength);
  return output;
}
function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;
  for (let index = offset; index < bytes.byteLength && index < offset + 5; index += 1) {
    const byte = bytes[index];
    value += (byte & 127) * 2 ** shift;
    if ((byte & 128) === 0) return { value, offset: index + 1 };
    shift += 7;
  }
  return null;
}
function writeVarint(value) {
  const output = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 128;
    output.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(output);
}
function concat2(a, b) {
  const output = new Uint8Array(a.byteLength + b.byteLength);
  output.set(a);
  output.set(b, a.byteLength);
  return output;
}
function toBytes4(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

// src/transport-v2/grpc.js
function openGrpcTransport(request, limits) {
  const type = request.headers.get("content-type")?.toLowerCase() || "";
  if (request.method !== "POST" || !type.startsWith("application/grpc")) {
    throw new AppError("INVALID_GRPC_REQUEST", 400);
  }
  if (!request.body) throw new AppError("GRPC_BODY_REQUIRED", 400);
  const parser = createGrpcFrameParser(limits);
  const source = request.body.getReader();
  const readable = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await source.read();
        if (done) {
          controller.close();
          return;
        }
        const { messages } = parser.push(value);
        if (messages.length === 0) continue;
        for (const message of messages) controller.enqueue(decodeGrpcHunk(message));
        return;
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    }
  });
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable,
    async write(chunk) {
      if (!closed) await writer.write(encodeGrpcFrame(encodeGrpcHunk(chunk)));
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      if (reason) await writer.abort(reason).catch(() => {
      });
      else await writer.close().catch(() => {
      });
    },
    response: new Response(responseStream.readable, {
      headers: { "content-type": "application/grpc", "grpc-encoding": "identity", "cache-control": "no-store" }
    }),
    metadata: Object.freeze({ name: "grpc" })
  };
}

// src/transport-v2/websocket.js
function openWebSocketTransport(request, limits = {}, runtime = globalThis) {
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new AppError("INVALID_WEBSOCKET_REQUEST", 400);
  }
  const Pair = runtime.WebSocketPair;
  if (!Pair) throw new AppError("WEBSOCKET_UNAVAILABLE", 501);
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  server.binaryType = "arraybuffer";
  server.accept();
  const maxFrameBytes = Number(limits?.maxFrameBytes || DEFAULT_TRANSPORT_LIMITS.maxFrameBytes);
  const maxQueuedBytes = Number(limits?.maxQueuedBytes || DEFAULT_TRANSPORT_LIMITS.maxQueuedBytes);
  const queue = [];
  let queuedBytes = 0;
  let controller;
  let closed = false;
  const readable = new ReadableStream({
    start(value) {
      controller = value;
    },
    pull() {
      const chunk = queue.shift();
      if (chunk) {
        queuedBytes -= chunk.byteLength;
        controller.enqueue(chunk);
      }
    },
    cancel() {
      try {
        server.close(1e3, "cancelled");
      } catch {
      }
    }
  });
  server.addEventListener("message", async (event) => {
    if (typeof event.data === "string") {
      controller.error(new AppError("WEBSOCKET_TEXT_UNSUPPORTED", 400));
      try {
        server.close(1003, "binary only");
      } catch {
      }
      return;
    }
    const chunk = event.data instanceof Blob ? new Uint8Array(await event.data.arrayBuffer()) : toBytes5(event.data);
    if (chunk.byteLength > maxFrameBytes || queuedBytes + chunk.byteLength > maxQueuedBytes) {
      closed = true;
      try {
        controller.error(new AppError("WEBSOCKET_BUFFER_LIMIT", 413));
      } catch {
      }
      try {
        server.close(1009, "message too large");
      } catch {
      }
      return;
    }
    if (controller.desiredSize > 0 && queue.length === 0) controller.enqueue(chunk);
    else {
      queue.push(chunk);
      queuedBytes += chunk.byteLength;
    }
  });
  server.addEventListener("close", () => {
    closed = true;
    try {
      controller.close();
    } catch {
    }
  });
  server.addEventListener("error", (event) => {
    closed = true;
    try {
      controller.error(event.error || new Error("websocket error"));
    } catch {
    }
  });
  const earlyData = readEarlyData(request.headers.get("sec-websocket-protocol"));
  if (earlyData.bytes.byteLength) controller.enqueue(earlyData.bytes);
  return {
    readable,
    async write(chunk) {
      if (!closed) server.send(toBytes5(chunk));
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      try {
        server.close(reason ? 1011 : 1e3, reason ? "pipeline error" : "done");
      } catch {
      }
    },
    response: new runtime.Response(null, {
      status: 101,
      webSocket: client,
      headers: earlyData.protocol ? { "sec-websocket-protocol": earlyData.protocol } : void 0
    }),
    metadata: Object.freeze({ name: "websocket" })
  };
}
function readEarlyData(header) {
  const protocol = String(header || "").split(",")[0].trim();
  if (!protocol || !/^[A-Za-z0-9_-]+$/.test(protocol)) return { protocol: "", bytes: new Uint8Array() };
  try {
    const normalized = protocol.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(protocol.length / 4) * 4, "=");
    return { protocol, bytes: Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)) };
  } catch {
    return { protocol: "", bytes: new Uint8Array() };
  }
}
function toBytes5(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

// src/transport-v2/xhttp.js
function openXhttpTransport(request) {
  const type = request.headers.get("content-type")?.toLowerCase() || "";
  if (request.method !== "POST" || !type.startsWith("application/x-http") && !type.startsWith("application/octet-stream")) {
    throw new AppError("INVALID_XHTTP_REQUEST", 400);
  }
  if (!request.body) throw new AppError("XHTTP_BODY_REQUIRED", 400);
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  let closed = false;
  return {
    readable: request.body,
    async write(chunk) {
      if (!closed) await writer.write(chunk);
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      if (reason) await writer.abort(reason).catch(() => {
      });
      else await writer.close().catch(() => {
      });
    },
    response: new Response(responseStream.readable, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" }
    }),
    metadata: Object.freeze({ name: "xhttp" })
  };
}

// src/transport-v2/registry.js
var FACTORIES2 = Object.freeze({ websocket: openWebSocketTransport, grpc: openGrpcTransport, xhttp: openXhttpTransport });
function openTransport(name, request, limits, runtime) {
  const factory = FACTORIES2[name];
  if (!factory) throw new TypeError(`unsupported transport: ${name}`);
  return factory(request, limits, runtime);
}

// src/usage/meter.js
function createUsageMeter({ userID, repository, ctx, flushThreshold = 256 * 1024, maxBytes = 0 }) {
  let pendingUpload = 0;
  let pendingDownload = 0;
  let counted = 0;
  let flushing = null;
  let needsReschedule = false;
  const schedule = () => {
    const task = flush();
    if (ctx?.waitUntil) ctx.waitUntil(task);
    return task;
  };
  const flush = async () => {
    if (flushing) return flushing;
    needsReschedule = false;
    flushing = (async () => {
      while (pendingUpload !== 0 || pendingDownload !== 0) {
        const upload = pendingUpload;
        const download = pendingDownload;
        pendingUpload = 0;
        pendingDownload = 0;
        try {
          await repository.increment(userID, upload, download);
        } catch {
          pendingUpload += upload;
          pendingDownload += download;
          break;
        }
      }
    })().finally(() => {
      flushing = null;
      if ((pendingUpload !== 0 || pendingDownload !== 0) && !needsReschedule) {
        needsReschedule = true;
        if (ctx?.waitUntil) ctx.waitUntil(flush());
      }
    });
    return flushing;
  };
  const add = (direction, bytes) => {
    const value = validBytes(bytes);
    if (maxBytes > 0 && counted + value > maxBytes) throw new UsageLimitError();
    counted += value;
    if (direction === "upload") pendingUpload += value;
    else pendingDownload += value;
    if (pendingUpload + pendingDownload >= flushThreshold) schedule();
  };
  return {
    addUpload(bytes) {
      add("upload", bytes);
    },
    addDownload(bytes) {
      add("download", bytes);
    },
    flush
  };
}
var UsageLimitError = class extends Error {
  constructor() {
    super("TRAFFIC_QUOTA_EXHAUSTED");
    this.code = "TRAFFIC_QUOTA_EXHAUSTED";
  }
};
function validBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

// src/proxy/pipeline.js
function startDataFlowPipeline({ request, session, connector, usageRepository, ctx, runtime }) {
  const transport = openTransport(session.transport, request, void 0, runtime);
  const remaining = session.quotaBytes > 0 ? Math.max(0, session.quotaBytes - Number(session.usage.total || 0)) : 0;
  const meter = createUsageMeter({ userID: session.userID, repository: usageRepository, ctx, maxBytes: remaining });
  const task = runPipeline({ transport, session, connector, meter }).catch(async (error) => {
    await transport.close(error);
  }).finally(() => meter.flush());
  ctx?.waitUntil?.(task);
  return transport.response;
}
async function runPipeline({ transport, session, connector, meter }) {
  const parser = createProtocolParser(session.protocol, {
    userID: session.userID,
    secret: session.user.trojanSecret
  });
  const reader = transport.readable.getReader();
  let parsed;
  try {
    while (!parsed) {
      const { done, value } = await reader.read();
      if (done) throw new AppError("INCOMPLETE_PROTOCOL_HEADER", 400);
      meter.addUpload(value.byteLength);
      const result = parser.push(value);
      if (result.status === "error") throw new AppError(result.code, 400);
      if (result.status === "ready") parsed = result.request;
    }
    if (parsed.isUDP) return forwardDnsDatagrams({ reader, transport, connector, request: parsed, protocol: session.protocol, meter });
    await forwardTcp({ reader, transport, connector, request: parsed, meter });
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
async function forwardDnsDatagrams({ reader, transport, connector, request, protocol, meter }) {
  const codec = createDatagramCodec(protocol, request);
  let responseHeaderPending = request.responseHeader;
  let chunk = request.payload;
  while (true) {
    for (const datagram of codec.push(chunk)) {
      if (datagram.port !== 53) throw new AppError("UDP_UNSUPPORTED", 400);
      const payload = await resolveDnsOverTcp({ payload: datagram.payload, connector, hostname: datagram.hostname, port: 53 });
      const response = codec.encode({ ...datagram, payload });
      if (responseHeaderPending.byteLength) {
        await transport.write(responseHeaderPending);
        meter.addDownload(responseHeaderPending.byteLength);
        responseHeaderPending = new Uint8Array();
      }
      meter.addDownload(response.byteLength);
      await transport.write(response);
    }
    const next = await reader.read();
    if (next.done) break;
    chunk = next.value;
    meter.addUpload(chunk.byteLength);
  }
  codec.finish();
  await transport.close();
}
async function forwardTcp({ reader, transport, connector, request, meter }) {
  const socket = connector.connect({ hostname: request.hostname, port: request.port });
  if (socket.opened) await socket.opened;
  const remoteWriter = socket.writable.getWriter();
  const remoteReader = socket.readable.getReader();
  const upload = (async () => {
    try {
      if (request.payload.byteLength) await remoteWriter.write(request.payload);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        meter.addUpload(value.byteLength);
        await remoteWriter.write(value);
      }
      await remoteWriter.close();
    } catch (error) {
      await remoteReader.cancel(error).catch(() => {
      });
      throw error;
    }
  })();
  const download = (async () => {
    try {
      if (request.responseHeader.byteLength) {
        await transport.write(request.responseHeader);
        meter.addDownload(request.responseHeader.byteLength);
      }
      while (true) {
        const { done, value } = await remoteReader.read();
        if (done) break;
        meter.addDownload(value.byteLength);
        await transport.write(value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {
      });
      throw error;
    } finally {
      await reader.cancel("remote closed").catch(() => {
      });
    }
  })();
  try {
    const results = await Promise.allSettled([upload, download]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    await transport.close();
  } finally {
    try {
      remoteWriter.releaseLock();
    } catch {
    }
    try {
      remoteReader.releaseLock();
    } catch {
    }
    try {
      await socket.close();
    } catch {
    }
  }
}

// src/routes/router.js
var CONTROL_PATHS = ["/login", "/logout", "/admin", "/sub"];
function classifyRequest(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || CONTROL_PATHS.includes(url.pathname)) {
    return { kind: "api", url };
  }
  const dataFlow = parseDataFlowRoute(url);
  if (dataFlow && matchesTransport(request, dataFlow.transport)) {
    return { kind: "data-flow", url, dataFlow };
  }
  if (url.pathname === "/version" && request.method === "GET") {
    return { kind: "version", url };
  }
  return { kind: "status", url };
}
function matchesTransport(request, transport) {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  const upgrade = request.headers.get("upgrade")?.toLowerCase() || "";
  if (transport === "websocket") return request.method === "GET" && upgrade === "websocket";
  if (transport === "grpc") return request.method === "POST" && contentType.startsWith("application/grpc");
  if (transport === "xhttp") {
    return request.method === "POST" && (contentType.startsWith("application/x-http") || contentType.startsWith("application/octet-stream"));
  }
  return false;
}

// src/index.js
var VERSION = true ? "3.0.0" : "3.0.0";
var index_default = {
  async fetch(request, env, ctx) {
    if (!env?.DB) return jsonResponse({ ok: false, error: "DB_BINDING_REQUIRED" }, 500);
    try {
      const users = createUserRepository(env);
      await bootstrapAdmin(env, users);
      const route = classifyRequest(request);
      if (route.kind === "api") {
        const sessions = createSessionService(env, users);
        return createApiRouter({ users, sessions })(request, env);
      }
      if (route.kind === "data-flow") {
        const dependencies = createAdmissionDependencies(env);
        const session = await createAdmissionService(dependencies).admit(route.dataFlow);
        return startDataFlowPipeline({
          request,
          session,
          connector: createDirectConnector(request.fetcher?.connect?.bind(request.fetcher)),
          usageRepository: createUsageRepository(env),
          ctx
        });
      }
      if (route.kind === "version") {
        return jsonResponse({ name: "edgetunnel-core", version: VERSION });
      }
      return textResponse(`edgetunnel core ${VERSION} is running`);
    } catch (error) {
      const appError = asAppError(error);
      return jsonResponse({ ok: false, error: appError.code, message: appError.message }, appError.status);
    }
  }
};
export {
  index_default as default
};
