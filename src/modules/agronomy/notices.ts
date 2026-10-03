import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {AppError} from '../../platform/error';
import {text,time,choice} from '../../platform/validation';import {uuid} from '../identity/common';import {scope} from '../field/common';import {access,request,type Body} from '../inventory/common';
export async function createNotice(c:PoolClient,a:Actor,b:Body){
 await access(c,a,b.objectId);return request(c,a,b,'agronomy.notice',b.objectId as string,async()=>{
 const published=time(b.publishedAt),from=time(b.validFrom),until=time(b.validUntil);if(until<=from||Date.parse(published)>Date.now()+60000)throw new AppError(422,'NOTICE_PERIOD','适用时段无效或发布日期在未来');
 let version=1;if(b.supersedesId){uuid(b.supersedesId);const old=(await c.query('SELECT * FROM agronomy_notices WHERE id=$1 FOR UPDATE',[b.supersedesId])).rows[0];if(old?.object_id!==b.objectId||(await c.query('SELECT 1 FROM agronomy_notices WHERE supersedes_id=$1',[b.supersedesId])).rowCount)throw new AppError(409,'NOTICE_VERSION','通知修订范围不符或原版已被修订');version=old.version+1;}
 return(await c.query('INSERT INTO agronomy_notices(object_id,title,agency,source_ref,published_at,valid_from,valid_until,crop,region,body,version,supersedes_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[b.objectId,text(b.title,'标题',200),text(b.agency,'发布机构',200),text(b.sourceRef,'原链接或文号',2000),published,from,until,text(b.crop,'适用作物',200),text(b.region,'适用区域',200),text(b.body,'通知正文',20000),version,b.supersedesId||null,a.id])).rows[0];
 });
}
export async function reviewNotice(c:PoolClient,a:Actor,b:Body){
 uuid(b.id);const r=(await c.query('SELECT * FROM agronomy_notices WHERE id=$1',[b.id])).rows[0];if(!r)throw new AppError(404,'NOTICE_NOT_FOUND','通知不存在');await scope(c,a,r.object_id,'read','agronomy_notice',r.id);await scope(c,a,r.object_id,'review','agronomy_notice',r.id);
 return request(c,a,b,'agronomy.notice-review',r.object_id,async()=>{const current=(await c.query('SELECT * FROM agronomy_notices WHERE id=$1 FOR UPDATE',[r.id])).rows[0],action=choice(b.action,['approve','withdraw'] as const,'通知操作');
 if(action==='approve'&&(current.state!=='draft'||current.created_by===a.id))throw new AppError(409,'NOTICE_REVIEW','请其他审核人员核对未审核通知');
 return(await c.query('UPDATE agronomy_notices SET state=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 WHERE id=$1 RETURNING *',[r.id,action==='approve'?'approved':'withdrawn',a.id,text(b.evidence,'来源与适用性审核',4000)])).rows[0];});
}

