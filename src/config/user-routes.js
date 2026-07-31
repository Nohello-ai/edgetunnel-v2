const routes = new Map();

export function registerUserRoute(userID, handler) {
  if (!userID || typeof handler !== 'function') {
    return false;
  }

  routes.set(userID, handler);
  return true;
}

export function unregisterUserRoute(userID) {
  return routes.delete(userID);
}

export function getUserRoute(userID) {
  return routes.get(userID) || null;
}

export function hasUserRoute(userID) {
  return routes.has(userID);
}

export function clearUserRoutes() {
  routes.clear();
}
