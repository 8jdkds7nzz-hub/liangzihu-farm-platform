import { AppError } from '../../platform/error';
import type { NotificationProvider } from './types';
export function wecomProvider(): NotificationProvider { throw new AppError(503, 'WECOM_NOT_READY', 'G03企业微信发送与回执契约未联调，真实发送关闭'); }
