import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {withDb} from '../support/db';import {actorFixture,objectFixture,permit} from '../support/fixtures';import {releaseTestLot} from '../support/stock';
import {transaction,database} from '../../src/db/pool';
import {registerEnergyMeter,reviewEnergyMeter,recordEnergyReading,energySummary} from '../../src/modules/energy/service';
import {registerCircularBatch,receiveCircularMaterial,processCircularMaterial} from '../../src/modules/circular/service';
import {createLot,createLocation} from '../../src/modules/inventory/catalog';import {balance} from '../../src/modules/inventory/ledger';
import {circularOverview} from '../../src/modules/circular/queries';
const key=()=>randomUUID();
async function fixture(pool:any){const a=await actorFixture(pool,'technician'),reviewer=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,a.id);for(const u of [a,reviewer])await permit(pool,u.id,objectId,['read','record','review','configure','export']);
 const deviceId=key(),sourceId=key();await pool.query("INSERT INTO data_sources(id,object_id,code,name,provider,created_by) VALUES($1,$2,$3,'合成能源来源','synthetic',$4)",[sourceId,objectId,key(),a.id]);await pool.query("INSERT INTO devices(id,object_id,source_id,external_id,name,kind,source,verified,created_by) VALUES($1,$2,$3,'meter','合成电表','physical','隔离测试',true,$4)",[deviceId,objectId,sourceId,a.id]);
 const tx=<T>(fn:(c:PoolClient)=>Promise<T>)=>transaction(fn,pool);return{a,reviewer,objectId,deviceId,tx};}
test('A41/A42 独立核实、实际差分、重置与更正、撤回和跨对象拒绝',()=>withDb(async pool=>{
 const f=await fixture(pool),input={objectId:f.objectId,deviceId:f.deviceId,name:'合成负载表',purpose:'load',capacityKwh:null,maxGapSeconds:7200,sourceRef:'工程测试倍率1',requestKey:key()};
 const meter=await f.tx((c:any)=>registerEnergyMeter(c,f.a,input));assert.equal((await f.tx((c:any)=>registerEnergyMeter(c,f.a,input))).id,meter.id);
 await assert.rejects(()=>f.tx((c:any)=>reviewEnergyMeter(c,f.a,{id:meter.id,action:'approve',evidence:'自审',requestKey:key()})),{code:'INDEPENDENT_REVIEW'});
 await f.tx((c:any)=>reviewEnergyMeter(c,f.reviewer,{id:meter.id,action:'approve',evidence:'仅合成核实',requestKey:key()}));
 const from='2026-10-03T00:00:00Z',to='2026-10-03T01:00:00Z';
 const r=await f.tx((c:any)=>recordEnergyReading(c,f.a,{meterId:meter.id,metric:'consumption_kwh',value:'100',observedAt:from,quality:'valid',sourceKind:'manual',evidence:'合成100',requestKey:key()}));
 const second=await f.tx((c:any)=>recordEnergyReading(c,f.a,{meterId:meter.id,metric:'consumption_kwh',value:'112',observedAt:to,quality:'valid',sourceKind:'manual',evidence:'合成112',requestKey:key()}));
 let result=await database(c=>energySummary(c,f.a,{meterId:meter.id,metric:'consumption_kwh',fromAt:from,toAt:to}),pool);assert.equal(result.energyKwh,'12');assert.equal(result.complete,true);
 await assert.rejects(()=>f.tx((c:any)=>recordEnergyReading(c,f.a,{meterId:meter.id,metric:'soc_pct',value:'101',observedAt:to,quality:'valid',sourceKind:'manual',evidence:'错误SOC',requestKey:key()})),{code:'ENERGY_RANGE'});
 await f.tx((c:any)=>recordEnergyReading(c,f.a,{meterId:meter.id,metric:'consumption_kwh',value:'2',observedAt:to,quality:'valid',reset:true,supersedesId:second.id,sourceKind:'manual',evidence:'合成复位更正',requestKey:key()}));
 result=await database(c=>energySummary(c,f.a,{meterId:meter.id,metric:'consumption_kwh',fromAt:from,toAt:to}),pool);assert.equal(result.energyKwh,null);assert.equal(result.complete,false);assert.equal((await pool.query('SELECT value FROM energy_readings WHERE id=$1',[r.id])).rows[0].value,'100.000000');
 await f.tx((c:any)=>reviewEnergyMeter(c,f.reviewer,{id:meter.id,action:'withdraw',evidence:'核实撤回',requestKey:key()}));
 assert.equal((await database(c=>energySummary(c,f.a,{meterId:meter.id,metric:'consumption_kwh',fromAt:from,toAt:to}),pool)).complete,false);
 const stranger=await actorFixture(pool,'technician');await assert.rejects(()=>database(c=>energySummary(c,stranger,{meterId:meter.id,metric:'consumption_kwh',fromAt:from,toAt:to}),pool));
}));
test('A43/A44/A45 循环称量同事务防重、实际库存转换和返料谱系',()=>withDb(async pool=>{
 const f=await fixture(pool),location=await f.tx((c:any)=>createLocation(c,f.a,{objectId:f.objectId,code:'CIRC-W',name:'合成物料仓',requestKey:key()}));
 async function batch(code:string){const lot=await f.tx((c:any)=>createLot(c,f.a,{objectId:f.objectId,code,product:'合成循环物料',kind:'input',unit:'kg',basis:'wet',source:'合成测试',requestKey:key()}));await f.tx((c:any)=>registerCircularBatch(c,f.a,{lotId:lot.id,materialKind:'compost',originRef:'仅测试来源批',requestKey:key()}));return lot;}
 const input=await batch(key()),out=await batch(key()),returned=await batch(key());
 const body={lotId:input.id,locationId:location.id,grossKg:'12',tareKg:'2',netKg:'10',moisturePct:'40',basis:'wet',voucher:'WEIGH-TEST',occurredAt:'2026-10-03T00:00:00Z',evidence:'合成秤单',requestKey:key()};
 const receipt=await f.tx((c:any)=>receiveCircularMaterial(c,f.a,body));assert.equal(receipt.dryKg,'6');assert.equal((await f.tx((c:any)=>receiveCircularMaterial(c,f.a,body))).id,receipt.id);
 await assert.rejects(()=>f.tx((c:any)=>receiveCircularMaterial(c,f.a,{...body,netKg:'9',requestKey:key(),voucher:'BAD'})),{code:'WEIGHING_BALANCE'});
 assert.equal(await database(c=>balance(c,input.id,location.id),pool),'10');await releaseTestLot(pool,f.a,f.objectId,input.id);
 const step={objectId:f.objectId,code:'PROCESS-CIRC',processKind:'screening',inputs:[{lotId:input.id,locationId:location.id,quantity:'10'}],outputs:[{lotId:out.id,locationId:location.id,quantity:'8'},{lotId:returned.id,locationId:location.id,quantity:'1'}],occurredAt:body.occurredAt,evidence:'合成筛分',reason:'1kg合成损耗',requestKey:key()};
 const process=await f.tx((c:any)=>processCircularMaterial(c,f.a,step));assert.equal(process.difference,'1');assert.equal(await database(c=>balance(c,out.id,location.id),pool),'8');
 const overview=await database(c=>circularOverview(c,f.a,f.objectId),pool);assert.equal(overview.batches.length,3);assert.equal(overview.processes.length,1);assert.equal(overview.batches.find((b:any)=>b.lot_id===out.id).state,'pending');
 await assert.rejects(()=>pool.query('UPDATE circular_weighings SET net_kg=99'));
}));
