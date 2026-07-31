import { handleApiRoute } from './handler.js';
import { generateUserID, normalizeUsername } from '../utils/crypto.js';
import { getPathSegments, jsonResponse } from '../utils/http.js';

export async function handleApiRequest(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const credentials = readCredentials(request, url);

    if (!credentials.username) {
      return jsonResponse({
        ok: false,
        error: 'MISSING_USERNAME',
        message: 'username is required',
      }, 401);
    }

    const userID = await generateUserID(credentials.username, env.ID);
    const auth = {
      username: credentials.username,
      password: credentials.password,
      userID,
      isAdmin: isAdminRequest(credentials, userID, env),
    };

    return await handleApiRoute({
      request,
      env,
      ctx,
      url,
      segments: getPathSegments(url),
      auth,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error.code || 'INTERNAL_ERROR',
      message: error.message || 'internal error',
    }, error.status || 500);
  }
}

function isAdminRequest(credentials, userID, env) {
  if (userID === env.ID) return true;

  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return false;

  return credentials.username === normalizeUsername(env.ADMIN_USERNAME)
    && credentials.password === env.ADMIN_PASSWORD;
}

function readCredentials(request, url) {
  const basic = readBasicAuth(request.headers.get('authorization'));

  return {
    username: normalizeUsername(url.searchParams.get('username') || basic.username),
    password: url.searchParams.get('password') || basic.password || '',
  };
}

function readBasicAuth(header) {
  if (!header?.startsWith('Basic ')) {
    return { username: '', password: '' };
  }

  try {
    const decoded = atob(header.slice(6));
    const splitIndex = decoded.indexOf(':');

    if (splitIndex === -1) {
      return { username: decoded, password: '' };
    }

    return {
      username: decoded.slice(0, splitIndex),
      password: decoded.slice(splitIndex + 1),
    };
  } catch {
    return { username: '', password: '' };
  }
}
