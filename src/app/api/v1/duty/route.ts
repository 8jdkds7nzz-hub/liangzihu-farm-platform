import { readApi,writeApi } from '@/platform/api';
import { saveRoster,listRosters,cancelRoster } from '@/modules/notifications/rosters';
import { text } from '@/platform/validation';
export function GET(request:Request){return readApi(request,listRosters);}
export function POST(request:Request){return writeApi(request,saveRoster,201);}
export function DELETE(request:Request){return writeApi(request,(c,a,b)=>cancelRoster(c,a,text(b.id,'值班编号')));}
