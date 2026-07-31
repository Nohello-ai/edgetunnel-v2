import { AppError } from '../core/errors.js';
export function requireUser(user) { if (!user) throw new AppError('AUTH_REQUIRED', 401); if (user.disabled) throw new AppError('USER_DISABLED', 403); return user; }
export function requireAdmin(user) { requireUser(user); if (user.role !== 'admin') throw new AppError('ADMIN_REQUIRED', 403); return user; }
