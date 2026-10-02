import {readApi,writeApi} from '@/platform/api';import {saveSchedule,listSchedules} from '@/modules/briefings/schedule';export const POST=(r:Request)=>writeApi(r,saveSchedule);

export const GET=(r:Request)=>readApi(r,listSchedules);
