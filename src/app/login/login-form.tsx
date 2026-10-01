'use client';
import { useEffect, useState, type FormEvent } from 'react';

async function post(path: string, body?: object) {
  const response = await fetch('/api/v1/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? '操作未完成，请稍后重试');
  return data;
}
export default function LoginForm() {
  const [step, setStep] = useState<'login' | 'mfa' | 'recovery'>('login');
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('step') === 'mfa') {
      setStep('mfa');
      if (query.get('enroll') === '1') { setNeedsEnrollment(true); void setup(); }
    }
  }, []);
  async function setup() {
    try { const data = await post('mfa/enroll'); setSecret(data.secret); setNeedsEnrollment(false); }
    catch (e) { setError(e instanceof Error ? e.message : '验证器绑定未完成'); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget, data = new FormData(form);
    try {
      const result = step === 'login'
        ? await post('login', { username: data.get('username'), password: data.get('password') })
        : await post('mfa/verify', { code: String(data.get('code') ?? '').trim() });
      form.reset();
      if (result.next === 'mfa') {
        setStep('mfa'); setNeedsEnrollment(result.enrollment);
        if (result.enrollment) await setup();
      } else if (result.recoveryCodes) {
        setSecret(''); setCodes(result.recoveryCodes); setStep('recovery');
      } else window.location.assign('/account');
    } catch (e) { setError(e instanceof Error ? e.message : '登录未完成，请重试'); }
    finally { setBusy(false); }
  }
  async function restart() {
    setBusy(true); setError('');
    try { await post('logout'); setStep('login'); setSecret(''); setCodes([]); setNeedsEnrollment(false); }
    catch (e) { setError(e instanceof Error ? e.message : '退出未完成'); }
    finally { setBusy(false); }
  }
  return <>
    <p className="eyebrow">梁子湖农场工作平台</p>
    <h1>{step === 'login' ? '登录你的账号' : step === 'mfa' ? '完成二次验证' : '保存恢复码'}</h1>
    {error && <p className="form-error" role="alert">{error}</p>}
    {step === 'recovery' ? <>
      <p className="hint">请将这8个恢复码保存在自己的密码管理器中。每个只能使用一次，此页面关闭后不会再次显示。</p>
      <div className="recovery-codes">{codes.map(code => <code key={code}>{code}</code>)}</div>
      <button type="button" onClick={() => window.location.assign('/account')}>已保存，进入平台</button>
    </> : <form onSubmit={submit}>
      {step === 'login' ? <>
        <p className="hint">使用管理员已开通的账号。首次管理员登录需要绑定验证器。</p>
        <label htmlFor="username">账号</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={80} required />
        <label htmlFor="password">密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
      </> : <>
        {secret ? <div className="enrollment">
          <p>在你使用的验证器中手动添加账号，选择“基于时间”，填写下方密钥。</p>
          <label htmlFor="factor-secret">绑定密钥（仅本次显示）</label>
          <input id="factor-secret" aria-label="绑定密钥" className="secret" value={secret} readOnly autoComplete="off" spellCheck={false} />
          <p>添加后输入验证器生成的6位验证码，完成绑定。</p>
        </div> : <p className="hint">输入验证器当前的6位验证码，也可输入一个未使用的恢复码。相同验证码不能重复使用。</p>}
        {needsEnrollment && <button type="button" className="secondary" onClick={() => void setup()}>重新获取绑定信息</button>}
        <label htmlFor="code">验证码或恢复码</label>
        <input id="code" name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} minLength={6} maxLength={24} required />
      </>}
      <button type="submit" disabled={busy}>{busy ? '正在验证…' : step === 'login' ? '登录' : '验证并进入'}</button>
      {step === 'mfa' && <button type="button" className="secondary" disabled={busy} onClick={() => void restart()}>返回账号登录</button>}
    </form>}
    {step === 'login' && <p className="hint availability">企业微信登录尚未开通。账号和密码遗失时请联系平台管理员。</p>}
  </>;
}
