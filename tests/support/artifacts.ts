import {lstatSync, mkdirSync, mkdtempSync, realpathSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = join(PROJECT_ROOT, '.local', '验证记录');

function privateDirectory(path:string) {
  // Check existing ancestors before mkdir: never follow a link out of this run.
  const parts = relative(PROJECT_ROOT, path).split(sep);
  let current = PROJECT_ROOT;
  for (const part of parts) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('产物路径不能经过符号链接'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    mkdirSync(current, {recursive:true, mode:0o700});
  }
}

export function createArtifactRun():string {
  privateDirectory(RUNS);
  return mkdtempSync(join(RUNS, new Date().toISOString().replace(/[-:.]/g,'')+'-'));
}

function checkedRun(path:string):string {
  const run = resolve(path);
  if (dirname(run) !== RUNS || !/^[a-zA-Z0-9_-]+$/.test(run.slice(RUNS.length+1))) {
    throw new Error('运行目录只能位于本项目.local/验证记录的独立子目录');
  }
  privateDirectory(run);
  if (realpathSync(run) !== join(realpathSync(RUNS), run.slice(RUNS.length+1))) throw new Error('运行目录不能重定向');
  return run;
}

export function artifactRunDirectory():string {
  if (!process.env.AGRI_CHECK_RUN_DIR) {
    process.env.AGRI_CHECK_RUN_DIR = createArtifactRun();
    console.log('本轮私有产物：'+relative(PROJECT_ROOT, process.env.AGRI_CHECK_RUN_DIR));
  }
  return checkedRun(process.env.AGRI_CHECK_RUN_DIR);
}

function target(path:string, run:string):string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '..' || p === '.')) {
    throw new Error('产物路径必须是无越界的相对路径');
  }
  return join(checkedRun(run), '产物', path);
}

export function artifactDirectory(path:string, run = artifactRunDirectory()):string {
  const directory = target(path,run);
  privateDirectory(directory);
  return directory;
}

export function artifactPath(path:string, run = artifactRunDirectory()):string {
  const file = target(path,run);
  privateDirectory(dirname(file));
  try { if (lstatSync(file).isSymbolicLink()) throw new Error('产物路径不能是符号链接'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}
