import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = join(root, '.local');
const credentialPath = join(local, 'database-credentials.json');
const compose = ['compose', '--env-file', join(root, '.env.docker.local'), '-f', join(root, 'ops/compose.yaml')];
let secrets = [];

function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: root, input, encoding: 'utf8' });
  if (result.error) throw new Error('无法启动Docker命令，请确认Docker Desktop已启动。');
  if (result.status !== 0) {
    let message = result.stderr || 'Docker命令未完成';
    for (const secret of secrets) message = message.replaceAll(secret, '[已隐藏]');
    throw new Error(message.trim());
  }
  return result.stdout.trim();
}

function sql(text, database = 'postgres') {
  return docker([...compose, 'exec', '-T', 'db', 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], text);
}

function literal(value) { return "'" + value.replaceAll("'", "''") + "'"; }

async function ensureEnv(name, entries) {
  const path = join(root, name);
  let existing = '';
  try { existing = await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parsed = parseEnv(existing);
  const additions = [];
  for (const [key, value] of Object.entries(entries)) {
    if (parsed[key] !== undefined && parsed[key] !== value) throw new Error(name + '中的受管理数据库配置已被修改，未覆盖。');
    if (parsed[key] === undefined) additions.push(key + '=' + value);
  }
  if (additions.length) await writeFile(path, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
}

async function main() {
  docker(['info', '--format', '{{.ServerVersion}}']);
  await mkdir(local, { recursive: true, mode: 0o700 });
  let credentials;
  try { credentials = JSON.parse(await readFile(credentialPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const found = docker(['ps', '-aq', '--filter', 'name=^/liangzihu-farm-db$']);
    const volume = docker(['volume', 'ls', '-q', '--filter', 'name=^liangzihu-farm-platform_pgdata$']);
    if (found || volume) throw new Error('已有同名数据库资源，但本目录缺少凭据记录；请核对归属，未重置资源。');
    credentials = { owner: 'liangzihu-farm-platform/A00', admin: randomBytes(32).toString('hex'), dev: randomBytes(32).toString('hex'), test: randomBytes(32).toString('hex') };
    await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
  }
  if (credentials.owner !== 'liangzihu-farm-platform/A00' || ![credentials.admin, credentials.dev, credentials.test].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('本地凭据记录格式或归属不正确。');
  }
  secrets = [credentials.admin, credentials.dev, credentials.test];
  await chmod(credentialPath, 0o600);
  await ensureEnv('.env.docker.local', { POSTGRES_PASSWORD: credentials.admin });
  await ensureEnv('.env.local', { DATABASE_URL: 'postgresql://agri_developer:' + credentials.dev + '@127.0.0.1:55432/agri_dev' });
  await ensureEnv('.env.test.local', { TEST_DATABASE_URL: 'postgresql://agri_tester:' + credentials.test + '@127.0.0.1:55432/agri_test' });
  docker([...compose, 'up', '-d', '--wait', '--wait-timeout', '60', 'db']);

  for (const [database, role, password] of [['agri_dev', 'agri_developer', credentials.dev], ['agri_test', 'agri_tester', credentials.test]]) {
    const exists = sql('SELECT 1 FROM pg_roles WHERE rolname=' + literal(role));
    if (!exists) sql('CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ' + literal(password) + ';');
    const owner = sql('SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=' + literal(database));
    if (owner && owner !== role) throw new Error(database + '已由其他角色持有，未修改。');
    if (!owner) sql('CREATE DATABASE ' + database + ' OWNER ' + role + ';');
    sql('REVOKE ALL ON DATABASE ' + database + ' FROM PUBLIC; GRANT CONNECT,TEMPORARY ON DATABASE ' + database + ' TO ' + role + ';');
    sql('CREATE EXTENSION IF NOT EXISTS postgis;', database);
  }
  const version = sql('SELECT version(); SELECT postgis_lib_version();', 'agri_dev');
  console.log('本地数据库已就绪：agri_dev与agri_test使用独立角色，端口55432。');
  console.log(version);
  console.log('凭据仅保存在本项目忽略的本地文件中，未输出连接密码。');
}

main().catch(error => {
  let message = error instanceof Error ? error.message : '本地数据库初始化失败';
  for (const secret of secrets) message = message.replaceAll(secret, '[已隐藏]');
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
