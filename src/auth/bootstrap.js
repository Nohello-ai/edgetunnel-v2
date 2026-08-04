import { createUserService } from '../users/service.js';

export async function bootstrapAdmin(env, repository) {
  const adminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first();
  if (Number(adminCount?.count || 0) !== 0) return false;
  const admin = env.ADMIN;
  const key = env.KEY;
  if (!admin || !key) return false;
  try {
    const userID = await deriveUUID(admin, key);
    await createUserService(repository, env).create({ userID, username: 'admin', password: admin, role: 'admin' });
  } catch (error) {
    if (await repository.count() === 0) throw error;
    return false;
  }
  return true;
}

async function deriveUUID(admin, key) {
  const input = `${admin}:${key}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
