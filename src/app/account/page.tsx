import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, SESSION_COOKIE } from '@/modules/identity/session';
import { listAccessibleObjects } from '@/modules/identity/access';
import { database } from '@/db/pool';
import { AppError } from '@/platform/error';
import LogoutButton from './logout-button';
export const dynamic = 'force-dynamic';
export const metadata = { title: '我的账号 · 梁子湖智慧农业', referrer: 'no-referrer' };
const roles = { admin: '系统管理员', owner: '农场负责人', technician: '技术员', worker: '一线工人', maintainer: '维护人员', expert: '外部专家' };
export default async function AccountPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  let actor;
  try { actor = await resolveSession(token); }
  catch (error) {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    return <main><h1>暂时无法读取账号</h1><p>请稍后刷新重试。</p><a href="/login">返回登录</a></main>;
  }
  const profile = await database(async client => {
    const row = (await client.query('SELECT display_name FROM users WHERE id=$1', [actor.id])).rows[0];
    return { name: row.display_name, count: (await listAccessibleObjects(client, actor, 'read')).length };
  });
  return <main>
    <header><a className="brand" href="/">梁子湖 · 智慧农业</a><span className="badge">我的账号</span></header>
    <section className="auth-card account-card">
      <p className="eyebrow">已登录</p><h1>{profile.name}</h1>
      <dl><dt>角色</dt><dd>{roles[actor.role]}</dd><dt>二次验证</dt><dd>{actor.mfaVerified ? '已完成' : '当前账号未要求'}</dd><dt>可查看的业务对象</dt><dd>{profile.count} 个</dd></dl>
      {profile.count === 0 && <p className="hint">当前没有业务对象的查看授权。人员权限与地块、设备台账将在后续配置中关联。</p>}
      <LogoutButton />
    </section>
  </main>;
}
