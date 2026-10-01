import type {PoolClient} from 'pg';
import type {Actor} from '../../platform/types';
import { AppError } from '../../platform/error';
import { text,integer,time } from '../../platform/validation';
import { uuid } from '../identity/common';
import { existingObject,scope,visible } from '../field/common';
export async function saveCalendar(c:PoolClient,a:Actor,b:Record<string,unknown>){
 const o=await existingObject(c,a,b,'configure'),name=text(b.name,'日历名称',100);if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)throw new AppError(400,'CALENDAR_ITEMS','日历包含1至100个事项');
 const items=b.items.map(v=>{const i=v as Record<string,unknown>,startDay=integer(i.startDay,'开始天数',0,1000),endDay=integer(i.endDay,'结束天数',startDay,1000);return {startDay,endDay,title:text(i.title,'事项',200),instructions:text(i.instructions,'工作说明和限制',3000)};});
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['calendar:'+o.id+':'+name]);const version=Number((await c.query('SELECT COALESCE(max(version),0) AS n FROM calendar_versions WHERE object_id=$1 AND name=$2',[o.id,name])).rows[0].n)+1;
 return (await c.query('INSERT INTO calendar_versions(object_id,name,version,species,variety,stage,source_ref,items,effective_from,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[o.id,name,version,text(b.species,'物种',100),b.variety?text(b.variety,'品种',100):null,text(b.stage,'阶段',100),text(b.sourceRef,'专业依据',2000),JSON.stringify(items),time(b.effectiveFrom),a.id])).rows[0];
}
export async function reviewCalendar(c:PoolClient,a:Actor,b:Record<string,unknown>){uuid(b.id);const r=(await c.query('SELECT * FROM calendar_versions WHERE id=$1 FOR UPDATE',[b.id])).rows[0];if(!r)throw new AppError(404,'CALENDAR_NOT_FOUND','日历不存在');await scope(c,a,r.object_id,'review','calendar',r.id);if(b.retire===true){await c.query('UPDATE calendar_versions SET retired_at=COALESCE(retired_at,now()) WHERE id=$1',[r.id]);return {id:r.id,state:'retired'};}if(r.retired_at)throw new AppError(409,'CALENDAR_RETIRED','已撤回日历不能恢复为现行版本，请新建修订');await c.query('UPDATE calendar_versions SET approved_by=$2,approved_at=COALESCE(approved_at,now()) WHERE id=$1',[r.id,a.id]);return {id:r.id,state:'approved'};}
export async function listCalendars(c:PoolClient,a:Actor){const v=await visible(c,a,'calendar');return {items:(await c.query('SELECT * FROM calendar_versions WHERE object_id=ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name,version DESC LIMIT 200',[v.objects,v.resources])).rows};}
export async function calendarWindows(c:PoolClient,a:Actor,objectId:string,at=new Date()){
 await scope(c,a,objectId,'read');const batches=(await c.query(`SELECT b.*,v.id AS calendar_id,v.version AS calendar_version,v.items,v.source_ref FROM production_batches b
 JOIN LATERAL(SELECT * FROM calendar_versions v WHERE v.object_id=b.object_id AND v.species=b.species AND v.variety IS NOT DISTINCT FROM b.variety AND v.stage=b.stage AND approved_at IS NOT NULL AND retired_at IS NULL AND effective_from<=$2 ORDER BY approved_at DESC,version DESC LIMIT 1)v ON true
 WHERE b.object_id=$1 AND b.verified AND b.started_at<=$2 AND(b.ended_at IS NULL OR b.ended_at>$2) AND NOT EXISTS(SELECT 1 FROM production_batches n WHERE n.supersedes_id=b.id)`,[objectId,at])).rows;
 return batches.flatMap(b=>b.items.filter((i:{startDay:number;endDay:number})=>{const age=Math.floor((at.getTime()-b.started_at.getTime())/86400000);return age>=i.startDay&&age<=i.endDay;}).map((i:Record<string,unknown>)=>({objectId,batchId:b.id,calendarId:b.calendar_id,calendarVersion:b.calendar_version,...i,sourceRef:b.source_ref,state:'draft',limitations:['日历窗口需技术员核对实际阶段','不自动生成用量或派单']})));
}
