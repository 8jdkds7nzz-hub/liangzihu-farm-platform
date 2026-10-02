import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { readDatabaseConfig } from '../src/platform/config';
import { transaction } from '../src/db/pool';
import { runNotificationCycle } from '../src/modules/notifications/runner';
import { heartbeat } from '../src/modules/operations/heartbeat';
import {wecomProvider} from '../src/modules/notifications/wecom';
import {voiceProvider} from '../src/modules/notifications/voice';
import type {NotificationProvider} from '../src/modules/notifications/types';
const pool = new pg.Pool(readDatabaseConfig({ ...process.env, DB_POOL_MAX: process.env.NOTIFICATIONS_DB_POOL_MAX ?? '2' }));
let stopped = false;
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => { stopped = true; });
async function main() {
    const providers:Partial<Record<'wecom'|'voice',NotificationProvider>>={};
    if(process.env.NOTICE_EXTERNAL_ENABLED==='1'){if(process.env.WECOM_ENABLED==='1')providers.wecom=wecomProvider(pool);if(process.env.VOICE_ENABLED==='1')providers.voice=voiceProvider(pool);}
    console.log('通知进程启动；仅领取已显式启用且契约核实的通道。');
    do {
        const worked = await runNotificationCycle(pool, 'notifications-' + process.pid,Object.keys(providers).length?providers:undefined);
        await transaction(c => heartbeat(c, 'notifications', 'notifications-' + process.pid,Object.keys(providers).length?'ok':'blocked', new Date(), true,Object.keys(providers).length?null:'LIVE_PROVIDERS_NOT_READY'), pool);
        if (process.argv.includes('--once'))
            break;
        if (!worked)
            await delay(1000);
    } while (!stopped);
}
main().catch(() => { console.error('通知规划进程停止：依赖异常；真实发送保持关闭。'); process.exitCode = 1; }).finally(() => pool.end());
