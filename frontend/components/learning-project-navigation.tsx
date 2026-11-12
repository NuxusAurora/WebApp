'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { ApiError } from '../lib/api';
import { listLearningProjects, type LearningProject } from '../lib/learning';
import { workspaceHref } from '../lib/workspace-navigation';

export function LearningProjectNavigation({ projectId, revision, onSelect, onSessionExpired }: {
  projectId: string | null;
  revision: number;
  onSelect: (event: MouseEvent<HTMLAnchorElement>, projectId: string) => void;
  onSessionExpired: () => void;
}) {
  const [items, setItems] = useState<LearningProject[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const focusId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(async (before: string | null) => {
    if (request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(true);
    setError('');
    try {
      const result = await listLearningProjects(task.signal, before);
      if (task.signal.aborted) return;
      if (before && list.current?.contains(document.activeElement)) focusId.current = result.items[0]?.id;
      setItems(previous => {
        if (!before) return result.items;
        const ids = new Set(previous.map(item => item.id));
        return previous.concat(result.items.filter(item => !ids.has(item.id)));
      });
      setCursor(result.next_cursor);
      setLoaded(true);
    } catch (reason) {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      else setError(reason instanceof Error ? reason.message : '无法读取对话列表');
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(false);
      }
    }
  }, [onSessionExpired]);

  useEffect(() => {
    setCursor(null);
    void load(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load, revision]);

  useEffect(() => {
    if (focusId.current) {
      list.current?.querySelector<HTMLElement>(`[data-project-id="${focusId.current}"]`)?.focus();
      focusId.current = undefined;
    }
  }, [items]);

  return <ul ref={list} className="sidebar-submenu sidebar-projects" aria-label="最近的学习对话" aria-busy={busy}>
    {items.map(item => <li key={item.id}>
      <a href={workspaceHref('learning', item.id)} data-project-id={item.id}
        className={'sidebar-item sidebar-project' + (projectId === item.id ? ' is-current' : '')}
        aria-current={projectId === item.id ? 'page' : undefined}
        title={item.course_title + ' · ' + item.section_title} onClick={event => onSelect(event, item.id)}>
        <span>{item.section_title}</span><small>{item.course_title}</small>
      </a>
    </li>)}
    {busy && !loaded ? <li className="sidebar-project-status" role="status">正在加载…</li> : null}
    {loaded && !items.length && !error ? <li className="sidebar-project-status">还没有学习对话</li> : null}
    {error ? <li className="sidebar-project-status" role="alert">{error}</li> : null}
    {cursor || error ? <li><button className="sidebar-item sidebar-project-more" type="button" aria-disabled={busy}
      onClick={() => { if (!busy) void load(cursor); }}>{busy ? '正在加载…' : error ? '重试' : '加载更多'}</button></li> : null}
  </ul>;
}
