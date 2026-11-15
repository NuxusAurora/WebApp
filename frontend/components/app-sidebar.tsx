'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { User } from './account';
import { Icon } from './icon';
import { LearningProjectNavigation } from './learning-project-navigation';
import { Input } from './ui';
import type { LearningSelection } from '../lib/learning';
import { isModelSettings, modelSettingsItems, workspaceHref, workspaceLabels, type LearningTarget, type WorkspaceView } from '../lib/workspace-navigation';

const preferenceKey = 'learning-workspace.sidebar-collapsed';
const groups = [{ label: '学习', items: [{ view: 'courses', icon: 'courses' }, { view: 'learning', icon: 'chat' }] },
  { label: '设置', items: [{ view: 'ai', icon: 'sliders' }, { view: 'profile', icon: 'user' }] }] as const;

export function AppSidebar({ user, loading = false, view, busy, error = '', navigate, logout, learning, questionsOpen = false }: {
  user: User | null; loading?: boolean; view: WorkspaceView; busy: boolean;
  error?: string;
  questionsOpen?: boolean;
  learning?: { selection: LearningSelection | null; revision: number; textbookAddedCount: number;
    onSelect: (target: LearningTarget) => boolean; onSessionExpired: () => void };
  navigate: (view: WorkspaceView) => boolean; logout: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [compactLearning, setCompactLearning] = useState(false);
  const [keepLearningExpanded, setKeepLearningExpanded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(isModelSettings(view));
  const [learningOpen, setLearningOpen] = useState(view === 'learning');
  const [learningMounted, setLearningMounted] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const textbookAddedCount = learning?.textbookAddedCount ?? 0;
  const [storageNotice, setStorageNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const preference = useRef<boolean | null>(null);
  const learningView = view === 'learning';

  useLayoutEffect(() => {
    try { const saved = localStorage.getItem(preferenceKey); preference.current = saved === 'true' ? true : saved === 'false' ? false : null; } catch { /* Browser preference is optional. */ }
  }, []);
  useLayoutEffect(() => {
    const media = window.matchMedia(learningView ? '(width < 768px)' : '(max-width: 740px)');
    const tablet = window.matchMedia(learningView ? '(768px <= width < 1280px)' : '(min-width: 741px) and (max-width: 1100px)');
    const update = () => {
      setMobile(media.matches);
      setCollapsed(preference.current ?? tablet.matches);
      setCompactLearning(learningView && tablet.matches);
      setKeepLearningExpanded(false);
      setDrawer(false); setMenu(false);
    };
    update(); media.addEventListener('change', update); tablet.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); tablet.removeEventListener('change', update); };
  }, [learningView]);

  useLayoutEffect(() => { setKeepLearningExpanded(false); }, [questionsOpen]);
  const constrainedByQuestions = questionsOpen && compactLearning;
  const rail = !mobile && (constrainedByQuestions ? !keepLearningExpanded : collapsed);
  const learningVisible = learningOpen && !rail;
  const searchOpen = query !== null;

  useEffect(() => {
    if (learningVisible && (!mobile || drawer)) setLearningMounted(true);
  }, [learningVisible, mobile, drawer]);
  useLayoutEffect(() => {
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  useLayoutEffect(() => {
    const element = dialog.current; if (!element) return;
    // A single dialog is nonmodal on desktop and modal on mobile: the browser owns
    // background inertness, focus containment, Escape and scroll isolation.
    if (element.open) element.close();
    if (!mobile) element.open = true;
    else if (drawer) element.showModal();
    else opener.current?.focus({ preventScroll: true });
  }, [mobile, drawer]);
  useEffect(() => { setDrawer(false); setMenu(false); }, [view]);
  useEffect(() => { if (view === 'learning') setLearningOpen(true); }, [view, learning?.selection?.sectionId]);
  useEffect(() => { if (textbookAddedCount) setLearningOpen(true); }, [textbookAddedCount]);
  useEffect(() => { if (isModelSettings(view)) setModelsOpen(true); }, [view]);
  useEffect(() => () => { dialog.current?.close(); }, []);

  useEffect(() => {
    if (!menu) return;
    accountMenu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node) && !accountButton.current?.contains(event.target as Node)) setMenu(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!accountMenu.current?.contains(event.target as Node) && !accountButton.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [menu]);

  function toggle() {
    if (constrainedByQuestions) {
      setKeepLearningExpanded(!keepLearningExpanded);
      return;
    }
    const next = !collapsed; preference.current = next; setCollapsed(next);
    try { localStorage.setItem(preferenceKey, String(next)); setStorageNotice(''); }
    catch { setStorageNotice('无法保存侧栏偏好，本次使用仍有效。'); }
  }
  function follow(event: MouseEvent<HTMLAnchorElement>, next: WorkspaceView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigate(next)) { setDrawer(false); setMenu(false); }
  }
  function followProject(event: MouseEvent<HTMLAnchorElement>, target: LearningTarget) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (learning?.onSelect(target)) { setDrawer(false); setMenu(false); }
  }
  function navItem(next: WorkspaceView, icon: 'courses' | 'sliders' | 'user' | 'pulse') {
    return <a href={workspaceHref(next)} className={'sidebar-item' + (view === next ? ' is-current' : '')}
      aria-current={view === next ? 'page' : undefined} aria-label={workspaceLabels[next]} onClick={event => follow(event, next)}>
      <Icon name={icon} size={18} /><span className="sidebar-label">{workspaceLabels[next]}</span>
      <span className="sidebar-tooltip" role="tooltip">{workspaceLabels[next]}</span>
    </a>;
  }

  return <>
    <button ref={opener} type="button" className="sidebar-mobile-trigger" aria-label="打开导航" aria-expanded={mobile && drawer}
      aria-controls="workspace-sidebar" onClick={() => setDrawer(true)}><Icon name="menu" size={20} /></button>
    <dialog ref={dialog} id="workspace-sidebar" className="workspace-sidebar" data-collapsed={rail} data-mobile={mobile}
      role={mobile ? 'dialog' : 'complementary'} aria-label={mobile ? '导航菜单' : '侧边栏'} aria-modal={mobile && drawer ? true : undefined}
      onCancel={event => { event.preventDefault(); if (menu) { setMenu(false); accountButton.current?.focus(); } else setDrawer(false); }}
      onClick={event => {
        if (!mobile || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setDrawer(false);
      }}>
      <div className="sidebar-header">
        <a className="sidebar-brand" href="/" aria-label="学习工作台" onClick={event => follow(event, 'courses')}>
          <span className="sidebar-brand-icon"><Icon name="book" size={23} /></span>
          <span className="sidebar-brand-copy"><strong>学习工作台</strong><small>LEARNING STUDIO</small></span>
        </a>
        <button type="button" className="sidebar-toggle" aria-label={mobile ? '关闭导航' : rail ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={mobile ? drawer : !rail} onClick={() => mobile ? setDrawer(false) : toggle()}>
          <Icon name={mobile ? 'close' : rail ? 'panel-open' : 'panel-close'} size={17} />
          <span className="sidebar-tooltip" role="tooltip">{mobile ? '关闭导航' : rail ? '展开侧边栏' : '收起侧边栏'}</span>
        </button>
      </div>
      <nav className="sidebar-navigation" aria-label="主导航">
        {groups.map(group => <div className="sidebar-group" key={group.label}>
          <span className="sidebar-group-label">{group.label}</span>
          {group.items.map(item => <div key={item.view}>{item.view === 'ai' ? <>
            <button type="button" className={'sidebar-item sidebar-model-heading' + (isModelSettings(view) ? ' is-active' : '')}
              aria-label="模型设置" aria-expanded={modelsOpen && !rail} aria-controls="model-settings-navigation"
              onClick={() => { if (rail) { toggle(); setModelsOpen(true); } else setModelsOpen(value => !value); }}>
              <Icon name="sliders" size={18} /><span className="sidebar-label">模型设置</span>
              <span className="sidebar-submenu-chevron"><Icon name="chevron" size={14} /></span>
              <span className="sidebar-tooltip" role="tooltip">模型设置</span>
            </button>
            <ul id="model-settings-navigation" className="sidebar-submenu motion-disclosure" aria-label="模型设置" hidden={!modelsOpen} inert={!modelsOpen} aria-hidden={!modelsOpen}>
              {modelSettingsItems.map(child => <li key={child.view}><a href={workspaceHref(child.view)} className={'sidebar-item' + (view === child.view ? ' is-current' : '')}
                aria-current={view === child.view ? 'page' : undefined} onClick={event => follow(event, child.view)}>{child.label}</a></li>)}
            </ul>
          </> : item.view === 'learning' ? user && learning ? <>
            <div className="sidebar-learning-heading">
              <button id="learning-navigation-toggle" type="button" className={'sidebar-item sidebar-model-heading' + (view === 'learning' ? ' is-active' : '')}
                aria-label="学习对话" aria-expanded={learningVisible} aria-controls="learning-project-navigation"
                onClick={() => {
                  if (rail) toggle();
                  setLearningOpen(!learningVisible);
                  if (learningVisible) setQuery(null);
                }}>
                <Icon name="chat" size={18} /><span className="sidebar-label">学习对话</span>
                <span className="sidebar-submenu-chevron"><Icon name="chevron" size={14} /></span>
                <span className="sidebar-tooltip" role="tooltip">学习对话</span>
              </button>
              {!rail ? <button ref={searchButton} type="button" className="sidebar-item sidebar-search-toggle"
                aria-label="搜索目录" title="搜索目录" aria-expanded={learningVisible && searchOpen} aria-controls={searchId}
                onClick={() => { setLearningOpen(true); setQuery(searchOpen ? null : ''); }}>
                <Icon name="search" size={18} />
              </button> : null}
            </div>
            <div id="learning-project-navigation" className="motion-disclosure"
              hidden={!learningVisible} inert={!learningVisible} aria-hidden={!learningVisible}>
              <div id={searchId} className="motion-disclosure" hidden={!searchOpen} inert={!searchOpen} aria-hidden={!searchOpen}>
                <div className="learning-tree-search">
                  <label htmlFor={searchId + '-input'} className="visually-hidden">搜索已加载的学习目录</label>
                  <Input ref={searchInput} id={searchId + '-input'} type="search" value={query ?? ''}
                    onChange={event => setQuery(event.target.value)} placeholder="搜索已加载目录" autoComplete="off"
                    onKeyDown={event => {
                      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                      event.preventDefault(); event.stopPropagation();
                      setQuery(null); searchButton.current?.focus({ preventScroll: true });
                    }} />
                </div>
              </div>
              {learningMounted || learningVisible && (!mobile || drawer) ? <LearningProjectNavigation key={user.id} selection={learning.selection}
                revision={learning.revision} query={query ?? ''} onSelect={followProject} onSessionExpired={learning.onSessionExpired} /> : null}
            </div>
          </> : null : navItem(item.view, item.icon)}</div>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom-area">
        {storageNotice ? <span className="sidebar-storage-notice" role="status">{storageNotice}</span> : null}
        <div className="sidebar-connection">{navItem('system', 'pulse')}</div>
        <div className="sidebar-user">
          {user ? <>
            <button ref={accountButton} className="sidebar-user-trigger" type="button" aria-label={'账户菜单，' + user.display_name}
              aria-haspopup="menu" aria-expanded={menu} aria-controls="sidebar-user-menu" onClick={() => setMenu(value => !value)}>
              <span className="avatar sidebar-avatar">{user.display_name.trim().slice(0, 1) || '我'}</span>
              <span className="sidebar-user-copy"><strong>{user.display_name}</strong><small>个人学习空间</small></span>
              <Icon name="more" size={18} /><span className="sidebar-tooltip" role="tooltip">{user.display_name} · 账户菜单</span>
            </button>
            <div ref={accountMenu} className="sidebar-user-menu" role="menu" id="sidebar-user-menu" aria-label="账户操作" data-open={menu} inert={!menu} aria-hidden={!menu}
              onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(false); accountButton.current?.focus(); }
                if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
                  const index = items.indexOf(document.activeElement as HTMLButtonElement);
                  items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
                }
              }}>
              <button type="button" role="menuitem" onClick={() => { if (navigate('profile')) { setMenu(false); setDrawer(false); } }}><Icon name="user" size={18} />账户设置</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => void logout()}><Icon name="logout" size={18} />{busy ? '正在退出…' : '退出登录'}</button>
              {mobile && error ? <p className="sidebar-menu-error" role="alert">{error}</p> : null}
            </div>
          </> : <a className="sidebar-item" href="/" aria-label={loading ? '读取账户…' : '登录工作台'} onClick={event => follow(event, 'courses')}><Icon name="user" size={18} /><span className="sidebar-label">{loading ? '读取账户…' : '登录工作台'}</span><span className="sidebar-tooltip" role="tooltip">{loading ? '读取账户…' : '登录工作台'}</span></a>}
        </div>
      </div>
    </dialog>
  </>;
}
