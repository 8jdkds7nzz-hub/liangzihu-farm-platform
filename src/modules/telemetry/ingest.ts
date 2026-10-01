import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { transaction } from '../../db/pool';
import { AppError } from '../../platform/error';
import { time } from '../../platform/validation';
import { digest, uuid } from '../identity/common';
import { resolvePointBinding } from '../registry/points';
import { enqueue } from '../jobs/repository';
import { readingIdentity, readingContent } from './identity';
import { canUseAsCurrent } from './quality';
import type { ReadingInput, IngestResult } from './types';
import { canonicalJson } from '../../platform/json';
export interface ContractEvidence { version: string; reference: string; snapshot: Record<string, unknown> }
export async function archiveReceipt(c: PoolClient, sourceId: string, body: Buffer, receivedAt: string, synthetic = false, contract?: ContractEvidence): Promise<string> {
    uuid(sourceId);
    time(receivedAt);
    if (body.length > 1048576)
        throw new AppError(413, 'RAW_TOO_LARGE', '原报文超过单批1MB限制');
    // Only response bodies belong here. Transport headers and credentials are never passed in.
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.toString('utf8'));
    }
    catch {
        parsed = null;
    }
    const stack: unknown[] = [parsed, contract?.snapshot], credentialKeys = new Set(['accesstoken', 'refreshtoken', 'appsecret', 'authorization', 'password', 'apikey', 'secret', 'secretkey', 'clientsecret']);
    while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object')
            continue;
        for (const [key, value] of Object.entries(item)) {
            if (credentialKeys.has(key.toLowerCase().replace(/[_-]/g, '')))
                throw new AppError(422, 'CREDENTIAL_IN_PAYLOAD', '报文含传输凭据，请先核对接入边界');
            if (value && typeof value === 'object')
                stack.push(value);
        }
    }
    if (/authorization\s*:\s*bearer/i.test(body.toString('utf8')))
        throw new AppError(422, 'CREDENTIAL_IN_PAYLOAD', '传输鉴权头不能进入数据报文存档');
    return (await c.query('INSERT INTO raw_receipts(source_id,received_at,body,sha256,synthetic,contract_version,contract_ref,contract_sha256,contract_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [sourceId, receivedAt, body, createHash('sha256').update(body).digest('hex'), synthetic, contract?.version ?? null, contract?.reference ?? null, contract ? digest(canonicalJson(contract.snapshot)) : null, contract?.snapshot ?? null])).rows[0].id;
}
async function quarantine(c: PoolClient, x: ReadingInput, reasons: string[]): Promise<IngestResult> {
    await c.query('INSERT INTO quarantined_readings(raw_ref,input,reasons) VALUES($1,$2,$3)', [x.rawRef, x, reasons]);
    return { observationId: null, disposition: 'quarantined', eligibleForCurrent: false };
}
export async function ingest(c: PoolClient, input: ReadingInput, at = new Date(), resolveMapping = false): Promise<IngestResult> {
    uuid(input.pointId);
    uuid(input.sourceId);
    uuid(input.rawRef);
    time(input.receivedAt);
    if (input.sampledAt)
        time(input.sampledAt);
    if (input.reportedAt)
        time(input.reportedAt);
    const point = (await c.query(`SELECT p.*,d.source_id,d.external_id FROM points p JOIN devices d ON d.id=p.device_id WHERE p.id=$1 FOR UPDATE OF p`, [input.pointId])).rows[0];
    const raw = (await c.query('SELECT source_id FROM raw_receipts WHERE id=$1', [input.rawRef])).rows[0];
    if (!raw || raw.source_id !== input.sourceId)
        throw new AppError(422, 'RAW_SOURCE_MISMATCH', '原报文来源不匹配');
    if (!point || point.source_id !== input.sourceId || point.external_id !== input.externalDeviceId || point.metric !== input.metric)
        return quarantine(c, input, ['unmapped_point']);
    const identity = readingIdentity(input);
    if (!identity)
        return quarantine(c, input, ['unknown_identity']);
    let binding: Awaited<ReturnType<typeof resolvePointBinding>> = null;
    if (input.sampledAt) {
        try {
            binding = await resolvePointBinding(c, input.pointId, input.sampledAt);
        }
        catch (e) {
            if (e instanceof AppError && e.code === 'BINDING_CONFLICT')
                return quarantine(c, input, ['binding_conflict']);
            throw e;
        }
    }
    if (!binding?.verified || (!resolveMapping && binding.bindingId !== input.mappingVersion))
        return quarantine(c, input, ['unverified_mapping']);
    const x = { ...input, reasons: [...input.reasons] };
    if (x.unit !== point.unit) {
        x.quality = 'invalid';
        x.reasons.push('unit_mismatch');
    }
    if (x.value !== null && !Number.isFinite(x.value)) {
        x.value = null;
        x.quality = 'invalid';
        x.reasons.push('invalid_number');
    }
    if (x.sampledAt && Date.parse(x.sampledAt) > at.getTime()) {
        x.quality = 'suspect';
        x.reasons.push('future_time');
    }
    await c.query('INSERT INTO observation_heads(identity_hash,point_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [digest(identity), x.pointId]);
    const head = (await c.query('SELECT * FROM observation_heads WHERE identity_hash=$1 FOR UPDATE', [digest(identity)])).rows[0];
    const hash = digest(readingContent(input));
    const existing = (await c.query('SELECT id FROM observations WHERE head_id=$1 AND content_hash=$2', [head.id, hash])).rows[0];
    if (existing) {
        await c.query('INSERT INTO observation_receipts(observation_id,raw_ref) VALUES($1,$2) ON CONFLICT DO NOTHING', [existing.id, x.rawRef]);
        return { observationId: existing.id, disposition: head.conflicted ? 'conflict' : 'duplicate', eligibleForCurrent: false };
    }
    const row = (await c.query(`INSERT INTO observations(head_id,content_hash,source_id,source_record_id,external_device_id,point_id,object_id,binding_id,metric,sampled_at,reported_at,received_at,sequence,raw_value,value,unit,quality,reasons,origin,raw_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`, [head.id, hash, x.sourceId, x.sourceRecordId, x.externalDeviceId, x.pointId, binding.objectId, binding.bindingId, x.metric, x.sampledAt, x.reportedAt, x.receivedAt, x.sequence, JSON.stringify(x.rawValue), x.value, x.unit, x.quality, x.reasons, x.origin, x.rawRef])).rows[0];
    await c.query('INSERT INTO observation_receipts(observation_id,raw_ref) VALUES($1,$2)', [row.id, x.rawRef]);
    if (head.canonical_id) {
        await c.query('UPDATE observation_heads SET conflicted=true WHERE id=$1', [head.id]);
        await c.query('INSERT INTO measurement_conflicts(head_id,first_id,other_id,detected_at) VALUES($1,$2,$3,$4)', [head.id, head.canonical_id, row.id, at]);
        await c.query("UPDATE point_current SET quality='suspect',reasons=array_append(reasons,'conflict') WHERE observation_id IN (SELECT id FROM observations WHERE head_id=$1) AND NOT ('conflict'=ANY(reasons))", [head.id]);
        const event = (await c.query("INSERT INTO domain_events(event_type,object_id,occurred_at,payload) VALUES('reading.conflict',$1,$2,$3) RETURNING id", [binding.objectId, at, { headId: head.id, pointId: x.pointId }])).rows[0];
        await enqueue(c, { kind: 'telemetry.evaluate', businessKey: 'evaluate:' + event.id, payload: { eventId: event.id, observationId: row.id }, dueAt: at.toISOString(), priority: 90 });
        return { observationId: row.id, disposition: 'conflict', eligibleForCurrent: false };
    }
    await c.query('UPDATE observation_heads SET canonical_id=$2 WHERE id=$1', [head.id, row.id]);
    const current = (await c.query('SELECT sampled_at FROM point_current WHERE point_id=$1', [x.pointId])).rows[0];
    let currentBinding: Awaited<ReturnType<typeof resolvePointBinding>> = null;
    try { currentBinding = await resolvePointBinding(c, x.pointId, at.toISOString()); }
    catch (e) { if (!(e instanceof AppError && e.code === 'BINDING_CONFLICT')) throw e; }
    const eligible = currentBinding?.verified === true && currentBinding.bindingId === binding.bindingId && point.max_age_ms !== null && canUseAsCurrent(x, current?.sampled_at.toISOString() ?? null, at, point.max_age_ms);
    if (eligible)
        await c.query(`INSERT INTO point_current(point_id,observation_id,sampled_at,quality,reasons) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(point_id) DO UPDATE SET observation_id=excluded.observation_id,sampled_at=excluded.sampled_at,quality=excluded.quality,reasons=excluded.reasons`, [x.pointId, row.id, x.sampledAt, x.quality, x.reasons]);
    const event = (await c.query("INSERT INTO domain_events(event_type,object_id,occurred_at,payload) VALUES('reading.recorded',$1,$2,$3) RETURNING id", [binding.objectId, at, { observationId: row.id, pointId: x.pointId, eligibleForCurrent: eligible }])).rows[0];
    await enqueue(c, { kind: 'telemetry.evaluate', businessKey: 'evaluate:' + event.id, payload: { eventId: event.id, observationId: row.id }, dueAt: at.toISOString(), priority: eligible ? 100 : 10 });
    return { observationId: row.id, disposition: 'inserted', eligibleForCurrent: eligible };
}
export async function persistBatch(pool: Pool, batch: {
    contract?: ContractEvidence;
    resolveMappings?: boolean;
    sourceId: string;
    raw: Buffer;
    receivedAt: string;
    synthetic: boolean;
    expectedCursor: string | null;
    nextCursor: string;
    readings: Omit<ReadingInput, 'rawRef'>[];
}, at = new Date()) {
    return transaction(async (c) => {
        const source = (await c.query('SELECT id FROM data_sources WHERE id=$1 FOR UPDATE', [batch.sourceId])).rows[0];
        if (!source)
            throw new AppError(422, 'SOURCE_REQUIRED', '来源未登记');
        const previous = (await c.query('SELECT cursor FROM ingestion_cursors WHERE source_id=$1', [batch.sourceId])).rows[0]?.cursor ?? null;
        if (previous !== batch.expectedCursor)
            throw new AppError(409, 'CURSOR_CHANGED', '采集游标已由其他进程推进');
        const rawRef = await archiveReceipt(c, batch.sourceId, batch.raw, batch.receivedAt, batch.synthetic, batch.contract), results: IngestResult[] = [];
        for (const x of batch.readings) {
            if (x.sourceId !== batch.sourceId)
                throw new AppError(422, 'SOURCE_MISMATCH', '批次来源不一致');
            results.push(await ingest(c, { ...x, rawRef, receivedAt: batch.receivedAt }, at, batch.resolveMappings === true));
        }
        await c.query('INSERT INTO ingestion_cursors(source_id,cursor,updated_at) VALUES($1,$2,$3) ON CONFLICT(source_id) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at', [batch.sourceId, batch.nextCursor, at]);
        await c.query("INSERT INTO source_health(source_id,last_attempt_at,last_success_at,state) VALUES($1,$2,$2,'ok') ON CONFLICT(source_id) DO UPDATE SET last_attempt_at=$2,last_success_at=$2,error_code=NULL,state='ok'", [batch.sourceId, at]);
        return results;
    }, pool);
}
