import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice, integer, text } from '../../platform/validation';
import { assertAccess, listAccessibleObjects } from '../identity/access';
import { audit, uuid } from '../identity/common';
export const objectKinds = ['farm', 'pond', 'field', 'channel', 'facility'] as const;
export async function saveObject(c: PoolClient, actor: Actor, input: Record<string, unknown>) {
    const name = text(input.name, '名称', 80), source = text(input.source, '资料来源', 1000);
    const kind = choice(input.kind, objectKinds, '对象类型');
    let id: string;
    if (input.id) {
        uuid(input.id);
        id = input.id;
        await assertAccess(c, actor, { objectId: id, action: 'configure', at: new Date().toISOString() });
        const old = (await c.query('SELECT * FROM objects WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!old)
            throw new AppError(404, 'OBJECT_NOT_FOUND', '对象不存在');
        if (old.version !== integer(input.version, '版本'))
            throw new AppError(409, 'VERSION_CONFLICT', '对象已更新，请刷新后重试');
        if (old.kind !== kind)
            throw new AppError(422, 'IMMUTABLE_KIND', '对象类型不能修改，请另建对象并保留旧记录');
        await c.query('UPDATE objects SET name=$2,source=$3,version=version+1 WHERE id=$1', [id, name, source]);
    }
    else {
        uuid(input.parentId);
        await assertAccess(c, actor, { objectId: input.parentId, action: 'configure', at: new Date().toISOString() });
        const code = text(input.code, '编号', 80);
        const result = await c.query('INSERT INTO objects(parent_id,code,name,kind,source,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO NOTHING RETURNING id', [input.parentId, code, name, kind, source, actor.id]);
        if (!result.rowCount)
            throw new AppError(409, 'CODE_EXISTS', '对象编号已存在');
        id = result.rows[0].id;
        for (const action of ['read', 'configure'])
            await c.query('INSERT INTO grants(user_id,object_id,action,created_by) VALUES($1,$2,$3,$1)', [actor.id, id, action]);
    }
    const row = (await c.query('SELECT id,parent_id,code,name,kind,boundary_status,source,version FROM objects WHERE id=$1', [id])).rows[0];
    await c.query('INSERT INTO object_versions(object_id,version,snapshot,reason,created_by) VALUES($1,$2,$3,$4,$5)', [id, row.version, row, text(input.reason ?? '首次登记', '变更依据', 1000), actor.id]);
    await audit(c, actor.id, 'object_saved', id);
    return row;
}
export async function listObjects(c: PoolClient, actor: Actor, limit = 50, offset = 0, action: 'read' | 'configure' = 'read') {
    const ids = await listAccessibleObjects(c, actor, action);
    const rows = (await c.query('SELECT id,parent_id,code,name,kind,boundary_status,source,version FROM objects WHERE id=ANY($1::uuid[]) ORDER BY code LIMIT $2 OFFSET $3', [ids, limit, offset])).rows;
    return { items: rows, total: Number((await c.query('SELECT count(*) FROM objects WHERE id=ANY($1::uuid[])', [ids])).rows[0].count) };
}
