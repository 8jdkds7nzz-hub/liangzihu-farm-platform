import type {PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import {AppError} from '../../platform/error';
import {listAccessibleObjects} from './access';
import {requireAdmin} from './management';
import {uuid} from './common';

export async function referenceOptions(c:PoolClient,a:Actor,kind:string,objectId?:string){
  if(!['object','device','point','person'].includes(kind))throw new AppError(400,'REFERENCE_KIND','选择项类别无效');
  let objects=await listAccessibleObjects(c,a,'read');
  if(a.role==='expert')objects=(await c.query('SELECT DISTINCT object_id FROM resource_grants WHERE user_id=$1 AND object_id=ANY($2::uuid[]) AND revoked_at IS NULL AND expires_at>now()',[a.id,objects])).rows.map(r=>r.object_id);
  if(objectId){uuid(objectId);if(!objects.includes(objectId))throw new AppError(403,'ACCESS_DENIED','对象不在当前授权范围');objects=[objectId];}
  let items;
  if(kind==='person'){
    if(a.role==='admin'){await requireAdmin(c,a);items=(await c.query('SELECT id,display_name AS name,role FROM users WHERE enabled ORDER BY display_name,id LIMIT 201')).rows;}
    else{const available:string[]=[];for(const action of ['dispatch','share','configure'] as const)available.push(...await listAccessibleObjects(c,a,action));const allowed=[...new Set(available)].filter(id=>objects.includes(id));
      if(!allowed.length)throw new AppError(403,'PERSON_SELECTION_DENIED','当前没有派单、分享或人员配置资格');
      items=(await c.query(`SELECT DISTINCT u.id,u.display_name AS name,u.role FROM users u JOIN grants g ON g.user_id=u.id WHERE u.enabled AND g.object_id=ANY($1::uuid[]) AND g.action='read' AND g.revoked_at IS NULL AND g.starts_at<=now() AND(g.expires_at IS NULL OR g.expires_at>now()) ORDER BY name,id LIMIT 201`,[allowed])).rows;}
  }else if(kind==='object')items=(await c.query('SELECT id,name,code FROM objects WHERE id=ANY($1::uuid[]) ORDER BY code,id LIMIT 201',[objects])).rows;
  else if(a.role==='expert')throw new AppError(403,'EXPERT_ITEM_ONLY','专家从明确分享的资料选择设备和测点');
  else if(kind==='device')items=(await c.query('SELECT d.id,d.name,o.name AS context,d.external_id AS code FROM devices d JOIN objects o ON o.id=d.object_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY d.name,d.id LIMIT 201',[objects])).rows;
  else items=(await c.query('SELECT p.id,p.name,o.name AS context,p.code FROM points p JOIN devices d ON d.id=p.device_id JOIN objects o ON o.id=d.object_id WHERE d.object_id=ANY($1::uuid[]) ORDER BY p.name,p.id LIMIT 201',[objects])).rows;
  return {items:items.slice(0,200),limited:items.length>200};
}
