import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {AppError} from '../../platform/error';
export async function localAnalysis(kind:'crop'|'spectral',input:Record<string,unknown>):Promise<any>{
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded)>96*1024*1024)throw new AppError(413,'ANALYSIS_INPUT_LIMIT','影像分析输入超限');
 return new Promise((ok,bad)=>{
 const child=spawn(process.execPath,['--max-old-space-size=512','--import','tsx',resolve(kind==='crop'?'workers/crop-inference.mjs':'workers/spectral.mjs')],{env:{NODE_ENV:process.env.NODE_ENV??'production',PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,MODEL_CACHE_ROOT:process.env.MODEL_CACHE_ROOT,CROP_MODEL_EVALUATION_ENABLED:process.env.CROP_MODEL_EVALUATION_ENABLED,OMP_NUM_THREADS:'1',HF_HUB_DISABLE_TELEMETRY:'1'},stdio:['pipe','pipe','pipe']});
 let output='',size=0,exceeded=false;const timer=setTimeout(()=>{child.kill('SIGKILL');bad(new AppError(503,'ANALYSIS_TIMEOUT','影像分析超时，原件和人工处理保留'));},120000);
 child.stdout.on('data',b=>{size+=b.length;if(size>48*1024*1024){exceeded=true;child.kill('SIGKILL');}else output+=b;});child.stderr.resume();
 child.on('error',()=>{clearTimeout(timer);bad(new AppError(503,'ANALYSIS_PROCESS','本地分析进程不可用'));});
 child.on('close',code=>{clearTimeout(timer);try{if(code!==0||exceeded)throw Error();const result=JSON.parse(output.trim().split('\n').at(-1)!);if(result.error)throw new AppError(422,String(result.error),'影像格式、校正或波段未通过核验');ok(result);}catch(e){bad(e instanceof AppError?e:new AppError(503,'ANALYSIS_FAILED','本地分析未完成，请核对文件、模型准备和格式说明'));}});
 child.stdin.on('error',()=>{});child.stdin.end(encoded);
 });
}

