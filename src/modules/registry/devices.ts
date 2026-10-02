import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, optionalText, text } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { audit, uuid } from '../identity/common';
export async function saveSource(c: PoolClient, actor: Actor, input: Record<string, unknown>) {
    uuid(input.objectId);
    await assertAccess(c, actor, { objectId: input.objectId, action: 'configure', at: new Date().toISOString() });
    const result = await c.query('INSERT INTO data_sources(object_id,code,name,provider,contract_ref,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO NOTHING RETURNING id,code,name,provider,verified', [input.objectId, text(input.code, '来源编号', 80), text(input.name, '名称', 80), text(input.provider, '服务方', 80), optionalText(input.contractRef, '资料路径', 1000), actor.id]);
    if (!result.rowCount)
        throw new AppError(409, 'SOURCE_EXISTS', '来源编号已存在');
    await audit(c, actor.id, 'source_created', result.rows[0].id);
    return result.rows[0];
}
export async function saveDevice(c: PoolClient, actor: Actor, input: Record<string, unknown>) {
    uuid(input.objectId);
    uuid(input.sourceId);
    await assertAccess(c, actor, { objectId: input.objectId, action: 'configure', at: new Date().toISOString() });
    const source = (await c.query('SELECT object_id FROM data_sources WHERE id=$1', [input.sourceId])).rows[0];
    if (!source)
        throw new AppError(422, 'SOURCE_REQUIRED', '请先登记数据来源');
    await assertAccess(c, actor, { objectId: source.object_id, action: 'configure', at: new Date().toISOString() });
    const kind = choice(input.kind, ['physical', 'gateway', 'camera_channel'] as const, '设备类别');
    const parentId = input.parentDeviceId || null;
    if (parentId) {
        uuid(parentId);
        const parent = (await c.query('SELECT object_id,kind FROM devices WHERE id=$1', [parentId])).rows[0];
        if (!parent || parent.kind === 'camera_channel')
            throw new AppError(422, 'INVALID_PARENT', '上级须为实体设备或网关');
        await assertAccess(c, actor, { objectId: parent.object_id, action: 'configure', at: new Date().toISOString() });
    }
    if (kind === 'camera_channel' && !parentId)
        throw new AppError(422, 'PARENT_REQUIRED', '摄像通道必须关联实体设备');
    const result = await c.query(`INSERT INTO devices(object_id,source_id,external_id,name,kind,parent_device_id,model,serial_number,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(source_id,external_id) DO NOTHING RETURNING *`, [input.objectId, input.sourceId, text(input.externalId, '厂家编号', 120), text(input.name, '名称', 80), kind, parentId, optionalText(input.model, '型号'), optionalText(input.serialNumber, '序列号'), text(input.source, '登记依据', 1000), actor.id]);
    if (!result.rowCount)
        throw new AppError(409, 'DEVICE_EXISTS', '同一来源中的设备编号已存在');
    await audit(c, actor.id, 'device_created', result.rows[0].id);
    return result.rows[0];
}
export async function verifyDevice(c: PoolClient, actor: Actor, id: string, evidence: string) {
    uuid(id);
    const row = (await c.query('SELECT object_id FROM devices WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row)
        throw new AppError(404, 'DEVICE_NOT_FOUND', '设备不存在');
    await assertAccess(c, actor, { objectId: row.object_id, action: 'configure', at: new Date().toISOString() });
    await c.query('UPDATE devices SET verified=true WHERE id=$1', [id]);
    await c.query("INSERT INTO audit_events(actor_id,event_type,target_id,details) VALUES($1,'device_verified',$2,$3)", [actor.id, id, { evidence: text(evidence, '现场核实依据', 1000) }]);
    return { id, verified: true };
}
export async function listDevices(c: PoolClient, actor: Actor, limit = 50, offset = 0) {
    const ids = await listAccessibleObjects(c, actor, 'read');
    return { items: (await c.query('SELECT d.*,o.name AS object_name FROM devices d JOIN objects o ON o.id=d.object_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY d.name,d.id LIMIT $2 OFFSET $3', [ids, limit, offset])).rows,
        counts: (await c.query('SELECT kind,count(*)::integer AS count FROM devices WHERE object_id=ANY($1::uuid[]) GROUP BY kind', [ids])).rows };
}
export async function verifySource(c:PoolClient,actor:Actor,b:Record<string,unknown>){
 uuid(b.id);const row=(await c.query('SELECT * FROM data_sources WHERE id=$1 FOR UPDATE',[b.id])).rows[0];if(!row)throw new AppError(404,'SOURCE_NOT_FOUND','数据来源不存在');await assertAccess(c,actor,{objectId:row.object_id,action:'configure',at:new Date().toISOString()});const evidence=text(b.evidence,'来源核实依据',2000),verified=b.verified===true,reference=optionalText(b.contractRef,'接口资料位置',1000)??row.contract_ref;if(verified&&!reference)throw new AppError(422,'SOURCE_CONTRACT_REQUIRED','核实来源时请登记接口资料和只读使用范围的依据位置');await c.query('UPDATE data_sources SET verified=$2,contract_ref=$3 WHERE id=$1',[row.id,verified,reference]);await c.query("INSERT INTO audit_events(actor_id,event_type,target_id,details) VALUES($1,'source_verification_changed',$2,$3)",[actor.id,row.id,{beforeVerified:row.verified,verified,evidence,contractRef:reference}]);return {id:row.id,verified};
}
