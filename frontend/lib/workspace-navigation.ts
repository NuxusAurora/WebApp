'use client';

import { useEffect, useRef, useState } from 'react';

export type WorkspaceView = 'courses' | 'ai' | 'ai-models' | 'ai-logs' | 'profile' | 'system';
export const modelSettingsItems = [{ view: 'ai', label: '连接与密钥' }, { view: 'ai-models', label: '模型与测试' }, { view: 'ai-logs', label: '调用记录' }] as const;
export const isModelSettings = (view: WorkspaceView) => view === 'ai' || view === 'ai-models' || view === 'ai-logs';
export const workspaceLabels: Record<WorkspaceView, string> = { courses: '我的课程', ai: '模型设置', 'ai-models': '模型与测试', 'ai-logs': '调用记录', profile: '账户设置', system: '连接状态' };
export function workspaceHref(view: WorkspaceView) {
  return view === 'system' ? '/system' : view === 'courses' ? '/' : view === 'ai-models' ? '/?view=ai&tab=models' : view === 'ai-logs' ? '/?view=ai&tab=logs' : '/?view=' + view;
}
export function workspaceView(url: string): WorkspaceView {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === '/system') return 'system';
  const view = parsed.searchParams.get('view');
  if (view === 'ai') return parsed.searchParams.get('tab') === 'models' ? 'ai-models' : parsed.searchParams.get('tab') === 'logs' ? 'ai-logs' : 'ai';
  return view === 'profile' ? view : 'courses';
}

// The URL owns the selection; the shell supplies its existing unsaved-change guard.
export function useWorkspaceNavigation(initial: WorkspaceView, canLeave: () => boolean, onLeave: () => void) {
  const [view, setView] = useState(initial);
  const current = useRef({ view: initial, href: workspaceHref(initial), index: 0 });
  const callbacks = useRef({ canLeave, onLeave });
  callbacks.current = { canLeave, onLeave };
  useEffect(() => {
    const index = Number.isInteger(history.state?.workspaceIndex) ? history.state.workspaceIndex : 0;
    const next = workspaceView(location.href);
    current.current = { view: next, href: location.pathname + location.search + location.hash, index };
    history.replaceState({ ...history.state, workspaceIndex: index }, '', location.href);
    setView(next);
    let reverting = false;
    const pop = () => {
      if (reverting) { reverting = false; return; }
      const next = workspaceView(location.href);
      const index = Number.isInteger(history.state?.workspaceIndex) ? history.state.workspaceIndex : null;
      if (next !== current.current.view && !callbacks.current.canLeave()) {
        if (index !== null && index !== current.current.index) { reverting = true; history.go(current.current.index - index); }
        else history.replaceState({ ...history.state, workspaceIndex: current.current.index }, '', current.current.href);
        return;
      }
      if (next !== current.current.view) callbacks.current.onLeave();
      current.current = { view: next, href: location.pathname + location.search + location.hash, index: index ?? current.current.index };
      setView(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  function navigate(next: WorkspaceView, reset = false) {
    if (!reset && next === current.current.view) return true;
    if (!reset && !callbacks.current.canLeave()) return false;
    callbacks.current.onLeave();
    const index = current.current.index + (reset ? 0 : 1);
    const href = workspaceHref(next);
    history[reset ? 'replaceState' : 'pushState']({ ...history.state, workspaceIndex: index }, '', href);
    current.current = { view: next, href, index }; setView(next);
    return true;
  }
  return { view, navigate };
}
