export interface RenkeContract {
  version:string;reference:string;verified:boolean;synthetic:boolean;sourceId:string;
  rowsPath:string;deviceIdPath:string;recordIdPath:string|null;sampledAtPath:string;reportedAtPath:string|null;
  timeFormat:'iso'|'unix_seconds'|'unix_milliseconds';statusPath:string;validStatuses:(string|number)[];offlineStatuses:(string|number)[];
  metrics:{metric:string;valuePath:string;sourceUnit:string;unit:string;scale:number;offset:number}[];
  mappings:{externalDeviceId:string;metric:string;pointId:string;bindingId?:string}[];
}
