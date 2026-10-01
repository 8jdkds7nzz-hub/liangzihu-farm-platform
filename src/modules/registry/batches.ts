import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { optionalText,text,time } from '../../platform/validation';
import { assertAccess } from '../identity/access';
import { audit,uuid } from '../identity/common';
export async function saveBatch(c:PoolClient,actor:Actor,input:Record<string,unknown>) {
  uuid(input.objectId);await assertAccess(c,actor,{objectId:input.objectId,action:'configure',at:new Date().toISOString()});
  const started=time(input.startedAt),ended=input.endedAt?time(input.endedAt):null;
  if(ended&&ended<=started)throw new AppError(422,'INVALID_PERIOD','结束时间须晚于开始时间');
  const supersedes=input.supersedesId||null;
  if(supersedes){uuid(supersedes);const old=(await c.query('SELECT object_id FROM production_batches WHERE id=$1',[supersedes])).rows[0];if(old?.object_id!==input.objectId)throw new AppError(422,'INVALID_CORRECTION','更正须引用同一对象的原批次');}
  const result=await c.query(`INSERT INTO production_batches(object_id,code,species,variety,stage,source,verified,started_at,ended_at,supersedes_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,[input.objectId,text(input.code,'批次编号',80),text(input.species,'物种',80),optionalText(input.variety,'品种',80),text(input.stage,'生长阶段',80),text(input.source,'依据',1000),input.verified===true,started,ended,supersedes,actor.id]);
  if(!result.rowCount)throw new AppError(409,'BATCH_CONFLICT','批次编号重复或原记录已经更正');
  await audit(c,actor.id,'batch_recorded',result.rows[0].id);return result.rows[0];
}
