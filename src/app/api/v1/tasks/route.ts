import {readApi,writeApi} from '@/platform/api';
import {listTasks,createTask,transitionTask} from '@/modules/tasks/service';
const handlers={GET:(r)=>readApi(r,listTasks),POST:(r)=>writeApi(r,createTask),PATCH:(r)=>writeApi(r,transitionTask)} satisfies Record<string,(r:Request)=>Promise<Response>>;
export const GET=handlers.GET;
export const POST=handlers.POST;
export const PATCH=handlers.PATCH;
