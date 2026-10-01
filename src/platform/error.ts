import type { ApiError } from './types';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function toApiError(error: unknown, requestId: string): { status: number; body: ApiError } {
  if (error instanceof AppError) {
    return { status: error.status, body: { code: error.code, message: error.message, requestId } };
  }
  return { status: 500, body: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试', requestId } };
}
