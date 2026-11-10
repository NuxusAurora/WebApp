'use client';

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { User } from './account';
import { Icon } from './icon';
import { isModelSettings, modelSettingsItems, workspaceHref, workspaceLabels, type WorkspaceView } from '../lib/workspace-navigation';

const preferenceKey = 'learning-workspace.sidebar-collapsed';
const groups = [{ label: '学习', items: [{ view: 'courses', icon: 'courses' }] },
  { label: '设置', items: [{ view: 'ai', icon: 'sliders' }, { view: 'profile', icon: 'user' }] }] as const;

export function AppSidebar({ user, loading = false, view, busy, error = '', navigate, logout }: {
  user: User | null; loading?: boolean; view: WorkspaceView; busy: boolean;
  error?: string;
  navigate: (view: WorkspaceView) => boolean; logout: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(isModelSettings(view));
  const [storageNotice, setStorageNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const preference = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 740px)');
    const tablet = window.matchMedia('(min-width: 741px) and (max-width: 1100px)');
    try { const saved = localStorage.getItem(preferenceKey); preference.current = saved === 'true' ? true : saved === 'false' ? false : null; } catch { /* Browser preference is optional. */ }
    const update = () => {
      setMobile(media.matches);
      setCollapsed(preference.current ?? tablet.matches);
      setDrawer(false); setMenu(false);
    };
    update(); media.addEventListener('change', update); tablet.addEventListener('change', update);
    return () => { media.removeEventListener('change', update); tablet.removeEventListener('change', update); };
  }, []);

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
    const next = !collapsed; preference.current = next; setCollapsed(next);
    try { localStorage.setItem(preferenceKey, String(next)); setStorageNotice(''); }
    catch { setStorageNotice('无法保存侧栏偏好，本次使用仍有效。'); }
  }
  function follow(event: MouseEvent<HTMLAnchorElement>, next: WorkspaceView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigate(next)) { setDrawer(false); setMenu(false); }
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
    <dialog ref={dialog} id="workspace-sidebar" className="workspace-sidebar" data-collapsed={collapsed && !mobile}
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
        <button type="button" className="sidebar-toggle" aria-label={mobile ? '关闭导航' : collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={mobile ? drawer : !collapsed} onClick={() => mobile ? setDrawer(false) : toggle()}>
          <Icon name={mobile ? 'close' : collapsed ? 'panel-open' : 'panel-close'} size={17} />
          <span className="sidebar-tooltip" role="tooltip">{mobile ? '关闭导航' : collapsed ? '展开侧边栏' : '收起侧边栏'}</span>
        </button>
      </div>
      <nav className="sidebar-navigation" aria-label="主导航">
        {groups.map(group => <div className="sidebar-group" key={group.label}>
          <span className="sidebar-group-label">{group.label}</span>
          {group.items.map(item => <div key={item.view}>{item.view === 'ai' ? <>
            <button type="button" className={'sidebar-item sidebar-model-heading' + (isModelSettings(view) ? ' is-active' : '')}
              aria-label="模型设置" aria-expanded={modelsOpen && (!collapsed || mobile)} aria-controls="model-settings-navigation"
              onClick={() => { if (collapsed && !mobile) { toggle(); setModelsOpen(true); } else setModelsOpen(value => !value); }}>
              <Icon name="sliders" size={18} /><span className="sidebar-label">模型设置</span>
              <span className="sidebar-submenu-chevron"><Icon name="chevron" size={14} /></span>
              <span className="sidebar-tooltip" role="tooltip">模型设置</span>
            </button>
            <ul id="model-settings-navigation" className="sidebar-submenu" aria-label="模型设置" hidden={!modelsOpen}>
              {modelSettingsItems.map(child => <li key={child.view}><a href={workspaceHref(child.view)} className={'sidebar-item' + (view === child.view ? ' is-current' : '')}
                aria-current={view === child.view ? 'page' : undefined} onClick={event => follow(event, child.view)}>{child.label}</a></li>)}
            </ul>
          </> : navItem(item.view, item.icon)}</div>)}
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
            {menu ? <div ref={accountMenu} className="sidebar-user-menu" role="menu" id="sidebar-user-menu" aria-label="账户操作"
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
            </div> : null}
          </> : <a className="sidebar-item" href="/" aria-label={loading ? '读取账户…' : '登录工作台'} onClick={event => follow(event, 'courses')}><Icon name="user" size={18} /><span className="sidebar-label">{loading ? '读取账户…' : '登录工作台'}</span><span className="sidebar-tooltip" role="tooltip">{loading ? '读取账户…' : '登录工作台'}</span></a>}
        </div>
      </div>
    </dialog>
  </>;
}
