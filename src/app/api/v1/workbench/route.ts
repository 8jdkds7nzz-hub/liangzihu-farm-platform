import {readApi} from '@/platform/api';import {workbench} from '@/modules/workbench/service';
export const GET=(r:Request)=>readApi(r,workbench);
