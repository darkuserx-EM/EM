import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
/** @param {string} value */
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
/** @param {unknown} a @param {unknown} b */
export function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b))); }
/** @param {unknown} password */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 128) throw new Error('Usa una contraseña de entre 14 y 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
/** @param {unknown} password @param {unknown} encoded */
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [method, salt, hash] = String(encoded).split(':');
  if (method !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(await derive(password, salt, 64), Buffer.from(hash, 'hex'));
}
/** @param {unknown} header @param {string} name */
export function cookieToken(header, name) {
  return String(header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
