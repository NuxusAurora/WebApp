import { useState } from 'react';
import { api } from './product/lib/api';
export type User = { id: string; display_name: string; email: string };

export function Account({onLogin, notice = ''}: {onLogin: (user: User) => void; notice?: string; testLoginEnabled?: boolean}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function enter() {
    setBusy(true); setError('');
    try { onLogin(await api<User>('auth/test-login', {method:'POST'})); }
    catch (error) { setError(error instanceof Error ? error.message : '暂时无法进入，请重试。'); }
    finally { setBusy(false); }
  }
  return <section className="account-panel" aria-labelledby="account-title">
    <h1 id="account-title">学习工作台</h1>
    <p className="account-description">公开体验版</p>
    <p className="demo-intro">创建课程、整理资料，试用你的学习空间。</p>
    <p className="muted demo-intro">示例和改动仅保存在此浏览器，清除网站数据后会丢失。</p>
    {notice ? <p className="notice info" role="status">{notice}</p> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <button className="button primary demo-enter" disabled={busy} onClick={() => void enter()}>{busy ? '正在进入…' : '测试登录'}</button>
  </section>;
}
