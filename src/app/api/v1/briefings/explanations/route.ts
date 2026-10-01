import {writeApi} from '@/platform/api';import {requestBriefingExplanation} from '@/modules/briefings/service';export const POST=(r:Request)=>writeApi(r,requestBriefingExplanation);
