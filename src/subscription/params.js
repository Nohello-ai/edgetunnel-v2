const TLS_FRAGMENT_PRESETS = Object.freeze({
  shadowrocket: '1,40-60,30-50,tlshello',
  happ: '3,1,tlshello',
});

function asBoolean(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function normalizePath(path) {
  const value = String(path || '/').trim() || '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function toQueryEntries(query) {
  if (!query) return [];
  if (query instanceof URLSearchParams) return [...query.entries()];
  if (typeof query === 'string') {
    return [...new URLSearchParams(query.replace(/^[?&]+/, '')).entries()];
  }
  if (typeof query === 'object' && !Array.isArray(query)) {
    return Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
  }
  throw new TypeError('customQuery must be a string, object, or URLSearchParams');
}

/**
 * Normalize optional node parameters without reading configuration or state.
 * The injected randomPath function receives the normalized base path.
 */
export function normalizeNodeParams(input = {}, options = {}) {
  const randomPath = options.randomPath || input.randomPathFn;
  let path = normalizePath(input.path);

  if (asBoolean(input.randomPath ?? input['随机路径']) && typeof randomPath === 'function') {
    path = normalizePath(randomPath(path));
  }

  const pathUrl = new URL(path, 'https://node.invalid');
  const pathQuery = new URLSearchParams(pathUrl.search);
  if (asBoolean(input.zeroRTT ?? input.enable0RTT ?? input['启用0RTT'])) {
    pathQuery.set('ed', String(input.earlyData ?? 2560));
  }

  const fragmentInput = input.fragment ?? input.tlsFragment ?? input['TLS分片'];
  const preset = TLS_FRAGMENT_PRESETS[String(fragmentInput || '').toLowerCase()];
  const fragment = preset || (fragmentInput && !/^(false|none|off)$/i.test(String(fragmentInput))
    ? String(fragmentInput)
    : null);

  const query = new URLSearchParams();
  const fingerprint = input.fingerprint ?? input.Fingerprint ?? input.fp;
  if (fingerprint) query.set('fp', String(fingerprint));
  if (fragment) query.set('fragment', fragment);

  const customQuery = input.customQuery ?? input.query;
  for (const [key, value] of toQueryEntries(customQuery)) {
    query.set(String(key), String(value));
  }

  const pathSearch = pathQuery.toString();
  let pathname = pathUrl.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep malformed escape sequences stable; the URI builder will encode them.
  }
  return Object.freeze({
    path: `${pathname}${pathSearch ? `?${pathSearch}` : ''}`,
    query,
  });
}

export { TLS_FRAGMENT_PRESETS };
