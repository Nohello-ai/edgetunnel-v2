import { AppError } from '../core/errors.js';
import { verifyPassword } from './password.js';

const DUMMY_HASH = 'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function createAuthService(users, sessions, loginAttempts) {
  return {
    async login(username, password, fingerprint) {
      const normalized = String(username || '').trim().toLowerCase();
      if (loginAttempts) await loginAttempts.check(fingerprint);
      const user = await users.getByUsername(normalized);
      const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH) && Boolean(user);
      if (!valid) {
        if (loginAttempts) await loginAttempts.failure(fingerprint);
        throw new AppError('INVALID_CREDENTIALS', 401);
      }
      if (user.disabled) throw new AppError('USER_DISABLED', 403);
      if (loginAttempts) await loginAttempts.success(fingerprint);
      return { user, session: await sessions.create(user.userID) };
    },
    resolve: (request) => sessions.resolve(request),
    logout: (request) => sessions.revoke(request),
  };
}
