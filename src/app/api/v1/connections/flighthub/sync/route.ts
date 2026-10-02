import {writeApi} from '@/platform/api';import {requestDjiSync} from '@/modules/connections/flighthub';export const POST=(r:Request)=>writeApi(r,requestDjiSync);
