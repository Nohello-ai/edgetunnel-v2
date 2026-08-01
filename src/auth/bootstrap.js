import { createUserService } from '../users/service.js';

export async function bootstrapAdmin(env, repository) {
  const adminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first();
  if (Number(adminCount?.count || 0) !== 0) return false;
  if (!env.BOOTSTRAP_ADMIN_USER || !env.BOOTSTRAP_ADMIN_PASSWORD) return false;
  try {
    await createUserService(repository).create({ username: env.BOOTSTRAP_ADMIN_USER, password: env.BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
  } catch (error) {
    if (await repository.count() === 0) throw error;
    return false;
  }
  return true;
}
