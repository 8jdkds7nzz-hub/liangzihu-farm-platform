import {readApi,writeApi} from '@/platform/api';import {saveComparison,reviewComparison,calculateComparison,listComparisons} from '@/modules/analysis/comparisons';
export const GET=(r:Request)=>readApi(r,listComparisons);
export const POST=(r:Request)=>writeApi(r,(c,a,b)=>b.operation==='define'?saveComparison(c,a,b):calculateComparison(c,a,b));
export const PATCH=(r:Request)=>writeApi(r,reviewComparison);
