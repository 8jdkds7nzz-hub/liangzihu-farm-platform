import {writeApi} from '@/platform/api';import {saveSurvey} from '@/modules/terrain/survey';export const POST=(r:Request)=>writeApi(r,saveSurvey);
