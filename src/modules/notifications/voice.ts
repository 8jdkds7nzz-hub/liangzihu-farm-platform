import { AppError } from '../../platform/error';
import type { NotificationProvider } from './types';
export function voiceProvider(): NotificationProvider { throw new AppError(503, 'VOICE_NOT_READY', 'G04语音模板、测试对象、回执与查询契约未联调，真实拨号关闭'); }
