import type { Pool } from 'pg';
import { actorFixture,objectFixture,permit } from './fixtures';
import { transaction } from '../../src/db/pool';
import { saveSource,saveDevice } from '../../src/modules/registry/devices';
import { savePoint,bindPoint } from '../../src/modules/registry/points';
import type { ReadingInput } from '../../src/modules/telemetry/types';
export async function telemetryFixture(pool:Pool){
  const actor=await actorFixture(pool,'technician'),objectId=await objectFixture(pool,actor.id);await permit(pool,actor.id,objectId,['read','configure','review','claim','record','close_alert','export']);
  const at=new Date('2026-10-01T00:00:10Z');
  return transaction(async c=>{
    const source=await saveSource(c,actor,{objectId,code:'SYNTH-S',name:'合成测试来源',provider:'synthetic'});
    const device=await saveDevice(c,actor,{objectId,sourceId:source.id,externalId:'D1',name:'合成测试设备',kind:'physical',source:'仅测试'});
    const point=await savePoint(c,actor,{deviceId:device.id,code:'SYNTH-P',name:'合成测试测点',metric:'synthetic_metric',unit:'test_unit',maxAgeMs:60_000,maxGapMs:30_000,timingSource:'合成时效参数，非农场阈值'});
    const binding=await bindPoint(c,actor,{pointId:point.id,objectId,validFrom:'2026-09-01T00:00:00Z',verified:true,evidence:'仅测试绑定'});
    const reading:Omit<ReadingInput,'rawRef'>={sourceId:source.id,sourceRecordId:'r1',externalDeviceId:'D1',pointId:point.id,metric:'synthetic_metric',sampledAt:'2026-10-01T00:00:00Z',reportedAt:null,receivedAt:at.toISOString(),sequence:null,rawValue:0,value:0,unit:'test_unit',quality:'valid',reasons:[],origin:'live',mappingVersion:binding.id};
    return {actor,objectId,source,device,point,binding,reading,at};
  },pool);
}
