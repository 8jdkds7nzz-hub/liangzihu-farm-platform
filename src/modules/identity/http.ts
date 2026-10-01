import { randomUUID } from 'node:crypto';
import { AppError, toApiError } from '../../platform/error';
import { CHALLENGE_COOKIE, SESSION_COOKIE, CHALLENGE_SECONDS, SESSION_SECONDS, type AuthResult } from './session';

export function appOrigin(value = process.env.APP_ORIGIN): string {
  if (!value) throw new AppError(503, 'ORIGIN_NOT_CONFIGURED', '登录地址尚未配置');
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) {
    throw new AppError(503, 'ORIGIN_NOT_CONFIGURED', '登录地址配置无效');
  }
  return url.origin;
}
export function assertOrigin(request: Request, configured?: string) {
  if (request.headers.get('origin') !== appOrigin(configured)) throw new AppError(403, 'INVALID_ORIGIN', '请求来源不匹配，请从平台页面重试');
}
export async function readJson(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'JSON_REQUIRED', '请使用JSON请求');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'INVALID_JSON', '请求内容不完整');
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel(); throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长，请缩小本次提交范围'); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_JSON', '请求内容格式不正确');
  } finally { reader.releaseLock(); }
}
export function textField(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== 'string') throw new AppError(400, 'INVALID_FIELD', '请填写完整信息');
  return body[name] as string;
}
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'Referrer-Policy': 'no-referrer' } });
}
export async function endpoint(work: () => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  try { const response = await work(); response.headers.set('X-Request-Id', requestId); return response; }
  catch (error) {
    const { status, body } = toApiError(error, requestId);
    const response = json(body, status);
    response.headers.set('X-Request-Id', requestId);
    if (status === 429) response.headers.set('Retry-After', '900');
    return response;
  }
}
export function setCookie(response: Response, name: string, token: string, maxAge: number) {
  const secure = new URL(appOrigin()).protocol === 'https:' ? '; Secure' : '';
  response.headers.append('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
export function authResponse(result: AuthResult): Response {
  const response = json(result.kind === 'mfa' ? { next: 'mfa', enrollment: result.enrollment } : { next: 'account', actor: result.actor, recoveryCodes: result.recoveryCodes });
  if (result.kind === 'mfa') {
    setCookie(response, SESSION_COOKIE, '', 0);
    setCookie(response, CHALLENGE_COOKIE, result.token, CHALLENGE_SECONDS);
  } else {
    setCookie(response, CHALLENGE_COOKIE, '', 0);
    setCookie(response, SESSION_COOKIE, result.token, SESSION_SECONDS);
  }
  return response;
}
