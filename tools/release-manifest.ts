import {readFile,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {PROJECT_ROOT,artifactPath} from '../tests/support/artifacts';import {sourceSnapshot,digest,fileHash} from './quality-state';import {loadMigrations} from '../src/db/migrate';
export function releaseReason(report:any,commit:string,sourceHash:string,buildId:string):string|null {
 const required=['typecheck','unit','environment','build','release-prepare','database','browser-http','monitor','archive','coverage','retrieval','assistant','restore-phase1','restore-phase2','restore-phase3','restore-phase4','stability'];
 if(report.profile!=='delivery'||report.state!=='finished'||report.passed!==true||!report.source?.unchanged||report.source.dirty||!report.history?.unchanged||report.errors?.length||required.some(id=>report.steps?.filter((s:any)=>s.id===id&&s.status==='passed').length!==1)||report.steps?.some((s:any)=>s.status!=='passed'))return 'FULL_DELIVERY_REQUIRED';
 if(report.source.commit!==commit||report.source.sha256!==sourceHash)return 'RELEASE_SOURCE_CHANGED';
 if(report.buildId!==buildId)return 'RELEASE_BUILD_CHANGED';
 if(!report.steps?.some((s:any)=>s.id==='browser-http'&&s.status==='passed'&&s.testFiles?.includes('tests/acceptance/release-upgrade.test.ts'))||!report.steps?.some((s:any)=>s.id==='stability'&&s.status==='passed'))return 'RELEASE_EVIDENCE_INCOMPLETE';return null;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const id=process.argv[2];if(!id||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('RUN_ID_REQUIRED');const folder=join(PROJECT_ROOT,'.local/验证记录',id),report=JSON.parse(await readFile(join(folder,'运行记录.json'),'utf8'));
 const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash=digest(await sourceSnapshot()),buildId=(await readFile(join(PROJECT_ROOT,'.next/BUILD_ID'),'utf8')).trim(),reason=releaseReason(report,commit,sourceHash,buildId);if(reason)throw Error(reason);
 const name='产物/稳定性/持续运行实测.json',entry=report.files.find((f:any)=>f.path===name);if(!entry||await fileHash(join(folder,name))!==entry.sha256)throw Error('STABILITY_EVIDENCE_CHANGED');const stability=JSON.parse(await readFile(join(folder,name),'utf8'));if(!stability.passed||stability.durationMs<600000||stability.samples.length<30)throw Error('STABILITY_EVIDENCE_INCOMPLETE');
 const manifest={createdAt:new Date().toISOString(),commit,sourceSha256:sourceHash,lockSha256:await fileHash(join(PROJECT_ROOT,'pnpm-lock.yaml')),buildId,node:report.environment.node,platform:report.environment.platform,checkReportSha256:await fileHash(join(folder,'运行记录.json')),migrations:(await loadMigrations()).map(m=>({version:m.version,name:m.name,sha256:m.checksum})),configurationKeys:(await readFile(join(PROJECT_ROOT,'.env.example'),'utf8')).split('\n').map(s=>s.match(/^([A-Z_0-9]+)=/)?.[1]).filter(Boolean),engineeringReady:true,productionAccepted:false};
 await writeFile(artifactPath('发布/候选版本清单.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({engineeringReady:true,commit,buildId,productionAccepted:false}));
}
