'use client';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { User } from './account';

export function Profile({ user, onUpdate, onPasswordChanged }: { user: User; onUpdate: (user: User) => void;
  onPasswordChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>, password: boolean) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (password) { await api('auth/change-password', { method: 'POST', body: JSON.stringify(data) }); onPasswordChanged(); }
      else { const result = await api<User>('users/me', { method: 'PATCH', body: JSON.stringify(data) }); onUpdate(result); setMessage('资料已保存'); }
    } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <section className="account-panel"><h1>账户设置</h1><p>{user.email}</p>
    <form className="stack" onSubmit={event => void submit(event, false)}><label>称呼
      <input name="display_name" defaultValue={user.display_name} maxLength={80} required autoComplete="nickname" /></label>
      <button disabled={busy}>保存资料</button></form>
    <div className="materials"><h2>修改密码</h2><p className="help">修改后将退出所有登录。密码需为 12–128 个字符。</p>
      <form className="stack" onSubmit={event => void submit(event, true)}><label>当前密码
        <input type="password" name="current_password" minLength={12} maxLength={128} autoComplete="current-password" required /></label><label>新密码
        <input type="password" name="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
        <button disabled={busy}>{busy ? '处理中…' : '修改密码并退出'}</button></form></div>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="error">{error}</p> : null}
  </section>;
}
