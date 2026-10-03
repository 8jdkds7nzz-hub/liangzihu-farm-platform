import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';import {choice,text,optionalText} from '../../platform/validation';import {uuid} from '../identity/common';
import {access,request,type Body} from './common';export {lot} from './common';
export async function createLocation(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);return request(c,a,b,'location',b.objectId as string,async()=>{
 const r=(await c.query('INSERT INTO stock_locations(object_id,code,name,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',[b.objectId,text(b.code,'仓位编号',80),text(b.name,'仓位名称',120),a.id])).rows[0];
 if(!r)throw new AppError(409,'LOCATION_EXISTS','当前对象的仓位编号已登记');return r;});
}
export async function createLot(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);return request(c,a,b,'lot',b.objectId as string,async()=>{
 const unit=choice(b.unit,['kg','L','piece'] as const,'单位'),basis=choice(b.basis,['as_is','wet','dry'] as const,'数量口径');
 if(unit!=='kg'&&basis!=='as_is')throw new AppError(400,'LOT_BASIS','干湿基仅用于重量');
 if(b.productionBatchId){uuid(b.productionBatchId);if((await c.query('SELECT object_id FROM production_batches WHERE id=$1',[b.productionBatchId])).rows[0]?.object_id!==b.objectId)throw new AppError(422,'STOCK_SCOPE','生产批次不属于当前对象');}
 const raw=b.identities??{};if(!raw||Array.isArray(raw)||typeof raw!=='object')throw new AppError(400,'LOT_IDENTITIES','批次身份须按四种类型分别填写');
 const ids:Record<string,string|null>={};for(const name of ['regulatory','inventory','logistics','supplier'])ids[name]=optionalText((raw as Body)[name],name+'批号',120);
 const code=text(b.code,'库存批号',80);if(ids.inventory&&ids.inventory!==code)throw new AppError(400,'LOT_IDENTITIES','库存身份须与库存批号一致');ids.inventory=code;
 const r=(await c.query('INSERT INTO stock_lots(object_id,code,product,kind,unit,basis,production_batch_id,identities,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *',[b.objectId,code,text(b.product,'品名',120),choice(b.kind,['input','harvest','processed'] as const,'批次类型'),unit,basis,b.productionBatchId||null,ids,text(b.source,'来源',2000),a.id])).rows[0];
 if(!r)throw new AppError(409,'LOT_EXISTS','库存批号已使用，编号不可覆盖');return r;});
}

