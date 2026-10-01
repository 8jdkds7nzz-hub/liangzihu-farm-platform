import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { readDatabaseConfig } from '../src/platform/config';
import { transaction } from '../src/db/pool';
import { runNotificationCycle } from '../src/modules/notifications/runner';
import { heartbeat } from '../src/modules/operations/heartbeat';
const pool = new pg.Pool(readDatabaseConfig({ ...process.env, DB_POOL_MAX: process.env.NOTIFICATIONS_DB_POOL_MAX ?? '2' }));
let stopped = false;
for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => { stopped = true; });
async function main() {
    console.log('通知规划进程启动；G03/G04真实发送关闭，不领取notice.send任务。');
    do {
        const worked = await runNotificationCycle(pool, 'notifications-' + process.pid);
        await transaction(c => heartbeat(c, 'notifications', 'notifications-' + process.pid, 'blocked', new Date(), true, 'LIVE_PROVIDERS_NOT_READY'), pool);
        if (process.argv.includes('--once'))
            break;
        if (!worked)
            await delay(1000);
    } while (!stopped);
}
main().catch(() => { console.error('通知规划进程停止：依赖异常；真实发送保持关闭。'); process.exitCode = 1; }).finally(() => pool.end());
