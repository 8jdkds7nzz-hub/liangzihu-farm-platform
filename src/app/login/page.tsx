import LoginForm from './login-form';
import {isMfaEnabled} from '@/platform/config';
import ExpertSms from './expert-sms';
import WecomButton from './wecom-button';
export const metadata = { title: '登录 · 梁子湖智慧农业', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default function LoginPage() {
  return <main>
    <header><a className="brand" href="/">梁子湖 · 智慧农业</a><span className="badge">账号登录</span></header>
    <section className="auth-card"><LoginForm mfaRequired={isMfaEnabled()} />{process.env.WECOM_ENABLED==='1'&&process.env.WECOM_CONTRACT_VERIFIED==='1'&&<WecomButton />}{process.env.SMS_ENABLED==='1'&&process.env.SMS_CONTRACT_VERIFIED==='1'&&<ExpertSms />}<p className="hint"><a href="/recovery">本人账号恢复入口</a>（先由管理员核验）</p></section>
  </main>;
}
