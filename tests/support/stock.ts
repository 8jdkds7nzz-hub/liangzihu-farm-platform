import {randomUUID} from 'node:crypto';import type {Pool} from 'pg';import type {Actor} from '../../src/platform/types';import {transaction} from '../../src/db/pool';
import {actorFixture,permit} from './fixtures';import {recordSample,recordTest,decideQuality} from '../../src/modules/traceability/quality';
export async function releaseTestLot(pool:Pool,creator:Actor,objectId:string,lotId:string){
 const reviewer=await actorFixture(pool,'technician');await permit(pool,reviewer.id,objectId,['read','record','review','share']);
 return transaction(async c=>{
 const lot=(await c.query('SELECT * FROM stock_lots WHERE id=$1',[lotId])).rows[0],at=new Date().toISOString();
 const sample=await recordSample(c,creator,{lotId,sampleCode:randomUUID(),stage:lot.kind==='processed'?'finished':'raw',sampledAt:at,source:'合成测试样品，不是现场检测',requestKey:randomUUID()});
 const report=await recordTest(c,creator,{sampleId:sample.id,method:'合成工程断言',result:'pass',reportRef:'仅合成测试报告',testedAt:at,validUntil:new Date(Date.now()+86400000).toISOString(),requestKey:randomUUID()});
 await decideQuality(c,reviewer,{lotId,expectedVersion:lot.version,toState:'available',testIds:[report.id],credentialIds:[],evidence:'仅隔离数据库工程审核',requestKey:randomUUID()});return {reviewer,sample,report};
 },pool);
}

