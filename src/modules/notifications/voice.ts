import { AppError } from '../../platform/error';
import type {Pool} from 'pg';
import {database,getPool} from '../../db/pool';
import {configuredVoice} from '../../adapters/aliyun/messaging';
import {resolveContact} from './rosters';
import {digest} from '../identity/common';
import type { NotificationProvider } from './types';
export function voiceProvider(pool:Pool=getPool()):NotificationProvider {
 const client=configuredVoice();
 return {async send(n){if(!n.alertId)throw new AppError(403,'VOICE_ALERT_ONLY','电话只用于已核告警升级');const phone=await database(c=>resolveContact(c,n.recipientId,'voice'),pool),r=await client.send(phone,n.text,digest(n.requestKey));return {state:r.accepted?'accepted':'failed',providerRequestId:r.callId,occurredAt:new Date().toISOString(),reason:null};},async query(id){const intent=(await pool.query("SELECT started_at FROM notification_intents WHERE channel='voice' AND provider_request_id=$1 ORDER BY started_at LIMIT 1",[id])).rows[0],at=new Date();if(!intent?.started_at||at.getTime()-intent.started_at.getTime()<300000)return {state:'unknown',providerRequestId:id,occurredAt:at.toISOString(),reason:'厂家记录同步需3至5分钟，未收到不重拨'};const data=await client.query(id,intent.started_at);const connected=data&&typeof data.duration==='number'&&data.duration>0?true:null;return {state:'unknown',providerRequestId:id,occurredAt:at.toISOString(),connected,reason:connected?'已接通；不推定模板完整播放或现场接管':'实际状态码尚需G04核实；不推定送达或失败'};}};
}
