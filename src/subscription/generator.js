import { buildNodeURI } from './node-builder.js';

function list(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  return value;
}

function namedValue(value, key) {
  return typeof value === 'string' ? value : value?.[key] ?? value?.name;
}

/**
 * Expand protocols x transports x hosts into NodeInput objects.
 * All source data is supplied by the caller; this function performs no I/O.
 */
export function generateNodeInputs({ protocols, transports, hosts, ...defaults }) {
  const nodes = [];
  for (const protocolInput of list(protocols, 'protocols')) {
    for (const transportInput of list(transports, 'transports')) {
      for (const hostInput of list(hosts, 'hosts')) {
        const protocol = namedValue(protocolInput, 'protocol');
        const transport = namedValue(transportInput, 'transport');
        const host = namedValue(hostInput, 'host');
        const protocolFields = typeof protocolInput === 'object' ? protocolInput : {};
        const transportFields = typeof transportInput === 'object' ? transportInput : {};
        const hostFields = typeof hostInput === 'object' ? hostInput : {};
        nodes.push({
          ...defaults,
          ...protocolFields,
          ...transportFields,
          ...hostFields,
          protocol,
          transport,
          host,
        });
      }
    }
  }
  return nodes;
}

/** Map prepared NodeInput[] to newline-delimited raw URIs. */
export function generateSubscription(nodes, build = buildNodeURI) {
  if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array');
  return nodes.map((node) => build(node)).join('\n');
}

export const generateRawSubscription = generateSubscription;
