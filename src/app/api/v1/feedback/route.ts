import { readApi,writeApi } from '@/platform/api';
import { createFeedback,listFeedback,updateFeedback } from '@/modules/operations/feedback';
export function GET(request:Request){return readApi(request,listFeedback);}
export function POST(request:Request){return writeApi(request,createFeedback,201);}
export function PATCH(request:Request){return writeApi(request,updateFeedback);}
