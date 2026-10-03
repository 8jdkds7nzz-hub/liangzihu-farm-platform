import type {PoolClient} from 'pg';import type {Actor} from '../../platform/types';import {uuid} from '../identity/common';import {scope} from '../field/common';
export async function controlOverview(c:PoolClient,a:Actor,objectId:string){
 uuid(objectId);await scope(c,a,objectId,'read');const r:Record<string,any>={actualDispatchEnabled:false,limits:'仅控制准备与外部观测记录；未部署已联合签验的实际执行适配器'};
 for(const [name,table] of Object.entries({profiles:'control_profiles',rules:'control_rules',requests:'control_requests',feedback:'control_feedback',takeovers:'control_takeovers'}))r[name]=(await c.query('SELECT * FROM '+table+' WHERE object_id=$1 ORDER BY created_at DESC LIMIT 100',[objectId])).rows;
 r.devices=(await c.query('SELECT id,name,kind FROM devices WHERE object_id=$1 ORDER BY name LIMIT 200',[objectId])).rows;
 r.requests=r.requests.map((request:any)=>({...request,layers:['request','device_received','electrical','mechanical','effect'].map(layer=>({layer,...(r.feedback.filter((f:any)=>f.request_id===request.id&&f.layer===layer).sort((u:any,v:any)=>+v.observed_at-+u.observed_at)[0]??{result:'unknown',source:null,value:null})}))}));return r;
}

