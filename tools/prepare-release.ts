import {execFileSync} from 'node:child_process';import {existsSync} from 'node:fs';import {mkdir,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {PROJECT_ROOT} from '../tests/support/artifacts';import {isolatedFilesReason,testEnvironment} from './check-environment';
export const OLD_RELEASE='1c3c5d0cab9d1e5351d811e91faa0c11302aeac8';
const folder=join(PROJECT_ROOT,'.local/发布旧版'),stamp=join(folder,'准备记录.json');
if(isolatedFilesReason())throw Error('ISOLATED_WORKTREE_REQUIRED');
if(existsSync(stamp)){const info=JSON.parse(await readFile(stamp,'utf8'));if(info.commit!==OLD_RELEASE||!existsSync(join(folder,'.next/BUILD_ID')))throw Error('OLD_RELEASE_STATE_MISMATCH');console.log('旧版独立构建已存在，保持原版本。');}
else{
 if(existsSync(folder))throw Error('OLD_RELEASE_DIRECTORY_NOT_EMPTY');await mkdir(folder,{recursive:true,mode:0o700});
 const bytes=execFileSync('git',['archive',OLD_RELEASE],{cwd:PROJECT_ROOT,maxBuffer:256*1024*1024});execFileSync('tar',['-xf','-','-C',folder],{input:bytes});
 execFileSync('pnpm',['install','--frozen-lockfile'],{cwd:folder,stdio:'inherit',timeout:300000});
 execFileSync('pnpm',['build'],{cwd:folder,env:testEnvironment(),stdio:'inherit',timeout:300000});
 await writeFile(stamp,JSON.stringify({commit:OLD_RELEASE,buildId:(await readFile(join(folder,'.next/BUILD_ID'),'utf8')).trim()},null,2)+'\n',{mode:0o600});
}
