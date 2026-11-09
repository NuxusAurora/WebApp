// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from '../components/app-sidebar';
import { useWorkspaceNavigation, workspaceHref, workspaceView } from '../lib/workspace-navigation';
import { sidebarDOM } from './sidebar-test-dom';

const user = { id: 'one', display_name: '学习者', email: 'student@example.com' };
beforeEach(() => { history.replaceState({}, '', '/'); localStorage.clear(); sidebarDOM(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared sidebar', () => {
  it('restores a collapsed preference, keeps real links and delegates logout through the account menu', () => {
    localStorage.setItem('learning-workspace.sidebar-collapsed', 'true');
    const navigate = vi.fn(() => true); const logout = vi.fn(async () => {});
    render(<AppSidebar user={user} view="ai" busy={false} navigate={navigate} logout={logout} />);
    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('link', { name: '模型设置' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '账户设置' })).toHaveAttribute('href', '/?view=profile');
    expect(screen.getByRole('link', { name: '连接状态' })).toHaveAttribute('href', '/system');
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(localStorage.getItem('learning-workspace.sidebar-collapsed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '账户菜单，学习者' }));
    expect(screen.getByRole('menuitem', { name: '账户设置' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' })); expect(logout).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: '账户菜单，学习者' })).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '我的课程' })); expect(navigate).toHaveBeenCalledWith('courses');
  });
  it('keeps a mobile drawer open when leaving is refused, and closes it after accepted navigation or Escape', () => {
    sidebarDOM(390); const navigate = vi.fn(() => false);
    render(<AppSidebar user={user} view="courses" busy={false} navigate={navigate} logout={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: '打开导航' });
    fireEvent.click(opener); const drawer = screen.getByRole('dialog', { name: '导航菜单' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(screen.getByRole('link', { name: '模型设置' })); expect(drawer).toHaveAttribute('open');
    navigate.mockReturnValue(true); fireEvent.click(screen.getByRole('link', { name: '模型设置' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    fireEvent.click(opener); fireEvent(drawer, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    fireEvent.click(opener); fireEvent.click(drawer, { clientX: 500, clientY: 100 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('defaults to a compact tablet rail and releases media subscriptions on unmount', () => {
    const media = sidebarDOM(900);
    const { unmount } = render(<AppSidebar user={user} view="courses" busy={false} navigate={() => true} logout={vi.fn()} />);
    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true');
    act(() => media.resize(1440)); expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    act(() => media.resize(900)); act(() => media.resize(1440));
    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true');
    unmount(); expect(media.listenerCount()).toBe(0);
  });
  it('survives corrupt or blocked preferences without losing the current collapse state', () => {
    localStorage.setItem('learning-workspace.sidebar-collapsed', 'broken');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<AppSidebar user={user} view="system" busy={false} navigate={() => true} logout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    expect(screen.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('无法保存侧栏偏好');
    expect(screen.getByRole('link', { name: '连接状态' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('URL selection and unsaved protection', () => {
  it('reads refresh URLs and follows navigation without adding business routes', () => {
    history.replaceState({}, '', '/?view=profile');
    const leave = vi.fn(); const { result } = renderHook(() => useWorkspaceNavigation('courses', () => true, leave));
    expect(result.current.view).toBe('profile');
    act(() => { result.current.navigate('ai'); });
    expect(location.pathname + location.search).toBe('/?view=ai'); expect(result.current.view).toBe('ai');
    expect(workspaceView('/system')).toBe('system'); expect(workspaceView('/?view=unknown')).toBe('courses');
    expect(workspaceHref('courses')).toBe('/');
  });
  it('does not clear dirty state on same-view clicks or refused navigation, including browser Back', () => {
    const guard = vi.fn(() => true); const leave = vi.fn();
    const { result } = renderHook(() => useWorkspaceNavigation('courses', guard, leave));
    act(() => { result.current.navigate('ai'); });
    guard.mockReturnValue(false); leave.mockClear(); guard.mockClear();
    act(() => { result.current.navigate('ai'); }); expect(guard).not.toHaveBeenCalled();
    act(() => { expect(result.current.navigate('profile')).toBe(false); });
    expect(location.search).toBe('?view=ai'); expect(leave).not.toHaveBeenCalled();
    const revert = vi.spyOn(history, 'go').mockImplementation(() => {});
    history.replaceState({ workspaceIndex: 0 }, '', '/');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(result.current.view).toBe('ai'); expect(revert).toHaveBeenCalledWith(1); expect(leave).not.toHaveBeenCalled();
  });
});
