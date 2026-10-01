import tar from 'tar-stream';import {createGzip} from 'node:zlib';import {Readable} from 'node:stream';import type {Pool} from 'pg';import type {Actor} from '../../platform/types';import {database,transaction,getPool} from '../../db/pool';import {downloadExport} from '../maintenance/exports';import {readMedia} from './service';import {configuredStore,type PrivateStore} from './storage';
export async function exportBundle(a:Actor,id:string,pool:Pool=getPool(),store:PrivateStore=configuredStore()){
 const manifest=await transaction(c=>downloadExport(c,a,id),pool),payload=JSON.parse(manifest.body),pack=tar.pack(),gzip=createGzip();pack.pipe(gzip);
 const entry=(name:string,bytes:Uint8Array)=>new Promise<void>((resolve,reject)=>pack.entry({name,size:bytes.length,mode:0o600,mtime:new Date(0)},Buffer.from(bytes),e=>e?reject(e):resolve()));
 void(async()=>{try{await entry('资料与关系.json',Buffer.from(manifest.body));for(const asset of payload.media??[]){if(asset.ingestState!=='complete')continue;await transaction(c=>downloadExport(c,a,id),pool);const file=await database(c=>readMedia(c,a,asset.id,store),pool);await entry('附件/'+asset.id, file.bytes);}pack.finalize();}catch(e){pack.destroy(e as Error);}})();pack.on('error',e=>gzip.destroy(e));
 return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}
