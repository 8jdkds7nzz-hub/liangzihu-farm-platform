import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../db/pool';
import { AppError } from '../../platform/error';
import { text, time, integer } from '../../platform/validation';
export interface JobLease {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    leaseToken: string;
    leaseUntil: Date;
    attempts: number;
}
export async function enqueue(c: PoolClient, input: {
    kind: string;
    businessKey: string;
    payload: Record<string, unknown>;
    dueAt: string;
    priority?: number;
}): Promise<string> {
    text(input.kind, '任务类别', 80);
    text(input.businessKey, '任务标识', 300);
    time(input.dueAt);
    integer(input.priority ?? 0, '优先级', 0, 100);
    const row = (await c.query(`INSERT INTO jobs(kind,business_key,payload,due_at,priority) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(business_key) DO NOTHING RETURNING id`, [input.kind, input.businessKey, input.payload, input.dueAt, input.priority ?? 0])).rows[0];
    if (row)
        return row.id;
    const existing = (await c.query('SELECT id,kind=$2 AND payload=$3::jsonb AS same FROM jobs WHERE business_key=$1', [input.businessKey, input.kind, input.payload])).rows[0];
    if (!existing?.same)
        throw new AppError(409, 'JOB_KEY_CONFLICT', '同一任务标识对应不同内容');
    return existing.id;
}
export async function claimJob(pool: Pool, workerId: string, at: Date, options: {
    kinds?: string[];
    leaseMs?: number;
} = {}): Promise<JobLease | null> {
    const leaseMs = integer(options.leaseMs ?? 60000, '租约时限', 1000, 300000), token = randomUUID();
    return transaction(async (c) => {
        const row = (await c.query(`WITH candidate AS (SELECT id FROM jobs WHERE state IN ('queued','retry_wait') AND due_at<=$1
      AND ($2::text[] IS NULL OR kind=ANY($2)) ORDER BY priority DESC,due_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE jobs j SET state='running',lease_token=$3,lease_until=$4,worker_id=$5,attempts=attempts+1,external_started_at=NULL
      FROM candidate q WHERE j.id=q.id RETURNING j.*`, [at, options.kinds ?? null, token, new Date(at.getTime() + leaseMs), workerId])).rows[0];
        if (!row)
            return null;
        await c.query('INSERT INTO job_attempts(job_id,lease_token,worker_id,started_at) VALUES($1,$2,$3,$4)', [row.id, token, workerId, at]);
        return { id: row.id, kind: row.kind, payload: row.payload, leaseToken: token, leaseUntil: row.lease_until, attempts: row.attempts };
    }, pool);
}
export async function markExternalCall(pool: Pool, id: string, token: string, at: Date): Promise<boolean> {
    return transaction(async (c) => !!(await c.query("UPDATE jobs SET external_started_at=$3 WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>$3 AND external_started_at IS NULL RETURNING id", [id, token, at])).rowCount, pool);
}
export async function finishJob(pool: Pool, id: string, token: string, outcome: {
    state: 'done' | 'failed' | 'retry_wait' | 'awaiting_receipt';
    errorCode?: string;
    retryAt?: Date;
}, at = new Date()): Promise<boolean> {
    const error = outcome.errorCode && /^[A-Z0-9_]{1,80}$/.test(outcome.errorCode) ? outcome.errorCode : null;
    return transaction(async (c) => {
        const row = (await c.query(`UPDATE jobs SET state=CASE WHEN external_started_at IS NOT NULL AND $4='retry_wait' THEN 'awaiting_receipt' ELSE $4 END,
      error_code=$5,due_at=COALESCE($6,due_at),finished_at=$3,lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>$3 RETURNING state`, [id, token, at, outcome.state, error, outcome.retryAt ?? null])).rows[0];
        if (!row)
            return false;
        await c.query('UPDATE job_attempts SET finished_at=$2,outcome=$3,error_code=$4 WHERE lease_token=$1', [token, at, row.state, error]);
        return true;
    }, pool);
}
export async function recoverExpired(pool: Pool, at = new Date()): Promise<number> {
    return transaction(async (c) => {
        const rows = (await c.query("SELECT id,lease_token,external_started_at,attempts FROM jobs WHERE state='running' AND lease_until<=$1 FOR UPDATE SKIP LOCKED", [at])).rows;
        for (const row of rows) {
            const state = row.external_started_at ? 'awaiting_receipt' : row.attempts >= 5 ? 'failed' : 'retry_wait';
            await c.query('UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL,due_at=$3,error_code=$4 WHERE id=$1', [row.id, state, at, 'LEASE_EXPIRED']);
            await c.query("UPDATE job_attempts SET finished_at=$2,outcome=$3,error_code='LEASE_EXPIRED' WHERE lease_token=$1", [row.lease_token, at, state]);
        }
        return rows.length;
    }, pool);
}
export async function consumeOnce(c: PoolClient, consumer: string, eventId: string, work: () => Promise<void>): Promise<boolean> {
    const result = await c.query('INSERT INTO consumer_offsets(consumer,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [consumer, eventId]);
    if (!result.rowCount)
        return false;
    await work();
    return true;
}
