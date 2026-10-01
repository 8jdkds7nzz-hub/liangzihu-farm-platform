import type { PoolClient } from 'pg';
export async function expireInvalidClaims(c: PoolClient, alertId: string, objectId: string, at: Date): Promise<void> {
    const claims = (await c.query('SELECT c.*,u.enabled,u.role FROM alert_claims c JOIN users u ON u.id=c.actor_id WHERE c.alert_id=$1 AND c.ended_at IS NULL', [alertId])).rows;
    for (const claim of claims) {
        const roles = claim.purpose === 'field_check' ? ['worker', 'technician', 'owner'] : ['maintainer', 'technician', 'owner'];
        const rights = Number((await c.query("SELECT count(DISTINCT action) AS count FROM grants WHERE user_id=$1 AND object_id=$2 AND action IN ('read','claim') AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())", [claim.actor_id, objectId])).rows[0].count);
        if (claim.enabled && roles.includes(claim.role) && rights === 2)
            continue;
        await c.query('UPDATE alert_claims SET ended_at=GREATEST(claimed_at,$2::timestamptz) WHERE id=$1', [claim.id, at]);
        if (claim.purpose === 'field_check')
            await c.query('UPDATE alerts SET unmanaged=true WHERE id=$1', [alertId]);
        await c.query("INSERT INTO alert_events(alert_id,event_type,occurred_at,note) VALUES($1,'claim_invalidated',$2,'原认领人的账号或对象权限已失效，须重新认领')", [alertId, at]);
    }
}
export async function fieldClaimed(c: PoolClient, alertId: string, objectId: string, at: Date): Promise<boolean> {
    await expireInvalidClaims(c, alertId, objectId, at);
    return !!(await c.query("SELECT 1 FROM alert_claims WHERE alert_id=$1 AND purpose='field_check' AND ended_at IS NULL", [alertId])).rowCount;
}
export async function getValidClaims(c: PoolClient, alertId: string, objectId: string) {
    return (await c.query(`SELECT ac.*,u.display_name AS actor_name FROM alert_claims ac JOIN users u ON u.id=ac.actor_id
    WHERE ac.alert_id=$1 AND ac.ended_at IS NULL AND u.enabled
    AND ((ac.purpose='field_check' AND u.role IN ('worker','technician','owner')) OR (ac.purpose='repair' AND u.role IN ('maintainer','technician','owner')))
    AND (SELECT count(DISTINCT action) FROM grants g WHERE g.user_id=ac.actor_id AND g.object_id=$2 AND g.action IN ('read','claim') AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()))=2`, [alertId, objectId])).rows;
}
