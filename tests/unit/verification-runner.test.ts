import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runVerification as actualRun, type CheckStep} from '../../tools/verification';

async function runVerification(options:Parameters<typeof actualRun>[0]) {
  const folder=await mkdtemp(join(tmpdir(),'q01-private-lock-'));
  try{return await actualRun({...options,lockPath:join(folder,'lock')});}
  finally{await rm(folder,{recursive:true,force:true});}
}

const step = (id:string, args:string[]):CheckStep => ({id, title:id, command:process.execPath, args, timeoutMs:5000});

test('Q01正常与故意失败的真实测试分别登记，重跑不复用结果', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'q01-runner-'));
  const runs:string[] = [];
  try {
    const pass = join(folder, 'pass.test.mjs'), fail = join(folder, 'fail.test.mjs');
    await writeFile(pass, "import test from 'node:test';test('fixture passes',()=>{});\n");
    await writeFile(fail, "import test from 'node:test';import assert from 'node:assert/strict';test('deliberate failure',()=>assert.equal(1,2));\n");
    const first = await runVerification({profile:'runner-test', historyDirs:[], steps:[
      {...step('pass', ['--test', '--test-reporter=tap', pass]), format:'tap'},
      {...step('fail', ['--test', '--test-reporter=tap', fail]), format:'tap'},
    ]}); runs.push(first.runDirectory);
    assert.equal(first.passed, false);
    assert.equal(first.steps[0].status, 'passed');
    assert.equal(first.steps[0].tests?.passed, 1);
    assert.equal(first.steps[1].status, 'failed');
    assert.equal(first.steps[1].tests?.failed, 1);
    assert(first.files.some(f => f.path.endsWith('fail.log') && f.sha256.length === 64));
    const second = await runVerification({profile:'runner-test', historyDirs:[], steps:[step('pass',['-e','process.exit(0)'])]});
    runs.push(second.runDirectory);
    assert.equal(second.passed, true); assert.notEqual(first.runDirectory, second.runDirectory);
    const saved = JSON.parse(await readFile(join(first.runDirectory,'运行记录.json'),'utf8'));
    assert.equal(saved.passed, false); assert.equal(saved.steps[1].exitCode, 1);
  } finally { await rm(folder,{recursive:true,force:true}); for(const run of runs)await rm(run,{recursive:true,force:true}); }
});

test('Q01缺前置不运行，依赖阻塞与独立检查分别保留', async () => {
  const result = await runVerification({profile:'runner-test',historyDirs:[],steps:[
    {...step('missing',['-e','process.exit(9)']),preflight:()=> 'MODEL_FILES_MISSING'},
    {...step('dependent',['-e','process.exit(9)']),dependsOn:['missing']},
    step('independent',['-e','process.exit(0)']),
  ]});
  try {
    assert.equal(result.passed,false);
    assert.deepEqual(result.steps.map(s=>s.status),['blocked','blocked','passed']);
    assert.equal(result.steps[0].exitCode,null);
    assert.equal(result.steps[0].reason,'MODEL_FILES_MISSING');
  } finally { await rm(result.runDirectory,{recursive:true,force:true}); }
});

test('Q01零退出但跳过测试不能当作完整通过', async () => {
  const folder=await mkdtemp(join(tmpdir(),'q01-skip-')),file=join(folder,'skip.test.mjs');
  await writeFile(file,"import test from 'node:test';test.skip('not executed',()=>{});\n");
  const result=await runVerification({profile:'runner-test',historyDirs:[],steps:[{...step('skip',['--test','--test-reporter=tap',file]),format:'tap'}]});
  try { assert.equal(result.passed,false);assert.equal(result.steps[0].exitCode,0);assert.equal(result.steps[0].status,'incomplete');assert.equal(result.steps[0].tests?.skipped,1); }
  finally {await rm(folder,{recursive:true,force:true});await rm(result.runDirectory,{recursive:true,force:true});}
});

test('Q01发现证据目录变更会失败并保留实际文件，不自动还原', async () => {
  const folder=await mkdtemp(join(tmpdir(),'q01-history-')),file=join(folder,'old.json');await writeFile(file,'original');
  const result=await runVerification({profile:'runner-test',historyDirs:[folder],steps:[step('write',['-e',"require('node:fs').writeFileSync(process.argv[1],'changed')",file])]});
  try { assert.equal(result.passed,false);assert.equal(result.history.unchanged,false);assert.equal(await readFile(file,'utf8'),'changed'); }
  finally {await rm(folder,{recursive:true,force:true});await rm(result.runDirectory,{recursive:true,force:true});}
});

test('Q01超时和取消保留未完成状态', async () => {
  const timeout=await runVerification({profile:'runner-test',historyDirs:[],steps:[{...step('timeout',['-e','setInterval(()=>{},1000)']),timeoutMs:100}]});
  const controller=new AbortController();controller.abort();
  const cancelled=await runVerification({profile:'runner-test',historyDirs:[],signal:controller.signal,steps:[step('never',['-e','process.exit(9)'])]});
  try {assert.equal(timeout.passed,false);assert.equal(timeout.steps[0].reason,'TIMEOUT');assert.equal(cancelled.steps[0].status,'interrupted');assert.equal(cancelled.passed,false);}
  finally {await rm(timeout.runDirectory,{recursive:true,force:true});await rm(cancelled.runDirectory,{recursive:true,force:true});}
});
