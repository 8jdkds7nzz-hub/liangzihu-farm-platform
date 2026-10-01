import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { saveDevice } from './devices';
export async function importDevices(c: PoolClient, actor: Actor, rows: unknown) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50)
        throw new AppError(400, 'INVALID_IMPORT', '一次导入1至50行设备记录');
    const result = [];
    for (let i = 0; i < rows.length; i++) {
        await c.query('SAVEPOINT device_import_row');
        try {
            if (!rows[i] || typeof rows[i] !== 'object' || Array.isArray(rows[i]))
                throw new AppError(400, 'INVALID_ROW', '该行不是对象');
            const device = await saveDevice(c, actor, rows[i]);
            result.push({ row: i + 1, ok: true, id: device.id });
            await c.query('RELEASE SAVEPOINT device_import_row');
        }
        catch (error) {
            await c.query('ROLLBACK TO SAVEPOINT device_import_row');
            await c.query('RELEASE SAVEPOINT device_import_row');
            result.push({ row: i + 1, ok: false, code: error instanceof AppError ? error.code : 'ROW_FAILED', message: error instanceof AppError ? error.message : '该行未导入，请检查字段与引用' });
        }
    }
    return { rows: result };
}
