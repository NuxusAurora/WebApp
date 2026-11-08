'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Account, type User } from './account';
import { CourseSpace } from './course-space';
import { api, ApiError } from '../lib/api';
import { Profile } from './profile';

export function Workspace() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(false);
  useEffect(() => { let active = true;
    api<User>('users/me').then(user => { if (active) setUser(user); }).catch(error => {
      if (active && !(error instanceof ApiError && error.status === 401)) setError(error.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function logout() {
    setBusy(true); setError('');
    try { await api('auth/logout', { method: 'POST' }); setUser(null); setProfile(false); }
    catch (error) { setError(error instanceof Error ? error.message : '退出失败，请重试'); }
    finally { setBusy(false); }
  }
  return <><a href="#main-content" className="skip-link">跳到主要内容</a><header className="topbar"><Link className="brand" href="/"><span className="mark" aria-hidden="true">∑</span>学习工作台</Link>
    <nav aria-label="主导航"><Link href="/system">连接状态</Link>{user ? <><button className="text-button" onClick={() => setProfile(value => !value)}>{profile ? '返回课程' : user.display_name}</button><button disabled={busy} onClick={logout}>退出</button></> : null}</nav></header>
    <main id="main-content" className={user ? 'wide-main' : ''}>{error ? <p className="error" role="alert">{error}</p> : null}
      {loading ? <p role="status">正在读取账户…</p> : user ? profile ? <Profile user={user} onUpdate={setUser} onPasswordChanged={() => { setUser(null); setProfile(false); setError('密码已修改，请重新登录'); }} /> : <CourseSpace key={user.id} /> : <Account onLogin={user => { setUser(user); setError(''); }} />}</main>
    <footer>AI Structured Learning</footer></>;
}
