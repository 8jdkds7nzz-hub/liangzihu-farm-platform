import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,lstat } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { S3Client,PutObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from '../../platform/error';
export const checksum=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
export interface PrivateStore{put(key:string,bytes:Uint8Array,backup?:boolean):Promise<void>;get(key:string,backup?:boolean):Promise<Buffer>;kind:string;independentBackup:boolean}
const validKey=(key:string)=>{if(!/^[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))throw new AppError(400,'INVALID_STORAGE_KEY','文件标识无效');};
export function localStore(root=resolve('.local/media'),backupRoot=resolve('.local/media-backup')):PrivateStore{
 root=resolve(root);backupRoot=resolve(backupRoot);if(root===backupRoot)throw new AppError(503,'BACKUP_CONFIG','原件与备份目录不能相同');
 return {kind:'local',independentBackup:false,async put(key,bytes,backup=false){validKey(key);const base=backup?backupRoot:root;await mkdir(base,{recursive:true,mode:0o700});const folder=resolve(base,key.split('/')[0]);await mkdir(folder,{recursive:true,mode:0o700});if((await lstat(base)).isSymbolicLink()||(await lstat(folder)).isSymbolicLink())throw new AppError(503,'STORAGE_CONFIG','私有文件目录不能使用符号链接');const target=resolve(base,key),temp=target+'.'+crypto.randomUUID()+'.pending';await writeFile(temp,bytes,{mode:0o600,flag:'wx'});await rename(temp,target);},async get(key,backup=false){validKey(key);const base=backup?backupRoot:root,target=resolve(base,key);try{if((await lstat(dirname(target))).isSymbolicLink()||(await lstat(target)).isSymbolicLink())throw new Error();return await readFile(target);}catch{throw new AppError(503,'MEDIA_MISSING','原件缺失或存储暂不可读，请保留记录并联系管理员');}}};
}
export function configuredStore():PrivateStore{
 if(process.env.MEDIA_DRIVER!=='s3')return localStore(process.env.MEDIA_ROOT,process.env.MEDIA_BACKUP_ROOT);
 const bucket=process.env.MEDIA_BUCKET,backupBucket=process.env.MEDIA_BACKUP_BUCKET;
 if(!bucket||!backupBucket||bucket===backupBucket||!process.env.MEDIA_S3_REGION)throw new AppError(503,'STORAGE_CONFIG','私有存储和备份桶配置不完整');
 const client=new S3Client({region:process.env.MEDIA_S3_REGION,endpoint:process.env.MEDIA_S3_ENDPOINT,forcePathStyle:process.env.MEDIA_S3_PATH_STYLE==='1'});
 return {kind:'s3',independentBackup:false,async put(key,bytes,backup=false){validKey(key);await client.send(new PutObjectCommand({Bucket:backup?backupBucket:bucket,Key:key,Body:bytes,ContentType:'application/octet-stream'}),{abortSignal:AbortSignal.timeout(20000)});},async get(key,backup=false){validKey(key);try{const result=await client.send(new GetObjectCommand({Bucket:backup?backupBucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(20000)});return Buffer.from(await result.Body!.transformToByteArray());}catch{throw new AppError(503,'MEDIA_MISSING','私有文件暂不可读');}}};
}
