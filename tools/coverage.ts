import {existsSync,readFileSync,readdirSync} from 'node:fs';import {dirname,join,relative,resolve} from 'node:path';import {createHash} from 'node:crypto';
export interface Requirement {id:string;phase:string;title:string;code:string[];tests:string[];record:string;historicalHashes:Record<string,string>;limits:string}
export const sha=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
export function localLinks(text:string):string[] {
 const links:string[]=[];text=text.replace(/```[\s\S]*?```/g,'');
 for(const m of text.matchAll(/!?\[[^\]]*\]\(/g)){let i=m.index!+m[0].length,target='';if(text[i]==='<'){const end=text.indexOf('>',i);if(end<0)continue;target=text.slice(i+1,end);}else{let depth=1;for(;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')'&&!--depth)break;target+=text[i];}target=target.split(/\s+["']/)[0];}if(target&&!/^[a-z][a-z0-9+.-]*:/i.test(target)&&!target.startsWith('#'))links.push(target.split('#')[0]);}
 for(const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/g))if(!/^[a-z]+:/i.test(m[1]))links.push(m[1]);return links;
}
const phase1=[
 ['A00','tools/setup-local-db.mjs|src/db/migrate.ts','tests/unit/test-database-guard.test.ts|tests/integration/database.test.ts'],
 ['A01','src/modules/identity/access.ts|src/modules/identity/session.ts','tests/integration/access.test.ts|tests/integration/session.test.ts|tests/acceptance/identity-http.test.ts'],
 ['A02','src/modules/registry/devices.ts|src/modules/registry/points.ts','tests/integration/registry.test.ts'],
 ['A03','src/modules/telemetry/ingest.ts','tests/integration/ingest.test.ts'],
 ['A04','src/modules/telemetry/quality.ts|src/modules/telemetry/queries.ts','tests/unit/telemetry.test.ts|tests/integration/ingest.test.ts'],
 ['A05','src/modules/jobs/repository.ts','tests/integration/jobs.test.ts'],
 ['A06','src/modules/alerts/service.ts|src/modules/alerts/claims.ts','tests/unit/alerts.test.ts|tests/integration/claims.test.ts'],
 ['A07','src/modules/notifications/runner.ts','tests/integration/notification-recovery.test.ts|tests/unit/wecom-client.test.ts'],
 ['A08','src/components/platform/app-shell.tsx','tests/acceptance/platform-browser.test.ts'],
 ['A09','src/modules/maintenance/exports.ts|src/modules/maintenance/records.ts','tests/integration/maintenance.test.ts'],
 ['A10','src/modules/operations/heartbeat.ts|src/modules/operations/recovery.ts','tests/integration/operations.test.ts|tests/acceptance/external-health.test.mjs'],
 ['A11','package.json|ops/restore-check.ts','tests/acceptance/platform-browser.test.ts'],
];
export function requirements(root:string):Requirement[] {
 const rows:Requirement[]=phase1.map(([id,code,tests])=>({id,phase:'1a',title:id,code:code.split('|'),tests:tests.split('|'),record:`docs/acceptance/1a/${id}.md`,historicalHashes:{},limits:'G01—G06真实联调未由工程测试代签'}));
 for(const name of ['一期1b与1c设计代码测试对照.json','二期设计代码测试对照.json','三期设计代码测试对照.json','四期设计代码测试对照.json']){
  const data=JSON.parse(readFileSync(join(root,'docs/acceptance',name),'utf8'));
  for(const item of data.requirements){const code=typeof item.code==='string'?[item.code]:item.code.map((c:any)=>c.path),phase=item.phase??('1'+item.id[0].toLowerCase()),hashes={...item.evidenceHashes};
   if(typeof item.code==='string'&&item.codeSha256)hashes[item.code]=item.codeSha256;else if(Array.isArray(item.code))for(const c of item.code)if(c.sha256)hashes[c.path]=c.sha256;
   rows.push({id:item.id,phase,title:item.title,code,tests:item.existingTests??item.evidence,record:item.executionRecord??`docs/acceptance/${phase}/${item.id.split('-')[0]}.md`,historicalHashes:hashes,limits:item.limits??item.externalAcceptance??''});
  }
 }return rows;
}
export function checkRequirementRows(root:string,rows:Requirement[],executed:string[]=[]) {
 const errors:string[]=[],keys=new Set<string>(),results=[];
 for(const row of rows){const key=row.phase+':'+row.id;if(keys.has(key))errors.push('DUPLICATE_REQUIREMENT:'+key);keys.add(key);
  if(!row.code.length||!row.tests.length)errors.push('EMPTY_MAPPING:'+key);
  for(const path of [...row.code,...row.tests,row.record])if(!existsSync(join(root,path)))errors.push('MISSING_REFERENCE:'+key+':'+path);
  const changed=Object.entries(row.historicalHashes).filter(([path,hash])=>existsSync(join(root,path))&&sha(join(root,path))!==hash).map(([path])=>path);
  results.push({...row,changedSinceHistoricalEvidence:changed,testFilesExecuted:row.tests.filter(p=>executed.includes(p)),allMappedFilesExecuted:row.tests.every(p=>executed.includes(p)),assertionCoverageCertified:false,fieldAccepted:false});
 }return {requirements:results,errors};
}
export function checkDocumentLinks(root:string) {
 const files:string[]=[],archivedThirdParty:string[]=[];const visit=(p:string)=>{for(const e of readdirSync(p,{withFileTypes:true})){if(e.isDirectory())visit(join(p,e.name));else if(e.name.endsWith('.md')){const path=join(p,e.name);if(path.startsWith(join(root,'docs/licenses')+'/'))archivedThirdParty.push(relative(root,path));else files.push(path);}}};visit(join(root,'docs'));files.push(join(root,'README.md'));
 const errors:string[]=[];let links=0;for(const file of files)for(const target of localLinks(readFileSync(file,'utf8'))){links++;try{const path=resolve(dirname(file),decodeURIComponent(target));if(!existsSync(path))errors.push(relative(root,file)+' -> '+target);}catch{errors.push(relative(root,file)+' -> INVALID_LINK');}}
 return {files:files.length,links,errors,archivedThirdParty,limits:'原样保存的第三方模型卡内部相对链接属于上游仓库，不按本项目相对路径判断'};
}
