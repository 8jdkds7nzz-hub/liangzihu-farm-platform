import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { verify, generateSecret, generateURI } from 'otplib';
import { AppError } from '../../platform/error';

function key(value = process.env.IDENTITY_ENCRYPTION_KEY): Buffer {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new AppError(503, 'IDENTITY_NOT_CONFIGURED', '账号安全配置尚未完成');
  return Buffer.from(value, 'hex');
}
export function encryptSecret(secret: string, userId: string, encryptionKey?: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(encryptionKey), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.');
}
export function decryptSecret(encrypted: string, userId: string, encryptionKey?: string): string {
  const [version, iv, tag, data] = encrypted.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted factor');
  const decipher = createDecipheriv('aes-256-gcm', key(encryptionKey), Buffer.from(iv, 'hex'));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}
export function newFactor(username: string) {
  const secret = generateSecret();
  return { secret, uri: factorUri(secret, username) };
}
export const factorUri = (secret: string, username: string) => generateURI({ issuer: '梁子湖智慧农业', label: username, secret });
export async function verifyMfaStep(secret: string, token: string, at: Date, afterTimeStep?: number): Promise<number | null> {
  if (!/^\d{6}$/.test(token)) return null;
  const result = await verify({ secret, token, epoch: Math.floor(at.getTime() / 1000), epochTolerance: 30, afterTimeStep });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}
// Stateless helper; authentication must use the transactional replay-protected flow.
export async function verifyMfa(secret: string, token: string): Promise<boolean> {
  return (await verifyMfaStep(secret, token, new Date())) !== null;
}
