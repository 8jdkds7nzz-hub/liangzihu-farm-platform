import type { Pool } from 'pg';
import type { Clock } from '../../platform/types';
import { systemClock } from '../../platform/clock';
import { AppError } from '../../platform/error';
import { transaction } from '../../db/pool';
import { runOne } from '../jobs/runner';
import type { JobLease } from '../jobs/repository';
import { dispatchNotice,planNotifications,queryReceipt,recoverUncertainNotices } from './service';
import { scheduleEscalation } from './escalation';
import type { NotificationProvider } from './types';
export async function runNotificationCycle(pool:Pool,workerId:string,providers?:Partial<{wecom:NotificationProvider;voice:NotificationProvider}>,clock:Clock=systemClock){
  await transaction(c=>recoverUncertainNotices(c,clock.now()),pool);
  await transaction(async c=>{const alerts=(await c.query("SELECT id FROM alerts WHERE state='open' AND severity='severe' ORDER BY opened_at LIMIT 200")).rows;for(const alert of alerts)await scheduleEscalation(c,alert.id,clock.now());},pool);
  const handlers:Record<string,(job:JobLease)=>Promise<void>>={'notification.plan':job=>transaction(c=>planNotifications(c,String(job.payload.alertId),String(job.payload.eventId),String(job.payload.change),clock.now()),pool)};
  if(providers){
    const provider=(job:JobLease)=>{const channel=job.payload.channel;if(channel!=='wecom'&&channel!=='voice'||!providers[channel])throw new AppError(422,'INVALID_NOTICE_CHANNEL','通知任务通道未启用');return providers[channel]!;};
    handlers['notice.send']=async job=>{const state=await dispatchNotice(pool,job,provider(job),clock===systemClock?undefined:clock.now());if(state==='unknown')throw new AppError(503,'NOTICE_RESULT_UNKNOWN','发送结果未知，进入待核，不重发');};
    handlers['notice.query']=async job=>{await queryReceipt(pool,String(job.payload.intentId),provider(job),clock.now());};
  }
  return runOne(pool,workerId,handlers,clock,{noticeChannels:providers?Object.keys(providers):[]});
}
