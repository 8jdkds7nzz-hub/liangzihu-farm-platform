import {writeApi} from '@/platform/api';
import {confirmModelReceipt} from '@/modules/assistant/receipts';
export const POST=(r:Request)=>writeApi(r,confirmModelReceipt);
