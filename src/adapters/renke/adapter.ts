import { AppError } from '../../platform/error';
import { time } from '../../platform/validation';
import type { ReadingInput } from '../../modules/telemetry/types';
import type { RenkeContract } from './contract';
function field(value:unknown,path:string):unknown {
  if(path==='')return value;let current=value;
  for(const key of path.split('.')){if(!current||typeof current!=='object'||!Object.hasOwn(current,key))return undefined;current=(current as Record<string,unknown>)[key];}
  return current;
}
function timestamp(value:unknown,format:RenkeContract['timeFormat']):string|null {
  if(value===undefined||value===null||value==='')return null;
  if(format==='iso'){try{return time(value);}catch{return null;}}
  if(typeof value!=='number'||!Number.isFinite(value))return null;
  const date=new Date(value*(format==='unix_seconds'?1000:1));return Number.isFinite(date.getTime())?date.toISOString():null;
}
export function normalizeRenke(raw:unknown,contract:RenkeContract,receivedAt:string,mode:'real'|'synthetic'='real'):ReadingInput[]{
  time(receivedAt);
  if(!contract.reference||!contract.version||!contract.verified||(contract.synthetic&&mode!=='synthetic'))throw new AppError(503,'RENKE_CONTRACT_NOT_READY','仁科字段与真实样本尚未核实，真实接入未开放');
  const rows=field(raw,contract.rowsPath);if(!Array.isArray(rows)||rows.length>1000)throw new AppError(422,'INVALID_VENDOR_BODY','报文记录列表不符已登记契约');
  const result:ReadingInput[]=[];
  for(const row of rows){
    const external=field(row,contract.deviceIdPath);if(typeof external!=='string')throw new AppError(422,'INVALID_DEVICE_ID','厂家编号不符契约');
    for(const m of contract.metrics){
      if(!Number.isFinite(m.scale)||!Number.isFinite(m.offset))throw new AppError(422,'INVALID_CONVERSION','单位换算参数未经核实');
      const mapping=contract.mappings.find(x=>x.externalDeviceId===external&&x.metric===m.metric);if(!mapping)throw new AppError(422,'UNMAPPED_DEVICE','真实设备与测点映射尚未核实');
      const rawValue=field(row,m.valuePath),status=field(row,contract.statusPath),sampledAt=timestamp(field(row,contract.sampledAtPath),contract.timeFormat);
      const reasons:string[]=[];let quality:ReadingInput['quality']='valid';
      if(!contract.validStatuses.includes(status as string|number)){quality='invalid';reasons.push(contract.offlineStatuses.includes(status as string|number)?'offline':'unknown_vendor_status');}
      const numeric=typeof rawValue==='number'?rawValue:typeof rawValue==='string'&&rawValue.trim()!==''?Number(rawValue):NaN;
      let value=Number.isFinite(numeric)?numeric*m.scale+m.offset:null;
      if(value===null||!Number.isFinite(value)){value=null;quality='invalid';reasons.push('invalid_number');}
      if(quality==='invalid')value=null;
      if(!sampledAt){if(quality==='valid')quality='suspect';reasons.push('unknown_sample_time');}
      const recordId=contract.recordIdPath?field(row,contract.recordIdPath):null;
      result.push({sourceId:contract.sourceId,sourceRecordId:typeof recordId==='string'?recordId:null,externalDeviceId:external,pointId:mapping.pointId,metric:m.metric,
        sampledAt,reportedAt:contract.reportedAtPath?timestamp(field(row,contract.reportedAtPath),contract.timeFormat):null,receivedAt,sequence:null,
        rawValue:typeof rawValue==='number'||typeof rawValue==='string'?rawValue:null,value,unit:m.unit,quality,reasons,origin:'live',rawRef:'',mappingVersion:mapping.bindingId});
    }
  }
  return result;
}
