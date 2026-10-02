import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {AppError} from '../../platform/error';
import {canonicalJson} from '../../platform/json';
export const EZVIZ_WEBHOOK_CONTRACT='ezviz-webhook-help5130-2026-10-02';
export interface Message{header:Record<string,unknown>;body:Record<string,unknown>}
const failure=(code:string)=>new AppError(422,code,'厂家消息尚未通过校验，请核对签名、时间、格式和已确认契约');
const string=(v:unknown,max=200)=>{if(typeof v!=='string'||!v||v.length>max)throw failure('EZVIZ_MESSAGE');return v;};
const secretFields=new Set(['checksum','password','accesstoken','refreshtoken','appsecret','authorization','apikey','secret','secretkey','clientsecret']);
function redact(v:unknown,depth=0):unknown{if(depth>20)throw failure('EZVIZ_MESSAGE');if(Array.isArray(v))return v.map(x=>redact(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!secretFields.has(k.toLowerCase().replace(/[_-]/g,''))).map(([k,x])=>[k,redact(x,depth+1)]));return v;}
export function verifyWebhook(raw:Buffer,headers:Headers,secret:string,at=new Date()){
 if(raw.length>262144)throw new AppError(413,'EZVIZ_BODY_LIMIT','厂家消息超过256KiB上限');
 if(!/^[A-Za-z0-9]{16,64}$/.test(secret))throw new AppError(503,'EZVIZ_NOT_CONFIGURED','厂家签名密钥未配置');
 const t=headers.get('t')??'',signature=headers.get('Signature')??'';if(!/^\d{13}$/.test(t)||!/^[a-f0-9]{40}$/i.test(signature))throw new AppError(401,'EZVIZ_SIGNATURE','厂家消息签名校验失败');
 if(Math.abs(Number(t)-at.getTime())>300000)throw new AppError(401,'EZVIZ_SIGNATURE_TIME','厂家签名时间过期或时钟偏差超限');
 const expected=createHmac('sha1',secret).update(raw).update(t).digest();if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new AppError(401,'EZVIZ_SIGNATURE','厂家消息签名校验失败');
 let parsed:Message;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw failure('EZVIZ_MESSAGE');}
 if(!parsed||!parsed.header||Array.isArray(parsed.header)||typeof parsed.header!=='object'||!parsed.body||typeof parsed.body!=='object'||Array.isArray(parsed.body))throw failure('EZVIZ_MESSAGE');
 string(parsed.header.messageId);string(parsed.header.deviceId,120);string(parsed.header.type,100);
 const message=redact(parsed) as Message;return {message,rawHash:createHash('sha256').update(raw).digest('hex'),contentHash:createHash('sha256').update(canonicalJson(message)).digest('hex'),signatureTime:new Date(Number(t)).toISOString()};
}
function eventTime(v:unknown,offset:number){
 if(typeof v!=='string'||!Number.isInteger(offset)||Math.abs(offset)>840)throw failure('EZVIZ_ALARM_TIME');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(v);if(!m)throw failure('EZVIZ_ALARM_TIME');
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),millis=Number((m[7]??'').padEnd(3,'0')),base=Date.UTC(year,month-1,day,hour,minute,second,millis),d=new Date(base);
 if(year<1970||d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day||hour>23||minute>59||second>59)throw failure('EZVIZ_ALARM_TIME');
 let zone=offset;if(m[8]==='Z')zone=0;else if(m[8]){const h=Number(m[8].slice(1,3)),min=Number(m[8].slice(4,6));if(h>14||min>59||h===14&&min!==0)throw failure('EZVIZ_ALARM_TIME');zone=(m[8][0]==='-'?-1:1)*(h*60+min);}return new Date(base-zone*60000).toISOString();
}
export type AlarmResult={kind:'pending';reason:string}|{kind:'alarm';alarmId:string;deviceSerial:string;channel:number;occurredAt:string;eventType:string;pictures:{id:string;url:string;plaintext:boolean}[]};
export function normalizeAlarm(m:Message,offset:number):AlarmResult{
 if(m.header.type!=='ys.alarm')return {kind:'pending',reason:m.header.type==='ys.open.isapi'?'EZVIZ_ISAPI_CONTRACT':'EZVIZ_MESSAGE_TYPE'};
 try{
 const b=m.body,serial=string(b.devSerial,120);if(serial!==m.header.deviceId||!Number.isInteger(b.channel)||b.channel!==m.header.channelNo||Number(b.channel)<0||Number(b.channel)>65535)return {kind:'pending',reason:'EZVIZ_CHANNEL_CONFLICT'};
 const pictures=Array.isArray(b.pictureList)?b.pictureList.slice(0,20).map((v:any)=>{let id:string,url:string;try{id=string(v.id);url=string(v.url,8192);}catch{return {id:'unknown-image',url:'',plaintext:false};}let plain=false;try{const u=new URL(url),flags=[...u.searchParams.getAll('isEncrypted'),...u.searchParams.getAll('isEncrypt')];plain=b.crypt===0&&flags.length>0&&flags.every(v=>v==='0');}catch{}return {id,url,plaintext:plain};}):[];
 return {kind:'alarm',alarmId:string(b.alarmId),deviceSerial:serial,channel:Number(b.channel),occurredAt:eventTime(b.alarmTime,offset),eventType:'萤石告警类型 '+string(b.alarmType,70),pictures};
 }catch(e){return {kind:'pending',reason:e instanceof AppError?e.code:'EZVIZ_ALARM_CONTRACT'};}
}
