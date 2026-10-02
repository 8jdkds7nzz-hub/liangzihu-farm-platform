import {writeApi} from '@/platform/api';import {requestDjiFile} from '@/modules/connections/flighthub';export const POST=(r:Request)=>writeApi(r,requestDjiFile);
