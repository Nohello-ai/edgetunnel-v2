function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

/**
 * Build the raw ECH query value. Encoding belongs to the URI builder.
 */
export function buildECHValue(config, nodeHost) {
  if (!config || config.enabled === false || config.enable === false) return null;

  const dns = firstDefined(config, ['dns', 'DNS']);
  if (!dns || !String(dns).trim()) return null;

  const configuredDomain = firstDefined(config, ['domain', 'sni', 'SNI']);
  const domain = String(configuredDomain) === '0' ? nodeHost : configuredDomain;
  if (!domain || !String(domain).trim()) return String(dns).trim();
  return `${String(domain).trim()}+${String(dns).trim()}`;
}

/** Return a copy so ECH remains removable from the rest of node generation. */
export function withECH(node, config = node?.ech) {
  const ech = buildECHValue(config, node?.host);
  if (!ech) return { ...node };
  return {
    ...node,
    query: { ...(node.query || {}), ech },
  };
}
