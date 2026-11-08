'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { User } from './account';
import { Icon } from './icon';

export function Profile({ user, onUpdate, onPasswordChanged }: {
  user: User; onUpdate: (user: User) => void; onPasswordChanged: () => void;
}) {
  const [pending, setPending] = useState<'profile' | 'password' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [section, setSection] = useState<'profile' | 'password'>('profile');
  const errorElement = useRef<HTMLParagraphElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>, password: boolean) {
    event.preventDefault(); setPending(password ? 'password' : 'profile'); setMessage(''); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (password) {
        await api('auth/change-password', { method: 'POST', body: JSON.stringify(data) });
        onPasswordChanged();
      } else {
        const result = await api<User>('users/me', { method: 'PATCH', body: JSON.stringify(data) });
        onUpdate(result); setMessage('资料已保存');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试');
      requestAnimationFrame(() => errorElement.current?.focus());
    } finally { setPending(null); }
  }

  return <div className="settings-page">
    <div className="page-heading"><div><h1>账户设置</h1><p>管理个人资料与登录安全。</p></div></div>
    {message ? <p role="status" className="notice success"><Icon name="check" size={18} />{message}</p> : null}
    {error ? <p ref={errorElement} tabIndex={-1} role="alert" className="notice error"><Icon name="alert" size={18} />{error}</p> : null}
    <div className="segmented-control settings-tabs" aria-label="账户设置分类">
      <button aria-pressed={section === 'profile'} disabled={pending !== null} onClick={() => { setSection('profile'); setError(''); setMessage(''); }}>个人资料</button>
      <button aria-pressed={section === 'password'} disabled={pending !== null} onClick={() => { setSection('password'); setError(''); setMessage(''); }}>登录安全</button>
    </div>
    {section === 'profile' ? <section className="settings-section" aria-labelledby="profile-heading">
      <div className="settings-description"><h2 id="profile-heading">个人资料</h2><p>称呼会显示在你的工作台中。</p></div>
      <form className="form-stack" onSubmit={event => void submit(event, false)}>
        <div className="field-group"><span className="field-label">邮箱</span><div className="read-only-field">{user.email}<span className="status-tag">已验证</span></div></div>
        <label>称呼<input name="display_name" defaultValue={user.display_name} maxLength={80}
          required autoComplete="nickname" /></label>
        <div><button className="button primary" disabled={pending !== null}>{pending === 'profile' ? '保存中…' : '保存资料'}</button></div>
      </form>
    </section> : <section className="settings-section" aria-labelledby="password-heading">
      <div className="settings-description"><h2 id="password-heading">修改密码</h2><p>修改后将退出所有登录。<br />密码需为 12–128 个字符。</p></div>
      <form className="form-stack" onSubmit={event => void submit(event, true)}>
        <label>当前密码<input type="password" name="current_password" minLength={12} maxLength={128}
          autoComplete="current-password" required /></label>
        <label>新密码<input type="password" name="password" minLength={12} maxLength={128}
          autoComplete="new-password" required /></label>
        <div><button className="button" disabled={pending !== null}>{pending === 'password' ? '处理中…' : '修改密码并退出'}</button></div>
      </form>
    </section>}
  </div>;
}
