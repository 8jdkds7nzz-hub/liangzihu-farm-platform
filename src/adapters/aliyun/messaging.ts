import * as Voice from '@alicloud/dyvmsapi20170525';
import * as Sms from '@alicloud/dysmsapi20170525';
import {$OpenApiUtil} from '@alicloud/openapi-core';
import {RuntimeOptions} from '@darabonba/typescript';
import {AppError} from '../../platform/error';

const VoiceClient=(Voice.default as unknown as {default?:typeof Voice.default}).default??Voice.default;
const SmsClient=(Sms.default as unknown as {default?:typeof Sms.default}).default??Sms.default;
export const messagingRuntime=()=>new RuntimeOptions({autoretry:false,maxAttempts:1,readTimeout:15000,connectTimeout:5000,ignoreSSL:false});
function settings(kind:'SMS'|'VOICE',env:NodeJS.ProcessEnv){
  if(env[kind+'_ENABLED']!=='1'||env[kind+'_CONTRACT_VERIFIED']!=='1'||!env[kind+'_CONTRACT_EVIDENCE']||!env.ALIBABA_CLOUD_ACCESS_KEY_ID||!env.ALIBABA_CLOUD_ACCESS_KEY_SECRET)throw new AppError(503,kind+'_NOT_READY','已核账号、模板与接入依据尚未部署，真实发送关闭');
  return new $OpenApiUtil.Config({accessKeyId:env.ALIBABA_CLOUD_ACCESS_KEY_ID,accessKeySecret:env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,securityToken:env.ALIBABA_CLOUD_SECURITY_TOKEN,endpoint:kind==='SMS'?'dysmsapi.aliyuncs.com':'dyvmsapi.aliyuncs.com',protocol:'HTTPS'});
}
export function configuredSms(env:NodeJS.ProcessEnv=process.env){
  const client=new SmsClient(settings('SMS',env));
  if(!env.SMS_SIGN_NAME||!/^SMS_[A-Za-z0-9]+$/.test(env.SMS_TEMPLATE_CODE??'')||!/^\w{1,40}$/.test(env.SMS_CODE_VARIABLE??''))throw new AppError(503,'SMS_TEMPLATE','短信签名与验证码变量尚未核实');
  return {async send(phone:string,code:string,id:string){if(!/^1\d{10}$/.test(phone)||!/^\d{6}$/.test(code))throw new AppError(400,'SMS_INPUT','短信仅发送已登记的单个国内号码和验证码');let r;try{r=await client.sendSmsWithOptions(new Sms.SendSmsRequest({phoneNumbers:phone,signName:env.SMS_SIGN_NAME,templateCode:env.SMS_TEMPLATE_CODE,templateParam:JSON.stringify({[env.SMS_CODE_VARIABLE!]:code}),outId:id}),messagingRuntime());}catch{throw new AppError(502,'SMS_RESULT_UNKNOWN','发送结果待核，不自动重发');}return {accepted:r.body?.code==='OK',requestId:r.body?.bizId??null};}};
}
export function configuredVoice(env:NodeJS.ProcessEnv=process.env){
  const client=new VoiceClient(settings('VOICE',env));
  if(!/^TTS_[A-Za-z0-9]+$/.test(env.VOICE_TEMPLATE_CODE??'')||!/^\w{1,40}$/.test(env.VOICE_TEXT_VARIABLE??'')||!['11000000300006','11010000138001'].includes(env.VOICE_PRODUCT_ID??''))throw new AppError(503,'VOICE_TEMPLATE','须核实通知模板、变量和对应产品ID');
  return {async send(phone:string,text:string,key:string){if(!/^\+?\d{7,15}$/.test(phone)||text.length>240||/https?:\/\//i.test(text))throw new AppError(422,'VOICE_INPUT','已审模板内容或单个被叫号码不符合接口范围');let r;try{r=await client.singleCallByTtsWithOptions(new Voice.SingleCallByTtsRequest({calledNumber:phone,calledShowNumber:env.VOICE_CALLER_NUMBER||undefined,ttsCode:env.VOICE_TEMPLATE_CODE,ttsParam:JSON.stringify({[env.VOICE_TEXT_VARIABLE!]:text}),playTimes:1,outId:key.slice(0,15)}),messagingRuntime());}catch{throw new AppError(502,'VOICE_RESULT_UNKNOWN','外呼结果待核，不自动重拨');}return {accepted:r.body?.code==='OK',callId:r.body?.callId??null};},async query(id:string,at:Date){try{const r=await client.queryCallDetailByCallIdWithOptions(new Voice.QueryCallDetailByCallIdRequest({callId:id,prodId:Number(env.VOICE_PRODUCT_ID),queryDate:at.getTime()}),messagingRuntime());if(r.body?.code!=='OK'||!r.body.data)return null;return typeof r.body.data==='string'?JSON.parse(r.body.data):r.body.data;}catch{return null;}}};
}
