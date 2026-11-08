'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { User } from './account';
import { Icon } from './icon';
import { Toast, useToast } from './toast';

const statistics = ['消耗 Token', 'Token 使用峰值', '最长学习项目用时', '最长连续学习天数', '当前连续学习天数'];

export function Profile({ user, onUpdate, onPasswordChanged }: {
  user: User; onUpdate: (user: User) => void; onPasswordChanged: () => void;
}) {
  const [editing, setEditing] = useState<'nickname' | 'password' | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const { notification, notify, dismiss } = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!editing || !dialog.current) return;
    const surface = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    surface.showModal();
    firstField.current?.focus();
    return () => { surface.close(); trigger?.focus({ preventScroll: true }); };
  }, [editing]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function openEditor(section: 'nickname' | 'password') {
    setError(''); setDirty(false); setEditing(section);
  }

  function closeEditor() {
    if (pending || dirty && !window.confirm('修改尚未保存。放弃修改？')) return;
    setEditing(null); setError(''); setDirty(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (editing === 'password') {
        await api('auth/change-password', { method: 'POST', body: JSON.stringify(data) });
        setDirty(false); setEditing(null); onPasswordChanged();
      } else {
        const result = await api<User>('users/me', { method: 'PATCH', body: JSON.stringify(data) });
        onUpdate(result); setDirty(false); setEditing(null); notify('昵称已修改');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试');
      requestAnimationFrame(() => errorElement.current?.focus());
    } finally { setPending(false); }
  }

  return <div className="account-page">
    <div className="page-heading"><h1>账户设置</h1></div>
    <Toast notification={notification} onDismiss={dismiss} />
    <div className="account-overview">
      <section className="profile-identity" aria-label="个人资料">
        <div className="profile-avatar" role="img" aria-label={user.display_name + '的头像'}>
          {user.display_name.trim().slice(0, 2).toLocaleUpperCase() || '我'}
        </div>
        <h2>{user.display_name}</h2><p className="profile-email">{user.email}</p>
      </section>
      <dl className="learning-statistics" aria-label="学习统计">
        {statistics.map(label => <div key={label}><dt>{label}</dt><dd aria-label="暂无统计">—</dd></div>)}
      </dl>
      <p className="statistics-note">学习统计待接入</p>
      <div className="profile-actions" aria-label="账户操作">
        <button className="button" onClick={() => openEditor('password')}>修改密码</button>
        <button className="button" onClick={() => openEditor('nickname')}>修改昵称</button>
        <button className="button" disabled>修改邮箱<span className="action-state">待接入</span></button>
      </div>
    </div>
    {editing ? <dialog ref={dialog} className="profile-dialog" aria-labelledby="profile-dialog-title"
      aria-describedby={editing === 'password' ? 'password-note' : undefined}
      onCancel={event => { event.preventDefault(); closeEditor(); }}>
      <div className="panel-heading"><h2 id="profile-dialog-title">{editing === 'password' ? '修改密码' : '修改昵称'}</h2>
        <button className="icon-button" type="button" aria-label="关闭编辑" disabled={pending} onClick={closeEditor}><Icon name="close" /></button></div>
      {editing === 'password' ? <p className="dialog-description" id="password-note">修改后将退出所有登录。密码需为 12–128 个字符。</p> : null}
      {error ? <p ref={errorElement} tabIndex={-1} role="alert" className="notice error">{error}</p> : null}
      <form className="form-stack" onSubmit={submit} onChange={() => setDirty(true)}>
        <div className="dialog-fields">
          {editing === 'nickname' ? <label>昵称<input ref={firstField} name="display_name" defaultValue={user.display_name}
            maxLength={80} required autoComplete="nickname" /></label> : <>
            <label>当前密码<input ref={firstField} type="password" name="current_password" minLength={12} maxLength={128}
              autoComplete="current-password" required /></label>
            <label>新密码<input type="password" name="password" minLength={12} maxLength={128}
              autoComplete="new-password" required /></label>
          </>}
        </div>
        <div className="dialog-actions"><button className="button" type="button" disabled={pending} onClick={closeEditor}>取消</button>
          <button className="button primary" disabled={pending}>{pending ? '保存中…' : editing === 'password' ? '修改密码并退出' : '保存昵称'}</button></div>
      </form>
    </dialog> : null}
  </div>;
}
