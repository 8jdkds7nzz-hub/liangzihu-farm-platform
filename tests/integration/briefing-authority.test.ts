import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withDb} from '../support/db';
import {actorFixture,objectFixture,permit} from '../support/fixtures';
import {telemetryFixture} from '../support/telemetry';
import {transaction,database} from '../../src/db/pool';
import * as briefings from '../../src/modules/briefings/service';
import {saveDefinition,reviewDefinition} from '../../src/modules/analysis/service';
import {requestAssistant,runAssistant,listAssistant,runReadTool} from '../../src/modules/assistant/service';

test('T04已撤回指标不进入新简报/工具，旧回答标失效；跨期指标不冒充当期',()=>withDb(async pool=>{
 const f=await telemetryFixture(pool),from='2026-10-01T00:00:00Z',to='2026-10-01T01:00:00Z',def=await transaction(c=>saveDefinition(c,f.actor,{objectId:f.objectId,pointId:f.point.id,name:'合成均值',sourceRef:'仅工程测试',specification:{formula:'mean',inputUnit:'test_unit',unit:'test_unit',intervalMs:60000,maxGapMs:120000,minimumCoverage:.9,timezone:'UTC'}}),pool);await transaction(c=>reviewDefinition(c,f.actor,{id:def.id}),pool);
 const metric=(await pool.query("INSERT INTO metric_results(object_id,definition_id,definition_version,window_start,window_end,value,unit,status,coverage,limitations,evidence_ids,input_hash,version) VALUES($1,$2,1,$3,$4,1,'test_unit','usable',1,'[]','{}',$5,1) RETURNING id",[f.objectId,def.id,from,to,'a'.repeat(64)])).rows[0];
 const request=await transaction(c=>requestAssistant(c,f.actor,{objectIds:[f.objectId],question:'均值是多少',requestKey:randomUUID()}),pool);await runAssistant(pool,request.id,undefined,async()=>[[1,...Array(511).fill(0)]]);
 const make=(end:string)=>transaction(c=>briefings.createBriefing(c,f.actor,{objectIds:[f.objectId],period:'daily',from,to:end,requestKey:randomUUID()}),pool);
 const partial=await make('2026-10-01T00:30:00Z');assert.equal((await pool.query("SELECT count(*) FROM briefing_items WHERE briefing_id=$1 AND kind='metric'",[partial.id])).rows[0].count,'0');
 await transaction(c=>reviewDefinition(c,f.actor,{id:def.id,retire:true}),pool);
 const fresh=await make(to);assert.equal((await pool.query("SELECT count(*) FROM briefing_items WHERE briefing_id=$1 AND kind='metric'",[fresh.id])).rows[0].count,'0');
 assert.equal((await database(c=>listAssistant(c,f.actor),pool)).items[0].result.sourceInactive,true);
 assert.equal((await database(c=>runReadTool(c,f.actor,'metrics',{objectId:f.objectId}),pool) as any[]).some(r=>r.id===metric.id),false);
}));
test('T05分版内容/全部审阅/普通角色撤回/专家直接事项授权同步失效',()=>withDb(async pool=>{
 const tech=await actorFixture(pool,'technician'),owner=await actorFixture(pool,'owner'),worker=await actorFixture(pool,'worker'),expert=await actorFixture(pool,'expert'),objectId=await objectFixture(pool,tech.id);await permit(pool,tech.id,objectId,['read','record','review','share']);for(const a of [owner,worker,expert])await permit(pool,a.id,objectId,['read']);
 const b=await transaction(c=>briefings.createBriefing(c,tech,{objectIds:[objectId],period:'daily',from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',requestKey:randomUUID()}),pool),items=(await pool.query('SELECT * FROM briefing_items WHERE briefing_id=$1 ORDER BY id',[b.id])).rows;
 for(const i of items)await transaction(c=>briefings.reviewItem(c,tech,{id:i.id,version:i.version,decision:'adopted',reason:'合成核查',requestKey:randomUUID()}),pool);
 assert.equal((await pool.query('SELECT state FROM briefings WHERE id=$1',[b.id])).rows[0].state,'reviewed');
 const publish=(recipientId:string)=>transaction(c=>briefings.publishBriefing(c,tech,{briefingId:b.id,itemIds:items.map(i=>i.id),recipientId,confirm:true,expiresAt:new Date(Date.now()+3600000).toISOString(),requestKey:randomUUID()}),pool);
 const po=await publish(owner.id),pw=await publish(worker.id),pe=await publish(expert.id);
 const so=await database(c=>briefings.readPublication(c,owner,po.id),pool),sw=await database(c=>briefings.readPublication(c,worker,pw.id),pool);assert.notDeepEqual(so.items,sw.items);assert(so.items.every((i:any)=>i.limitations.length));assert(sw.items.every((i:any)=>i.limitations.length&&i.dispatchState==='not_dispatched'));
 await assert.rejects(()=>transaction(c=>Reflect.get(briefings,'revokePublication')(c,worker,{id:pw.id,reason:'无权测试'}),pool),{status:403});
 for(const p of [po,pw,pe])await transaction(c=>Reflect.get(briefings,'revokePublication')(c,tech,{id:p.id,reason:'合成撤回'}),pool);
 await assert.rejects(()=>database(c=>briefings.readPublication(c,owner,po.id),pool),{code:'PUBLICATION_SCOPE'});await assert.rejects(()=>database(c=>briefings.readPublication(c,worker,pw.id),pool),{code:'PUBLICATION_SCOPE'});
 assert.equal((await pool.query("SELECT count(*) FROM resource_grants WHERE user_id=$1 AND resource_type='briefing_item' AND revoked_at IS NULL",[expert.id])).rows[0].count,'0');
}));
