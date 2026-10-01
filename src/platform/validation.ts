import { AppError } from './error';
export function invalid(message: string): never { throw new AppError(400, 'INVALID_INPUT', message); }
export function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(name + '不能为空或过长');
  return value.trim();
}
export function optionalText(value: unknown, name: string, max = 200): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, name, max);
}
export function choice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid(name + '无效');
  return value as T;
}
export function integer(value: unknown, name: string, min = 1, max = 2_147_483_647): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(name + '超出允许范围');
  return value;
}
export function time(value: unknown, name = '时间'): string {
  if (typeof value !== 'string' || !/T.*(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(name + '须为带时区的ISO时间');
  return new Date(value).toISOString();
}
export function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(name + '须为有效数值');
  return value;
}
export function pagination(url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? 50), offset = Number(url.searchParams.get('offset') ?? 0);
  integer(limit, '每页条数', 1, 200); integer(offset, '分页起点', 0, 1_000_000);
  return { limit, offset };
}
