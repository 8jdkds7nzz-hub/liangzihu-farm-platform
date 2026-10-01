import { database } from '@/db/pool';
import { endpoint,json } from '@/modules/identity/http';
import { authorizeHealth,readiness } from '@/modules/operations/heartbeat';
export function GET(request:Request){return endpoint(async()=>{authorizeHealth(request);return database(async c=>{const report=await readiness(c);return json(report,report.ready?200:503);});});}
