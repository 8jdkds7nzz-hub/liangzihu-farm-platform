import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { hashPassword } from '../src/modules/identity/password';
import { transaction } from '../src/db/pool';
import { loadMigrations, runMigrations } from '../src/db/migrate';

// Local operator bootstrap only; there is no public registration or bootstrap route.
async function main() {
  let content = await readFile('.env.local', 'utf8');
  const env = parseEnv(content);
  const url = new URL(env.DATABASE_URL ?? '');
  if (url.pathname !== '/agri_dev' || !['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('只允许本地agri_dev初始化');
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await runMigrations(pool, await loadMigrations());
    await transaction(async client => {
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const additions: string[] = [];
      if (!env.IDENTITY_ENCRYPTION_KEY) {
        const encrypted = (await client.query('SELECT EXISTS(SELECT 1 FROM second_factors) OR EXISTS(SELECT 1 FROM auth_challenges WHERE encrypted_secret IS NOT NULL) AS found')).rows[0].found;
        if (encrypted) throw new Error('已有加密验证资料，必须恢复原密钥，不能重新生成');
        additions.push('IDENTITY_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
      } else if (!/^[a-f0-9]{64}$/.test(env.IDENTITY_ENCRYPTION_KEY)) throw new Error('密钥配置无效');
      if (!env.APP_ORIGIN) additions.push('APP_ORIGIN=http://127.0.0.1:3100');
      if (additions.length) {
        content += (content.endsWith('\n') ? '' : '\n') + additions.join('\n') + '\n';
        await writeFile('.env.local', content, { mode: 0o600 });
      }
      await chmod('.env.local', 0o600);
      if (Number((await client.query('SELECT count(*) FROM users')).rows[0].count) > 0) {
        console.log('已有账号，未新增或重置；账号安全环境配置已核对。'); return;
      }
      await mkdir('.local', { recursive: true, mode: 0o700 });
      const path = '.local/初始管理员凭据.json';
      let credentials: { username: string; password: string; note: string };
      try { credentials = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        credentials = { username: 'farm-admin', password: randomBytes(24).toString('base64url'), note: '仅本地初始账号。首次登录须由使用者绑定自己的验证器，并保存一次性恢复码。请保存到自己的密码管理器后删除本文件。' };
        await writeFile(path, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      }
      if (credentials.username !== 'farm-admin' || typeof credentials.password !== 'string' || credentials.password.length < 24) throw new Error('本地初始化凭据不符');
      await chmod(path, 0o600);
      const row = (await client.query("INSERT INTO users(username,display_name,password_hash,role) VALUES($1,'平台管理员',$2,'admin') RETURNING id", [credentials.username, await hashPassword(credentials.password)])).rows[0];
      await client.query("INSERT INTO audit_events(actor_id,event_type,target_id) VALUES(NULL,'local_admin_bootstrapped',$1)", [row.id]);
      console.log('初始管理员已建立；凭据保存在已忽略的.local/初始管理员凭据.json，未输出密码。');
    }, pool);
  } finally { await pool.end(); }
}
main().catch(() => { console.error('账号初始化未完成，请检查本地数据库、环境配置和私有凭据文件；现有账号未重置。'); process.exitCode = 1; });
