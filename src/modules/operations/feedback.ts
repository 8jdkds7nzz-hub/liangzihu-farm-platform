import type { PoolClient } from 'pg';
import type { Actor } from '../../platform/types';
import { AppError } from '../../platform/error';
import { choice,text } from '../../platform/validation';
import { assertAccess,listAccessibleObjects,roleActions } from '../identity/access';
import { uuid } from '../identity/common';

export async function createFeedback(c:PoolClient,actor:Actor,b:Record<string,unknown>){
  uuid(b.objectId);await assertAccess(c,actor,{objectId:b.objectId,action:'read',at:new Date().toISOString()});
  const title=text(b.title,'问题标题',120),description=text(b.description,'问题说明',2000),page=text(b.pagePath,'发生页面',300),key=text(b.requestKey,'请求标识',100);
  if(!/^\/[a-zA-Z0-9/_-]*$/.test(page))throw new AppError(400,'INVALID_PAGE','页面只记录站内路径，不含查询参数、地址令牌或外部网址');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['feedback-create:'+actor.id+':'+key]);
  const previous=(await c.query('SELECT * FROM feedback_items WHERE created_by=$1 AND request_key=$2',[actor.id,key])).rows[0];
  if(previous){if(previous.object_id!==b.objectId||previous.title!==title||previous.description!==description||previous.page_path!==page)throw new AppError(409,'REQUEST_KEY_CONFLICT','反馈标识对应内容不同');return {id:previous.id};}
  const row=(await c.query('INSERT INTO feedback_items(object_id,title,description,page_path,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.objectId,title,description,page,actor.id,key])).rows[0];
  await c.query("INSERT INTO feedback_events(feedback_id,actor_id,state,note,request_key) VALUES($1,$2,'open','提交问题',$3)",[row.id,actor.id,key]);return row;
}
export async function updateFeedback(c:PoolClient,actor:Actor,b:Record<string,unknown>){
  uuid(b.id);const row=(await c.query('SELECT * FROM feedback_items WHERE id=$1 FOR UPDATE',[b.id])).rows[0];if(!row)throw new AppError(404,'FEEDBACK_NOT_FOUND','反馈不存在');
  await assertAccess(c,actor,{objectId:row.object_id,action:'read',at:new Date().toISOString()});await assertAccess(c,actor,{objectId:row.object_id,action:'configure',at:new Date().toISOString()});
  const state=choice(b.state,['triaged','resolved'] as const,'处理状态'),note=text(b.note,'处理说明',2000),key=text(b.requestKey,'请求标识',100);
  const previous=(await c.query('SELECT * FROM feedback_events WHERE actor_id=$1 AND request_key=$2',[actor.id,key])).rows[0];
  if(previous){if(previous.feedback_id!==b.id||previous.state!==state||previous.note!==note)throw new AppError(409,'REQUEST_KEY_CONFLICT','处理标识对应内容不同');return {id:b.id,state:row.state};}
  if(row.state==='resolved')throw new AppError(409,'FEEDBACK_RESOLVED','反馈已处理，请重新登记新的问题');
  await c.query('UPDATE feedback_items SET state=$2 WHERE id=$1',[b.id,state]);await c.query('INSERT INTO feedback_events(feedback_id,actor_id,state,note,request_key) VALUES($1,$2,$3,$4,$5)',[b.id,actor.id,state,note,key]);return {id:b.id,state};
}
export async function listFeedback(c:PoolClient,actor:Actor){
  const readable=await listAccessibleObjects(c,actor,'read'),configurable=roleActions[actor.role].includes('configure')?await listAccessibleObjects(c,actor,'configure'):[];
  const params=[readable,actor.id,configurable],where='f.object_id=ANY($1::uuid[]) AND (f.created_by=$2 OR f.object_id=ANY($3::uuid[]))';
  const items=(await c.query(`SELECT f.*,o.name AS object_name,u.display_name AS reporter_name FROM feedback_items f JOIN objects o ON o.id=f.object_id JOIN users u ON u.id=f.created_by WHERE ${where} ORDER BY f.created_at DESC LIMIT 200`,params)).rows;
  const counts=(await c.query(`SELECT f.state,count(*)::integer AS count FROM feedback_items f WHERE ${where} GROUP BY f.state`,params)).rows;
  const events=(await c.query('SELECT e.*,u.display_name AS actor_name FROM feedback_events e JOIN users u ON u.id=e.actor_id WHERE e.feedback_id=ANY($1::uuid[]) ORDER BY e.occurred_at,e.id',[items.map(i=>i.id)])).rows;
  return {items,counts,events};
}
