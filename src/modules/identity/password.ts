import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../platform/error';

const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, value) => error ? reject(error) : resolve(value));
});
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new AppError(400, 'INVALID_PASSWORD', '密码须为12至256个字符');
  const salt = randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + (await derive(password, salt)).toString('hex');
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 256) return false;
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) return false;
  const [, salt, expected] = hash.split('$');
  return timingSafeEqual(await derive(password, salt), Buffer.from(expected, 'hex'));
}
export const dummyHash = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);
