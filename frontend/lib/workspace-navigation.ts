'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkspaceView = 'courses' | 'learning' | 'ai' | 'ai-models' | 'ai-logs' | 'profile' | 'system';
export const modelSettingsItems = [{ view: 'ai', label: '连接与密钥' }, { view: 'ai-models', label: '模型与测试' }, { view: 'ai-logs', label: '调用记录' }] as const;
export const isModelSettings = (view: WorkspaceView) => view === 'ai' || view === 'ai-models' || view === 'ai-logs';
export const workspaceLabels: Record<WorkspaceView, string> = { courses: '我的课程', learning: '学习对话', ai: '模型设置', 'ai-models': '模型与测试', 'ai-logs': '调用记录', profile: '账户设置', system: '连接状态' };
export function workspaceHref(view: WorkspaceView, projectId?: string) {
  if (view === 'learning' && projectId) return '/?view=learning&project=' + encodeURIComponent(projectId);
  return view === 'system' ? '/system' : view === 'courses' ? '/' : view === 'ai-models' ? '/?view=ai&tab=models' : view === 'ai-logs' ? '/?view=ai&tab=logs' : '/?view=' + view;
}
export function workspaceView(url: string): WorkspaceView {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === '/system') return 'system';
  const view = parsed.searchParams.get('view');
  if (view === 'ai') return parsed.searchParams.get('tab') === 'models' ? 'ai-models' : parsed.searchParams.get('tab') === 'logs' ? 'ai-logs' : 'ai';
  return view === 'profile' || view === 'learning' ? view : 'courses';
}

function learningProjectId(url: string, view: WorkspaceView) {
  if (view !== 'learning') return null;
  const id = new URL(url, 'http://localhost').searchParams.get('project');
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

// The URL owns the selection; the shell supplies its existing unsaved-change guard.
export function useWorkspaceNavigation(initial: WorkspaceView, canLeave: () => boolean, onLeave: () => void) {
  const [{ view, projectId }, setSelection] = useState({ view: initial, projectId: null as string | null });
  const current = useRef({ view: initial, href: workspaceHref(initial), index: 0 });
  const callbacks = useRef({ canLeave, onLeave });
  callbacks.current = { canLeave, onLeave };
  useEffect(() => {
    const index = Number.isInteger(history.state?.workspaceIndex) ? history.state.workspaceIndex : 0;
    const next = workspaceView(location.href);
    current.current = { view: next, href: location.pathname + location.search + location.hash, index };
    history.replaceState({ ...history.state, workspaceIndex: index }, '', location.href);
    setSelection({ view: next, projectId: learningProjectId(location.href, next) });
    let reverting = false;
    const pop = () => {
      if (reverting) { reverting = false; return; }
      const next = workspaceView(location.href);
      const index = Number.isInteger(history.state?.workspaceIndex) ? history.state.workspaceIndex : null;
      const href = location.pathname + location.search + location.hash;
      const id = learningProjectId(href, next);
      const changed = next !== current.current.view || id !== learningProjectId(current.current.href, current.current.view);
      if (changed && !callbacks.current.canLeave()) {
        if (index !== null && index !== current.current.index) { reverting = true; history.go(current.current.index - index); }
        else history.replaceState({ ...history.state, workspaceIndex: current.current.index }, '', current.current.href);
        return;
      }
      if (changed) callbacks.current.onLeave();
      current.current = { view: next, href, index: index ?? current.current.index };
      setSelection({ view: next, projectId: id });
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const navigate = useCallback((next: WorkspaceView, reset = false, id?: string) => {
    const href = workspaceHref(next, id);
    const nextProjectId = learningProjectId(href, next);
    if (!reset && next === current.current.view && nextProjectId === learningProjectId(current.current.href, current.current.view)) return true;
    if (!reset && !callbacks.current.canLeave()) return false;
    callbacks.current.onLeave();
    const index = current.current.index + (reset ? 0 : 1);
    history[reset ? 'replaceState' : 'pushState']({ ...history.state, workspaceIndex: index }, '', href);
    current.current = { view: next, href, index };
    setSelection({ view: next, projectId: nextProjectId });
    return true;
  }, []);
  return { view, projectId, navigate };
}
