import { readApi,writeApi } from '@/platform/api';
import { listBudgets,saveBudget } from '@/modules/operations/budget';
export function GET(request:Request){return readApi(request,listBudgets);}
export function POST(request:Request){return writeApi(request,saveBudget,201);}
