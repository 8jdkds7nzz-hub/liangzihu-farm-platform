import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, open, readFile, readdir, rename, rm, stat} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {hostname} from 'node:os';
import {PROJECT_ROOT} from '../tests/support/artifacts';

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function fileHash(file:string) {const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export async function filesUnder(directory:string):Promise<string[]> {
  let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  const files:string[]=[];
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
    if(e.name==='__pycache__'||e.name==='.DS_Store')continue;
    if(e.isSymbolicLink())throw new Error('SYMLINK_IN_EVIDENCE');
    const p=join(directory,e.name);if(e.isDirectory())files.push(...await filesUnder(p));else if(e.isFile())files.push(p);
  }return files;
}
export async function snapshot(directories:string[],root=PROJECT_ROOT) {
  const rows:Record<string,string>={};
  for(const dir of directories)for(const f of await filesUnder(dir))rows[relative(root,f)]=await fileHash(f);
  return Object.fromEntries(Object.entries(rows).sort(([a],[b])=>a.localeCompare(b)));
}
export async function sourceSnapshot(root=PROJECT_ROOT, directories?:string[]) {
  const rows=await snapshot(directories??['src','db','workers','tools','tests','ops','.github'].map(p=>join(root,p)),root);
  if(!directories)for(const name of ['package.json','pnpm-lock.yaml','next.config.ts','tsconfig.json'])rows[name]=await fileHash(join(root,name));
  return Object.fromEntries(Object.entries(rows).sort(([a],[b])=>a.localeCompare(b)));
}
export async function atomicJson(path:string,value:unknown) {
  const text=JSON.stringify(value,null,2)+'\n';await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(text);await file.sync();}finally{await file.close();}await rename(temporary,path);}
  finally{await rm(temporary,{force:true});}
}
export async function acquireCheckLock(path:string) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const owner={pid:process.pid,host:hostname(),token:randomUUID(),startedAt:new Date().toISOString()};
  let file;try{file=await open(path,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('CHECK_BUSY_OR_STALE_LOCK');throw e;}
  try{await file.writeFile(JSON.stringify(owner));await file.sync();}catch(e){await file.close();await rm(path,{force:true});throw e;}await file.close();
  return async()=>{const current=JSON.parse(await readFile(path,'utf8'));if(current.token!==owner.token)throw new Error('LOCK_OWNER_CHANGED');await rm(path);};
}
export async function clearStoppedCheckLock(path:string) {
  const before=await stat(path),owner=JSON.parse(await readFile(path,'utf8'));
  if(owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string')throw new Error('LOCK_IDENTITY_UNKNOWN');
  try{process.kill(owner.pid,0);throw new Error('LOCK_PROCESS_ALIVE');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
  const after=await stat(path);if(before.ino!==after.ino||JSON.parse(await readFile(path,'utf8')).token!==owner.token)throw new Error('LOCK_OWNER_CHANGED');
  await rm(path);
}
