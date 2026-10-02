import LoginForm from './login-form';
import { isMfaEnabled } from '@/platform/config';
export const metadata = { title: '登录 · 梁子湖智慧农业', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default function LoginPage() {
  return <main>
    <header><a className="brand" href="/">梁子湖 · 智慧农业</a><span className="badge">账号登录</span></header>
    <section className="auth-card"><LoginForm mfaRequired={isMfaEnabled()} /></section>
  </main>;
}
