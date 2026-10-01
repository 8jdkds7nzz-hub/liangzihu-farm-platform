import {writeApi} from '@/platform/api';import {saveSchedule} from '@/modules/briefings/schedule';export const POST=(r:Request)=>writeApi(r,saveSchedule);
