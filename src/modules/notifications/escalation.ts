import type { PoolClient } from 'pg';
import { currentRoster } from './rosters';
import { createIntent } from './service';
import { fieldClaimed } from '../alerts/claim-validity';
export function phoneDue(firstAttemptAt: number | null, now: number, claimed: boolean, severe: boolean, nightShift: boolean): boolean { return firstAttemptAt !== null && !claimed && severe && nightShift && now - firstAttemptAt >= 180000; }
export async function scheduleEscalation(c: PoolClient, alertId: string, at = new Date()) {
    const alert = (await c.query('SELECT * FROM alerts WHERE id=$1 FOR UPDATE', [alertId])).rows[0];
    if (!alert || alert.state !== 'open')
        return;
    const roster = await currentRoster(c, alert.object_id, at);
    if (!roster)
        return;
    const claimed = await fieldClaimed(c, alertId, alert.object_id, at);
    if (!phoneDue(alert.first_notification_at?.getTime() ?? null, at.getTime(), claimed, alert.severity === 'severe', roster.night_shift))
        return;
    const calls = (await c.query("SELECT * FROM notification_intents WHERE alert_id=$1 AND roster_id=$2 AND phase='escalation' ORDER BY level", [alertId, roster.id])).rows;
    const previous = calls.at(-1);
    if (previous && !['failed', 'cancelled', 'blocked'].includes(previous.state)) {
        if (!previous.started_at || at.getTime() - previous.started_at.getTime() < roster.call_timeout_ms)
            return;
    }
    const level = previous ? previous.level + 1 : 0, people = [roster.onsite_id, roster.technician_id, roster.owner_id];
    if (level < 3) {
        await createIntent(c, { alertId, rosterId: roster.id, recipientId: people[level], channel: 'voice', phase: 'escalation', level, requestKey: `phone:${alertId}:${roster.id}:${level}`, text: '严重告警尚未认领：' + alert.title + '；请进入平台明确认领 /alerts/' + alertId }, at);
        return;
    }
    await c.query('UPDATE alerts SET unmanaged=true WHERE id=$1', [alertId]);
    const lastReminder = (await c.query("SELECT max(created_at) AS at FROM notification_intents WHERE alert_id=$1 AND roster_id=$2 AND phase IN ('reminder','admin_reminder')", [alertId, roster.id])).rows[0].at;
    if (lastReminder && at.getTime() - lastReminder.getTime() < 300000)
        return;
    const bucket = Math.floor(at.getTime() / 300000);
    const admins = (await c.query("SELECT DISTINCT u.id FROM users u JOIN grants g ON g.user_id=u.id WHERE u.enabled AND u.role='admin' AND g.object_id=$1 AND g.action='read' AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())", [alert.object_id])).rows;
    for (const recipientId of new Set<string>([roster.onsite_id, roster.owner_id, ...admins.map(r => r.id)]))
        await createIntent(c, { alertId, rosterId: roster.id, recipientId, channel: 'wecom', phase: admins.some(r => r.id === recipientId) ? 'admin_reminder' : 'reminder', requestKey: `unmanaged:${alertId}:${roster.id}:${recipientId}:${bucket}`, text: '告警仍未接管，请人工安排现场核查：' + alert.title + '；/alerts/' + alertId }, at);
}
