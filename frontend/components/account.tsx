'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Icon } from './icon';

export type User = { id: string; display_name: string; email: string };
type Mode = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password' | 'resend-verification';
const titles: Record<Mode, string> = {
  login: '登录', register: '注册', 'verify-email': '验证邮箱',
  'forgot-password': '找回密码', 'reset-password': '重置密码', 'resend-verification': '重发验证邮件',
};

export function Account({ onLogin, notice = '' }: { onLogin: (user: User) => void; notice?: string }) {
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const errorElement = useRef<HTMLParagraphElement>(null);

  function changeMode(next: Mode) {
    setMode(next); setMessage(''); setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<User & { message: string }>('auth/' + mode, {
        method: 'POST', body: JSON.stringify(fields),
      });
      if (mode === 'login') onLogin(result);
      else {
        setMessage(result.message);
        if (mode === 'register') setMode('verify-email');
        else if (mode === 'verify-email' || mode === 'reset-password') setMode('login');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试');
      requestAnimationFrame(() => errorElement.current?.focus());
    } finally { setBusy(false); }
  }

  const description = mode === 'login' ? '登录你的个人学习空间。' :
    mode === 'register' ? '创建账户，开始整理第一门课程。' :
    mode === 'verify-email' ? '输入验证邮件中的一次性验证码。' :
    mode === 'forgot-password' ? '填写注册邮箱，获取密码重置验证码。' :
    mode === 'reset-password' ? '输入邮件验证码和新的登录密码。' : '填写注册邮箱，重新获取验证邮件。';

  return <section className="account-panel" aria-labelledby="account-title">
    <h1 id="account-title">{titles[mode]}</h1>
    <p className="account-description">{description}</p>
    <div className="segmented-control account-tabs" aria-label="账户操作">
      {(['login', 'register'] as const).map(tab => <button key={tab} type="button"
        aria-pressed={mode === tab} disabled={busy} onClick={() => changeMode(tab)}>{titles[tab]}</button>)}
    </div>
    {notice ? <p className="notice info" role="status">{notice}</p> : null}
    {message ? <p className="notice success" role="status"><Icon name="check" size={18} />{message}</p> : null}
    {error ? <p ref={errorElement} tabIndex={-1} role="alert" className="notice error"><Icon name="alert" size={18} />{error}</p> : null}
    <form onSubmit={submit} key={mode} className="form-stack">
      {['login', 'register', 'forgot-password', 'resend-verification'].includes(mode) ? <label>邮箱
        <input name="email" type="email" autoComplete="email" spellCheck={false} required maxLength={254}
          placeholder="你的邮箱地址" /></label> : null}
      {mode === 'register' ? <label>称呼<input name="display_name" autoComplete="nickname" required maxLength={80}
        placeholder="希望如何称呼你" /></label> : null}
      {['login', 'register', 'reset-password'].includes(mode) ? <div className="field-group">
        <div className="label-row"><label htmlFor="account-password">密码</label>
          {mode === 'login' ? <button type="button" className="text-button" disabled={busy}
            onClick={() => changeMode('forgot-password')}>忘记密码？</button> : null}</div>
        <input id="account-password" name="password" type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={12} maxLength={128} required aria-describedby="password-help" placeholder="输入密码" />
        <small id="password-help">12–128 个字符</small>
      </div> : null}
      {['verify-email', 'reset-password'].includes(mode) ? <label>邮件验证码
        <input name="token" autoComplete="one-time-code" spellCheck={false} minLength={32} maxLength={100}
          required placeholder="粘贴邮件中的验证码" /></label> : null}
      <button className="button primary account-submit" disabled={busy}>
        {busy ? '处理中…' : titles[mode]}{!busy ? <Icon name="arrow" size={18} /> : null}
      </button>
    </form>
    <div className="account-links">
      {(['verify-email', 'resend-verification', 'reset-password'] as Mode[]).filter(tab => tab !== mode).map(tab =>
        <button type="button" key={tab} className="text-button" disabled={busy}
          onClick={() => changeMode(tab)}>{titles[tab]}</button>)}
    </div>
  </section>;
}
