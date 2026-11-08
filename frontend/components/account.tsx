'use client';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';

export type User = { id: string; display_name: string; email: string };
type Mode = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password' | 'resend-verification';
const titles = { login: '登录', register: '注册', 'verify-email': '验证邮箱',
  'forgot-password': '找回密码', 'reset-password': '重置密码', 'resend-verification': '重发验证邮件' };

export function Account({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<User & { message: string }>(`auth/${mode}`, { method: 'POST', body: JSON.stringify(fields) });
      if (mode === 'login') onLogin(result);
      else { setMessage(result.message); if (mode === 'register') setMode('verify-email');
        else if (mode === 'verify-email' || mode === 'reset-password') setMode('login'); }
    } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <section className="account-panel" aria-labelledby="account-title">
    <div className="section-label">从一门课程开始</div>
    <h1 id="account-title">{titles[mode]}</h1>
    <p className="intro">保存课程与学习资料，建立自己的学习空间。</p>
    <div className="account-tabs" aria-label="账户操作">{(['login', 'register'] as Mode[]).map(tab =>
      <button key={tab} type="button" aria-pressed={mode === tab} disabled={busy}
        onClick={() => { setMode(tab); setError(''); setMessage(''); }}>{titles[tab]}</button>)}</div>
    <form onSubmit={submit} key={mode} className="stack">
      {['login', 'register', 'forgot-password', 'resend-verification'].includes(mode) ? <label>邮箱
        <input name="email" type="email" autoComplete="email" spellCheck={false} required maxLength={254} /></label> : null}
      {mode === 'register' ? <label>称呼<input name="display_name" autoComplete="nickname" required maxLength={80} /></label> : null}
      {['login', 'register', 'reset-password'].includes(mode) ? <label>密码
        <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={12} maxLength={128} required aria-describedby="password-help" />
        <small id="password-help">12–128 个字符</small></label> : null}
      {['verify-email', 'reset-password'].includes(mode) ? <label>邮件验证码
        <input name="token" autoComplete="one-time-code" spellCheck={false} minLength={32} maxLength={100} required /></label> : null}
      <button className="primary" disabled={busy}>{busy ? '处理中…' : titles[mode]}</button>
    </form>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="error">{error}</p> : null}
    <div className="account-links">{(['verify-email', 'resend-verification', 'forgot-password', 'reset-password'] as Mode[]).map(tab =>
      <button type="button" key={tab} className="text-button" disabled={busy} onClick={() => { setMode(tab); setError(''); setMessage(''); }}>{titles[tab]}</button>)}</div>
  </section>;
}
