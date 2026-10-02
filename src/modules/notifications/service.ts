import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../db/pool';
import { AppError } from '../../platform/error';
import { time } from '../../platform/validation';
import { enqueue, type JobLease } from '../jobs/repository';
import { currentRoster, recipientAllowed } from './rosters';
import type { NotificationProvider, Receipt } from './types';
import { recordUsage } from '../operations/budget';
import { fieldClaimed } from '../alerts/claim-validity';
export async function createIntent(c: PoolClient, input: {
    alertId: string;
    eventId?: string;
    rosterId?: string;
    recipientId: string;
    channel: 'wecom' | 'voice';
    phase: string;
    level?: number;
    requestKey: string;
    text: string;
}, at: Date) {
    const row = (await c.query(`INSERT INTO notification_intents(alert_id,event_id,roster_id,recipient_id,channel,phase,level,request_key,text,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(request_key) DO NOTHING RETURNING id`, [input.alertId, input.eventId ?? null, input.rosterId ?? null, input.recipientId, input.channel, input.phase, input.level ?? null, input.requestKey, input.text, at])).rows[0];
    if (row)
        await enqueue(c, { kind: 'notice.send', businessKey: 'send:' + row.id, payload: { intentId: row.id, channel: input.channel }, dueAt: at.toISOString(), priority: input.channel === 'voice' ? 100 : 90 });
    return row?.id ?? null;
}
export async function planNotifications(c: PoolClient, alertId: string, eventId: string, change: string, at = new Date()) {
    const alert = (await c.query('SELECT * FROM alerts WHERE id=$1 FOR UPDATE', [alertId])).rows[0];
    if (!alert)
        return;
    const recovery = change === 'recovered';
    if (alert.state === 'closed' || (!recovery && alert.state !== 'open'))
        return;
    const roster = await currentRoster(c, alert.object_id, at);
    if (!roster)
        throw new AppError(503, 'ROSTER_NOT_READY', '当前对象没有已核实的值班安排');
    const people = ['measurement','camera'].includes(alert.kind) ? [roster.onsite_id, roster.technician_id] : [roster.onsite_id, roster.maintainer_id];
    for (const recipientId of new Set<string>(people)) {
        if (!await recipientAllowed(c, recipientId, alert.object_id))
            continue;
        await createIntent(c, { alertId, eventId, rosterId: roster.id, recipientId, channel: 'wecom', phase: recovery ? 'recovery' : 'initial', requestKey: ['initial', eventId, roster.id, recipientId].join(':'), text: (recovery ? '监测恢复，仍需核查关闭：' : '待核查：') + alert.title + '；详情 /alerts/' + alertId }, at);
    }
}
async function recordReceipt(c: PoolClient, intentId: string, receipt: Receipt) {
    if (!['accepted', 'delivered', 'failed', 'unknown'].includes(receipt.state))
        throw new AppError(502, 'INVALID_RECEIPT', '服务商状态未在契约中登记');
    time(receipt.occurredAt);
    const prior = (await c.query('SELECT state FROM notification_intents WHERE id=$1 FOR UPDATE', [intentId])).rows[0];
    if (!prior)
        return;
    const reason = receipt.state === 'unknown' ? 'PROVIDER_RESULT_UNKNOWN' : receipt.state === 'failed' ? 'PROVIDER_FAILED' : null;
    await c.query('INSERT INTO notification_receipts(intent_id,state,provider_request_id,connected,occurred_at,reason_code) VALUES($1,$2,$3,$4,$5,$6)', [intentId, receipt.state, receipt.providerRequestId, receipt.connected ?? null, receipt.occurredAt, reason]);
    const known = (await c.query("SELECT bool_or(state='delivered') AS delivered,bool_or(state='failed') AS failed,bool_or(state='accepted') AS accepted FROM notification_receipts WHERE intent_id=$1", [intentId])).rows[0];
    const state = known.delivered && known.failed ? 'unknown' : known.delivered ? 'delivered' : known.failed ? 'failed' : known.accepted ? 'accepted' : receipt.state;
    await c.query('UPDATE notification_intents SET state=$2,provider_request_id=COALESCE($3,provider_request_id),error_code=$4 WHERE id=$1', [intentId, state, receipt.providerRequestId, known.delivered && known.failed ? 'CONFLICTING_RECEIPTS' : reason]);
    await c.query('UPDATE notification_attempts SET completed_at=$2,result=$3 WHERE intent_id=$1', [intentId, receipt.occurredAt, state]);
}
export async function dispatchNotice(pool: Pool, job: JobLease, provider: NotificationProvider, requestedAt?: Date): Promise<'sent' | 'cancelled' | 'unknown' | 'blocked'> {
    await provider.ready?.();
    const at=requestedAt??new Date(),attemptedAt=at;
    const prepared = await transaction(async (c) => {
        const peek = (await c.query('SELECT alert_id FROM notification_intents WHERE id=$1', [job.payload.intentId])).rows[0];
        if (!peek)
            return null;
        const alert = (await c.query('SELECT * FROM alerts WHERE id=$1 FOR UPDATE', [peek.alert_id])).rows[0];
        const intent = (await c.query('SELECT * FROM notification_intents WHERE id=$1 FOR UPDATE', [job.payload.intentId])).rows[0];
        if (!intent || intent.state !== 'queued')
            return null;
        const roster = await currentRoster(c, alert.object_id, at);
        const claimed = await fieldClaimed(c, alert.id, alert.object_id, at);
        const cancel = alert.state === 'closed' || (intent.phase !== 'recovery' && alert.state !== 'open') || !await recipientAllowed(c, intent.recipient_id, alert.object_id)
            || (['escalation', 'reminder', 'admin_reminder'].includes(intent.phase) && claimed) || !roster || roster.id !== intent.roster_id
            || (intent.channel === 'voice' && (!roster.night_shift || alert.severity !== 'severe'));
        if (cancel) {
            await c.query("UPDATE notification_intents SET state='cancelled',error_code='CURRENT_STATE_CHANGED' WHERE id=$1", [intent.id]);
            return null;
        }
        if (!(await c.query('SELECT 1 FROM notification_contacts WHERE user_id=$1 AND channel=$2 AND verified', [intent.recipient_id, intent.channel])).rowCount) {
            await c.query("UPDATE notification_intents SET state='blocked',error_code='CONTACT_NOT_READY' WHERE id=$1", [intent.id]);
            return 'blocked' as const;
        }
        const leased = await c.query("UPDATE jobs SET external_started_at=$3 WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>$3 AND external_started_at IS NULL AND kind='notice.send' AND payload->>'intentId'=$4 RETURNING id", [job.id, job.leaseToken, at, intent.id]);
        if (!leased.rowCount)
            throw new AppError(409, 'LEASE_LOST', '任务领取已过期，未开始外部调用');
        await c.query("UPDATE notification_intents SET state='sending',started_at=$2 WHERE id=$1", [intent.id, at]);
        await c.query('INSERT INTO notification_attempts(intent_id,job_id,lease_token,started_at) VALUES($1,$2,$3,$4)', [intent.id, job.id, job.leaseToken, at]);
        // Essential alert delivery is never disabled by the cost ledger, including severe phone escalation.
        await recordUsage(c, { objectId: alert.object_id, category: intent.channel, businessKey: 'notice-attempt:' + intent.id, occurredAt: at.toISOString(), units: 1, amount: null });
        if (intent.phase === 'initial')
            await c.query('UPDATE alerts SET first_notification_at=COALESCE(first_notification_at,$2) WHERE id=$1', [alert.id, at]);
        return intent;
    }, pool);
    if (prepared === 'blocked')
        return 'blocked';
    if (!prepared)
        return 'cancelled';
    let receipt: Receipt;
    try {
        receipt = await provider.send({ id: prepared.id, requestKey: prepared.request_key, recipientId: prepared.recipient_id, alertId: prepared.alert_id, text: prepared.text });
    }
    catch {
        receipt = { state: 'unknown', providerRequestId: null, occurredAt: at.toISOString(), reason: null };
    }
    await transaction(async c => {
        await recordReceipt(c, prepared.id, receipt);
        if (receipt.providerRequestId && ['accepted', 'unknown'].includes(receipt.state))
            await enqueue(c, { kind: 'notice.query', businessKey: 'query:' + prepared.id, payload: { intentId: prepared.id, channel: prepared.channel }, dueAt: new Date(attemptedAt.getTime()+(prepared.channel==='voice'?300000:0)).toISOString(), priority: 95 });
    }, pool);
    return receipt.state === 'unknown' ? 'unknown' : 'sent';
}
export async function queryReceipt(pool: Pool, intentId: string, provider: NotificationProvider, at = new Date()) {
    const row = (await pool.query("SELECT * FROM notification_intents WHERE id=$1 AND state IN ('sending','accepted','unknown')", [intentId])).rows[0];
    if (!row?.provider_request_id)
        return { state: 'unknown' as const };
    let receipt: Receipt;
    try {
        receipt = await provider.query(row.provider_request_id);
    }
    catch {
        receipt = { state: 'unknown', providerRequestId: row.provider_request_id, occurredAt: at.toISOString(), reason: 'QUERY_FAILED' };
    }
    await transaction(async c => {
        await recordReceipt(c, intentId, receipt);
        if(receipt.state==='unknown'&&row.channel==='voice'&&row.started_at&&at.getTime()-row.started_at.getTime()<86400000)await enqueue(c,{kind:'notice.query',businessKey:'query:'+intentId+':'+Math.floor(at.getTime()/300000),payload:{intentId,channel:'voice'},dueAt:new Date(at.getTime()+300000).toISOString(),priority:60});
        if (receipt.state !== 'unknown') await c.query("UPDATE jobs SET state='done',finished_at=$2,error_code=NULL WHERE business_key=$1 AND state='awaiting_receipt'", ['send:' + intentId, at]);
    }, pool);
    return { state: receipt.state, checkedAt: at.toISOString() };
}
export async function recoverUncertainNotices(c: PoolClient, at = new Date()) {
    await c.query(`UPDATE notification_intents i SET state='unknown',error_code='ATTEMPT_RESULT_UNKNOWN' FROM notification_attempts a JOIN jobs j ON j.id=a.job_id
    WHERE i.id=a.intent_id AND i.state='sending' AND (j.state='awaiting_receipt' OR (j.state='running' AND j.lease_until<=$1))`, [at]);
}
