'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Account, type User } from './account';
import { CourseSpace } from './course-space';
import { Profile } from './profile';
import { Icon } from './icon';
import { api, ApiError } from '../lib/api';

export function Workspace() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'courses' | 'profile'>('courses');
  const [dirty, setDirty] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError('');
    api<User>('users/me', { signal: controller.signal })
      .then(value => { if (active) setUser(value); })
      .catch(error => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          setLoadError(error instanceof Error ? error.message : '无法读取账户，请重试');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [retry]);

  function leaveEditor() {
    return !dirty || window.confirm('课程修改尚未保存。放弃修改并离开？');
  }

  function navigate(next: 'courses' | 'profile') {
    if (next === view || !leaveEditor()) return;
    setDirty(false);
    setView(next);
  }

  async function logout() {
    if (!leaveEditor()) return;
    setBusy(true);
    setNotice('');
    try {
      await api('auth/logout', { method: 'POST' });
      setUser(null);
      setView('courses');
      setDirty(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '退出失败，请重试');
    } finally { setBusy(false); }
  }

  function expired() {
    setUser(null);
    setDirty(false);
    setView('courses');
    setNotice('登录已过期，请重新登录。');
  }

  if (!user) return <div className="entry-shell">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <header className="entry-header">
      <a className="wordmark" href="/"><span className="brand-symbol"><Icon name="book" size={23} /></span>学习工作台</a>
      <Link className="quiet-link" href="/system"><Icon name="pulse" size={17} />连接状态</Link>
    </header>
    <main id="main-content" className="entry-main">
      <aside className="entry-introduction" aria-label="学习空间说明">
        <div className="entry-book"><Icon name="book" size={38} /></div>
        <p className="entry-title">课程与资料，<br />放在同一个工作台。</p>
        <p>整理教材、记录学习目标，<br />为每门课程保留独立的学习空间。</p>
        <div className="entry-principles">
          <div><Icon name="courses" size={19} /><span>按课程整理教材和目标</span></div>
          <div><Icon name="file" size={19} /><span>学习资料随课程保存</span></div>
          <div><Icon name="user" size={19} /><span>只属于你的个人空间</span></div>
        </div>
      </aside>
      <div className="entry-form-region">
        {loading ? <div className="account-skeleton" role="status" aria-label="正在读取账户">
          <div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton" />
          <span className="visually-hidden">正在读取账户…</span>
        </div> : loadError ? <section className="account-panel">
          <h1>暂时无法连接</h1><p className="muted" role="alert">{loadError}</p>
          <button className="button primary" onClick={() => setRetry(value => value + 1)}>重新连接</button>
        </section> : <Account notice={notice} onLogin={value => { setUser(value); setNotice(''); }} />}
      </div>
    </main>
  </div>;

  return <div className="application-shell">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <aside className="app-sidebar">
      <a className="wordmark" href="/"><span className="brand-symbol"><Icon name="book" size={23} /></span>学习工作台</a>
      <nav className="primary-nav" aria-label="主导航">
        <button className={'nav-item' + (view === 'courses' ? ' is-current' : '')}
          aria-current={view === 'courses' ? 'page' : undefined} onClick={() => navigate('courses')}>
          <Icon name="courses" /><span>我的课程</span>
        </button>
        <button className={'nav-item' + (view === 'profile' ? ' is-current' : '')}
          aria-current={view === 'profile' ? 'page' : undefined} onClick={() => navigate('profile')}>
          <Icon name="user" /><span>账户设置</span>
        </button>
      </nav>
      <div className="sidebar-bottom">
        <Link className="nav-item" href="/system" aria-label="连接状态"
          onClick={event => { if (!leaveEditor()) event.preventDefault(); }}><Icon name="pulse" /><span>连接状态</span></Link>
        <div className="sidebar-account">
          <button className="account-shortcut" aria-label={'账户设置，' + user.display_name} onClick={() => navigate('profile')}>
            <span className="avatar">{user.display_name.trim().slice(0, 1) || '我'}</span>
            <span className="account-identity"><strong>{user.display_name}</strong><small>个人学习空间</small></span>
          </button>
          <button className="icon-button logout-button" aria-label="退出登录" title="退出登录" disabled={busy} onClick={logout}>
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </aside>
    <div className="app-body">
      <header className="workspace-topbar">
        <div className="breadcrumb"><span>个人空间</span><Icon name="chevron" size={14} />
          <strong>{view === 'courses' ? '我的课程' : '账户设置'}</strong></div>
        <span className="workspace-user">{user.display_name}</span>
      </header>
      <main id="main-content" className="workspace-main">
        {notice ? <p className="notice error" role="alert"><Icon name="alert" size={18} />{notice}</p> : null}
        {view === 'profile' ? <Profile user={user} onUpdate={setUser} onPasswordChanged={() => {
          expired(); setNotice('密码已修改，请重新登录。');
        }} /> : <CourseSpace onDirtyChange={setDirty} onSessionExpired={expired} />}
      </main>
    </div>
  </div>;
}
