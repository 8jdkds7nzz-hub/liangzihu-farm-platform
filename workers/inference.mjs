import {pipeline,env,RawImage} from '@huggingface/transformers';
import {resolve} from 'node:path';
import sharp from 'sharp';
const EMBED={id:'Xenova/bge-small-zh-v1.5',revision:'75c43b069aac4d136ba6bc1122f995fedcfd2781'},IMAGE={id:'Xenova/yolos-tiny',revision:'e2f9c7673f0fa61849efe2b56a0d7774779ebb9d'};
env.cacheDir=resolve(process.env.MODEL_CACHE_ROOT??'.local/models');env.allowRemoteModels=process.argv.includes('--prepare');env.backends.onnx.wasm.numThreads=1;
const options=m=>({revision:m.revision,dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:1,interOpNumThreads:1}});
try{
 if(process.argv.includes('--prepare')){await pipeline('feature-extraction',EMBED.id,options(EMBED));await pipeline('object-detection',IMAGE.id,options(IMAGE));console.log(JSON.stringify({prepared:true,embedding:EMBED,image:IMAGE}));}
 else{let body='';for await(const part of process.stdin){body+=part;if(body.length>30*1024*1024)throw new Error('INPUT_TOO_LARGE');}const input=JSON.parse(body);
 if(input.kind==='embedding'){if(!Array.isArray(input.texts)||input.texts.length>16||input.texts.some(t=>typeof t!=='string'||t.length>4000))throw new Error('INVALID_TEXT');const fn=await pipeline('feature-extraction',EMBED.id,options(EMBED)),lengths=input.texts.map(t=>fn.tokenizer(t,{return_tensor:false,truncation:false}).input_ids.length),truncated=lengths.map(n=>n>512),output=await fn(input.texts,{pooling:'cls',normalize:true});console.log(JSON.stringify({model:EMBED,dimension:512,truncated,vectors:output.tolist()}));}
 else if(input.kind==='image'){const {data,info}=await sharp(Buffer.from(input.base64,'base64'),{limitInputPixels:40000000}).rotate().flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});const image=new RawImage(new Uint8ClampedArray(data),info.width,info.height,info.channels);if(image.width*image.height>40_000_000)throw new Error('IMAGE_TOO_LARGE');const fn=await pipeline('object-detection',IMAGE.id,options(IMAGE)),detections=await fn(image,{threshold:.5,percentage:true});console.log(JSON.stringify({model:IMAGE,threshold:.5,detections:detections.filter(d=>['person','car','truck','bus','motorcycle','bicycle'].includes(d.label))}));}
 else throw new Error('INVALID_KIND');}
}catch{console.error('本地模型未就绪或输入无效。');process.exitCode=1;}
