const encoder = new TextEncoder();
const ITERATIONS = 210000;

export async function hashPassword(password, options = {}) {
  validatePassword(password);
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const iterations = options.iterations || ITERATIONS;
  const key = await derive(String(password), salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(key)}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, rawIterations, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'pbkdf2-sha256') return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;
  try {
    const expected = fromBase64(hashText);
    const actual = await derive(String(password), fromBase64(saltText), iterations, expected.byteLength);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10 || value.length > 256) throw new TypeError('PASSWORD_LENGTH_INVALID');
}

async function derive(password, salt, iterations, length = 32) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, length * 8);
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
