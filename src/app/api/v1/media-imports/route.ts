import {readApi,writeApi} from '@/platform/api';
import {listRemoteImports,requestRemoteImport} from '@/modules/media/remote-import';
export const GET=(r:Request)=>readApi(r,listRemoteImports);
export const POST=(r:Request)=>writeApi(r,requestRemoteImport);
