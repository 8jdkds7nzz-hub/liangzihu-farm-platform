import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {uuid} from '../identity/common';import {scope} from '../field/common';import {AppError} from '../../platform/error';
export async function agronomyOverview(c:PoolClient,a:Actor,objectId:string){
 uuid(objectId);await scope(c,a,objectId,'read');const r:Record<string,any>={limit:100,evaluationEnabled:process.env.CROP_MODEL_EVALUATION_ENABLED==='1'};
 for(const [name,table] of Object.entries({crops:'crop_analyses',labels:'crop_labels',spectral:'spectral_products',schedules:'crop_schedules',captures:'crop_capture_runs',flows:'flow_observations'}))r[name]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 r.notices=(await c.query("SELECT n.*,state='approved' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM agronomy_notices newer WHERE newer.supersedes_id=n.id) AS current FROM agronomy_notices n WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100",[objectId])).rows;
 r.media=(await c.query("SELECT id,name,mime,captured_at FROM media_assets WHERE object_id=$1 AND ingest_state='complete' AND mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 200",[objectId])).rows;
 r.devices=(await c.query('SELECT id,name,kind FROM devices WHERE object_id=$1 ORDER BY name LIMIT 200',[objectId])).rows;
 const latest=new Map<string,any>();for(const l of r.labels)if(!latest.has(l.analysis_id))latest.set(l.analysis_id,l);
 const evaluated=r.crops.filter((x:any)=>x.result?.candidates?.length&&latest.has(x.id)&&latest.get(x.id).label!=='unknown'&&latest.get(x.id).created_by!==x.created_by),matches=evaluated.filter((x:any)=>[...x.result.candidates].sort((u:any,v:any)=>v.score-u.score)[0].label===latest.get(x.id).label).length;
 r.evaluation={independentlyLabelled:evaluated.length,matches,agreement:evaluated.length?matches/evaluated.length:null,fieldValidated:false,scope:'仅当前载入的最近100条分析及标注；不是现场准确率或模型通过结论'};
 return r;
}
const resources={crop:['crop_analyses','crop_analysis'],spectral:['spectral_products','spectral_product'],notice:['agronomy_notices','agronomy_notice']} as const;
export async function agronomyDetail(c:PoolClient,a:Actor,kind:keyof typeof resources,id:string){uuid(id);const [table,type]=resources[kind],r=(await c.query('SELECT * FROM '+table+' WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,'AGRONOMY_NOT_FOUND','资料不存在');await scope(c,a,r.object_id,'read',type,r.id);return r;}

