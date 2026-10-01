import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {AppError} from '../../platform/error';
export const EMBEDDING_VERSION='Xenova/bge-small-zh-v1.5@75c43b069aac4d136ba6bc1122f995fedcfd2781:q8:cls';
export const IMAGE_VERSION='Xenova/yolos-tiny@e2f9c7673f0fa61849efe2b56a0d7774779ebb9d:q8';
export async function infer(input:Record<string,unknown>,timeoutMs=60000):Promise<Record<string,unknown>>{
 return new Promise((ok,bad)=>{const p=spawn(process.execPath,[resolve('workers/inference.mjs')],{env:{NODE_ENV:process.env.NODE_ENV??'production',PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,MODEL_CACHE_ROOT:process.env.MODEL_CACHE_ROOT,OMP_NUM_THREADS:'1',HF_HUB_DISABLE_TELEMETRY:'1'},stdio:['pipe','pipe','pipe']});let output='',size=0;const timer=setTimeout(()=>{p.kill('SIGKILL');bad(new AppError(503,'MODEL_TIMEOUT','本地模型超时，自动分析未完成'));},timeoutMs);
 p.stdout.on('data',b=>{size+=b.length;if(size>2*1024*1024){p.kill();return;}output+=b;});p.stderr.resume();p.on('error',()=>{clearTimeout(timer);bad(new AppError(503,'MODEL_UNAVAILABLE','本地模型进程不可用'));});p.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error();ok(JSON.parse(output.trim().split('\n').at(-1)!));}catch{bad(new AppError(503,'MODEL_UNAVAILABLE','本地模型未就绪，需先准备模型文件'));}});p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(input));});
}
export async function embedTexts(texts:string[]):Promise<number[][]>{const r=await infer({kind:'embedding',texts});if(Array.isArray(r.truncated)&&r.truncated.some(Boolean))throw new AppError(422,'VECTOR_INPUT_TRUNCATED','资料片段超过向量模型范围，需重新切分；本次不宣称已完整索引');const vectors=r.vectors;if(!Array.isArray(vectors)||vectors.length!==texts.length||vectors.some(v=>!Array.isArray(v)||v.length!==512||v.some(n=>typeof n!=='number'||!Number.isFinite(n))))throw new AppError(503,'VECTOR_INVALID','向量模型返回维度或数值无效');return vectors as number[][];}
