export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    },
  });
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    return {};
  }

  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function getPathSegments(url, prefix = '/api') {
  const pathname = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : url.pathname;

  return pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}
