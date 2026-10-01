import type { Id,ISOTime } from '../../platform/types';
export interface ReadingInput {
  sourceId:Id;sourceRecordId:string|null;externalDeviceId:string;pointId:Id;metric:string;
  sampledAt:ISOTime|null;reportedAt:ISOTime|null;receivedAt:ISOTime;sequence:string|null;
  rawValue:string|number|null;value:number|null;unit:string;quality:'valid'|'suspect'|'invalid';
  reasons:string[];origin:'live'|'history'|'manual';rawRef:Id;mappingVersion:Id;
}
export interface IngestResult {observationId:Id|null;disposition:'inserted'|'duplicate'|'conflict'|'quarantined';eligibleForCurrent:boolean}
