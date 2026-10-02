import {requestExpertSms,verifyExpertSms,SMS_COOKIE} from '@/modules/identity/sms';
import {cookieValue} from '@/modules/identity/session';
import {assertOrigin,authResponse,endpoint,json,readJson,setCookie,textField} from '@/modules/identity/http';
export async function POST(req:Request){return endpoint(async()=>{assertOrigin(req);const b=await readJson(req);if(b.operation==='verify'){const r=authResponse(await verifyExpertSms(textField(b,'token'),cookieValue(req,SMS_COOKIE),textField(b,'code')));setCookie(r,SMS_COOKIE,'',0);return r;}const r=await requestExpertSms(textField(b,'phone')),response=json({token:r.token,message:r.message});setCookie(response,SMS_COOKIE,r.browserToken,300);return response;});}
