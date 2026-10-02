import {readApi} from '@/platform/api';import {referenceOptions} from '@/modules/identity/references';
export const GET=(r:Request)=>{const q=new URL(r.url).searchParams;return readApi(r,(c,a)=>referenceOptions(c,a,q.get('kind')??'',q.get('objectId')??undefined));};
