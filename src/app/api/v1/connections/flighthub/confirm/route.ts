import {writeApi} from '@/platform/api';import {confirmDjiFlight} from '@/modules/connections/flighthub';export const POST=(r:Request)=>writeApi(r,confirmDjiFlight);
