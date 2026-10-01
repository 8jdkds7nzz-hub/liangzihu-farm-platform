'use client';
import { useState } from 'react';
export default function LogoutButton() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出未完成，请重试');
      window.location.replace('/login');
    } catch { setError('退出未完成，请检查网络后重试'); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{busy ? '正在退出…' : '退出登录'}</button>{error && <p role="alert">{error}</p>}</>;
}
