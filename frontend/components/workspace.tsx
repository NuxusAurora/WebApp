'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Account, type User } from './account';
import { CourseSpace } from './course-space';
import { Profile } from './profile';
import { AISettings } from './ai-settings';
import { Icon } from './icon';
import { AppSidebar } from './app-sidebar';
import { LearningConversation } from './learning-conversation';
import { ConnectionStatus } from './connection-status';
import { Breadcrumb, type BreadcrumbItem } from './ui';
import { isModelSettings, modelSettingsItems, useWorkspaceNavigation, workspaceHref, workspaceLabels, type LearningTarget } from '../lib/workspace-navigation';
import { api, ApiError } from '../lib/api';
import type { LearningSelection, LearningTextbookChanges } from '../lib/learning';
import { usePageMotion } from '../lib/page-motion';
import { WorkspaceOperations } from '../lib/workspace-operations';

export function Workspace({ accountNotice = '', systemView = false }: {
  accountNotice?: string; systemView?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [aiBusy, setAIBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [courseCrumbs, setCourseCrumbs] = useState<BreadcrumbItem[]>([]);
  const [learningRevision, setLearningRevision] = useState(0);
  const [textbookAddedCount, setTextbookAddedCount] = useState(0);
  const [textbookChanges, setTextbookChanges] = useState<LearningTextbookChanges>(() => new Map());
  const [openedLearning, setOpenedLearning] = useState<{ target: LearningTarget; selection: LearningSelection } | null>(null);
  const [questionTarget, setQuestionTarget] = useState<LearningTarget | null>(null);
  const { view, target, navigate } = useWorkspaceNavigation(systemView ? 'system' : 'courses', leaveEditor, () => setDirty(false));
  const selection = target && openedLearning?.target === target ? openedLearning.selection : null;
  const href = workspaceHref(view, target ?? undefined);
  const main = usePageMotion<HTMLElement>(`${user?.id ?? 'guest'}:${href}`);
  const refreshLearning = useCallback(() => setLearningRevision(value => value + 1), []);
  const recordTextbookChange = useCallback((courseId: string, added: boolean) => {
    setTextbookChanges(previous => new Map(previous).set(courseId, { added }));
  }, []);
  const textbookAdded = useCallback((courseId: string) => {
    recordTextbookChange(courseId, true);
    setTextbookAddedCount(value => value + 1);
    refreshLearning();
  }, [recordTextbookChange, refreshLearning]);
  const textbookRemoved = useCallback((courseId: string) => {
    recordTextbookChange(courseId, false);
  }, [recordTextbookChange]);
  const learningOpened = useCallback((target: LearningTarget, selection: LearningSelection) => {
    setOpenedLearning({ target, selection });
  }, []);
  const questionsChanged = useCallback((open: boolean) => setQuestionTarget(open ? target : null), [target]);
  const openLearning = useCallback((target: LearningTarget) => navigate('learning', false, target), [navigate]);

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

  useEffect(() => {
    if (view !== 'learning' || !dirty) return;
    function guard(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [view, dirty]);

  function leaveEditor() {
    if (isModelSettings(view) && aiBusy) return false;
    return !dirty || window.confirm('修改尚未保存。放弃修改并离开？');
  }

  async function logout() {
    if (!leaveEditor()) return;
    setBusy(true);
    setNotice('');
    try {
      await api('auth/logout', { method: 'POST' });
      setTextbookChanges(new Map());
      setUser(null);
      navigate('courses', true);
      setDirty(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '退出失败，请重试');
    } finally { setBusy(false); }
  }

  const expired = useCallback(() => {
    setTextbookChanges(new Map());
    setUser(null);
    setDirty(false);
    navigate('courses', true);
    setNotice('登录已过期，请重新登录。');
  }, [navigate]);

  if (!user && view !== 'system') return <div className="entry-shell">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <header className="entry-header">
      <a className="wordmark" href="/"><span className="brand-symbol"><Icon name="book" size={23} /></span>学习工作台</a>
      <Link className="quiet-link" href="/system"><Icon name="pulse" size={17} />连接状态</Link>
    </header>
    <main id="main-content" className="entry-main">
      <div className="entry-form-region">
        {loading ? <div className="account-skeleton" role="status" aria-label="正在读取账户">
          <div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton" />
          <span className="visually-hidden">正在读取账户…</span>
        </div> : loadError ? <section className="account-panel">
          <h1>暂时无法连接</h1><p className="muted" role="alert">{loadError}</p>
          <button className="button primary" onClick={() => setRetry(value => value + 1)}>重新连接</button>
        </section> : <Account notice={notice || accountNotice} onLogin={value => { setUser(value); setNotice(''); }} />}
      </div>
    </main>
  </div>;

  return <div className={`application-shell workspace-shell${view === 'learning' ? ' learning-shell' : ''}`}>
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <AppSidebar user={user} loading={loading} view={view} busy={busy} error={notice} navigate={navigate} logout={logout}
      learning={{ selection, revision: learningRevision, textbookAddedCount,
        onSelect: openLearning, onSessionExpired: expired, onTextbookRemoved: textbookRemoved }}
      questionsOpen={view === 'learning' && target !== null && target === questionTarget} />
    <div className="app-body">
      {view !== 'learning' ? <header className="workspace-topbar">
        <Breadcrumb>
          {view === 'courses' && courseCrumbs.length ? courseCrumbs.map((item, index) => <Fragment key={index}>
            {index ? <Icon name="chevron" size={14} /> : null}
            {item.onSelect ? <button type="button" disabled={item.disabled} onClick={item.onSelect} title={item.label}>{item.label}</button> :
              <strong aria-current={index === courseCrumbs.length - 1 ? 'page' : undefined} title={item.label}>{item.label}</strong>}
          </Fragment>) : isModelSettings(view) ? <><span>模型设置</span><Icon name="chevron" size={14} /><strong aria-current="page">{modelSettingsItems.find(item => item.view === view)?.label}</strong></> : <strong aria-current="page">{workspaceLabels[view]}</strong>}</Breadcrumb>
      </header> : null}
      <main ref={main} id="main-content" className={`workspace-main${isModelSettings(view) ? ' workspace-main-settings' : view === 'courses' ? ' workspace-main-courses' : view === 'system' ? ' workspace-main-status' : ''}`}>
        {notice ? <p className="notice error" role="alert"><Icon name="alert" size={18} />{notice}</p> : null}
        <WorkspaceOperations key={user?.id} onExpired={expired}>
          {view === 'system' ? <div className="status-page"><ConnectionStatus /></div> : user && (isModelSettings(view) ? <AISettings key={user.id} tab={view === 'ai-models' ? 'models' : view === 'ai-logs' ? 'logs' : 'connection'} onTabChange={() => navigate('ai')} onBusyChange={setAIBusy} onDirtyChange={setDirty} onSessionExpired={expired} /> : view === 'profile' ? <Profile user={user} onUpdate={setUser} onSessionExpired={expired} onCoursesChanged={refreshLearning} onPasswordChanged={() => {
            expired(); setNotice('密码已修改，请重新登录。');
          }} /> : view === 'learning' ? <LearningConversation key={user.id + ':' + href} target={target}
            onOpened={learningOpened} onOutlineChanged={refreshLearning} onQuestionsChange={questionsChanged}
            onDirtyChange={setDirty} onSessionExpired={expired} /> : <CourseSpace onDirtyChange={setDirty} onSessionExpired={expired}
            onBreadcrumbChange={setCourseCrumbs} onTextbookAdded={textbookAdded}
            textbookChanges={textbookChanges} onCoursesChanged={refreshLearning} />)}
        </WorkspaceOperations>
      </main>
    </div>
  </div>;
}
