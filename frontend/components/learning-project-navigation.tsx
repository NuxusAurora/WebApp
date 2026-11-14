'use client';

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { getLearningOutline, listLearningTextbooks, type LearningOutline, type LearningSelection, type LearningTextbook } from '../lib/learning';
import { workspaceHref } from '../lib/workspace-navigation';
import { Icon } from './icon';

type Follow = (event: MouseEvent<HTMLAnchorElement>, target: { sectionId: string; pointId?: string }) => void;
type NavigationProps = { selection: LearningSelection | null; revision: number; onSelect: Follow; onSessionExpired: () => void };

function Folder({ title, kind, active, children, textbookId }: {
  title: string; kind: 'textbook' | 'chapter' | 'section'; active: boolean; children: (open: boolean) => ReactNode;
  textbookId?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  return <li data-textbook-id={textbookId}>
    <button type="button" className={`sidebar-item learning-tree-row learning-tree-${kind}`}
      title={title} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Icon name="chevron" size={12} />{kind === 'textbook' ? <Icon name="folder" size={16} /> : null}
      <span>{title}</span>
    </button>
    <ul id={id} className="learning-tree-children" hidden={!open}>{children(open)}</ul>
  </li>;
}

function LearningLink({ title, sectionId, pointId, studied, current, onSelect }: {
  title: string; sectionId: string; pointId?: string; studied?: boolean; current: boolean; onSelect: Follow;
}) {
  const target = { sectionId, pointId };
  return <li><a href={workspaceHref('learning', target)} title={title}
    className={'sidebar-item learning-tree-row ' + (pointId ? 'learning-tree-point' : 'learning-tree-section') +
      (studied ? ' is-studied' : '') + (current ? ' is-current' : '')}
    aria-current={current ? 'page' : undefined} onClick={event => onSelect(event, target)}>
    <span>{title}</span>
  </a></li>;
}

function TextbookContents({ courseId, open, selection, revision, onSelect, onSessionExpired }: NavigationProps & {
  courseId: string; open: boolean;
}) {
  const [outline, setOutline] = useState<LearningOutline | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const task = new AbortController();
    setError('');
    getLearningOutline(courseId, task.signal).then(result => {
      if (!task.signal.aborted) setOutline(result);
    }).catch(reason => {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      else setError(reason instanceof Error ? reason.message : '无法读取教材目录');
    });
    return () => task.abort();
  }, [courseId, open, revision, retry, onSessionExpired]);

  if (error) return <li className="sidebar-project-status">
    <p role="alert">{error}</p>
    <button className="sidebar-item sidebar-project-more" type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
  </li>;
  if (!outline) return open ? <li className="sidebar-project-status" role="status">正在加载目录…</li> : null;
  if (!outline.chapters.length) return <li className="sidebar-project-status">暂无目录</li>;
  return outline.chapters.map(chapter => <Folder key={chapter.id} title={chapter.title} kind="chapter"
    active={selection?.chapterId === chapter.id}>
    {open => !open ? null : chapter.sections.length ? chapter.sections.map(section => section.knowledge_points.length
      ? <Folder key={section.id} title={section.title} kind="section" active={selection?.sectionId === section.id}>
        {open => open && section.knowledge_points.map(point => <LearningLink key={point.id} title={point.title}
          sectionId={section.id} pointId={point.id} studied={point.studied} current={selection?.pointId === point.id} onSelect={onSelect} />)}
      </Folder> : <LearningLink key={section.id} title={section.title} sectionId={section.id}
        current={selection?.sectionId === section.id} onSelect={onSelect} />)
      : <li className="sidebar-project-status">暂无小节</li>}
  </Folder>);
}

export function LearningProjectNavigation({ selection, revision, onSelect, onSessionExpired }: NavigationProps) {
  const [items, setItems] = useState<LearningTextbook[]>([]);
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
      const result = await listLearningTextbooks(task.signal, before);
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
      list.current?.querySelector<HTMLElement>(`[data-textbook-id="${focusId.current}"] button`)?.focus();
      focusId.current = undefined;
    }
  }, [items]);

  return <ul ref={list} className="sidebar-submenu sidebar-projects learning-tree" aria-label="学习教材" aria-busy={busy}>
    {items.map(item => <Folder key={item.id} title={item.title} kind="textbook" active={selection?.courseId === item.id}
      textbookId={item.id}>
      {open => <TextbookContents courseId={item.id} open={open} revision={revision}
        selection={selection?.courseId === item.id ? selection : null} onSelect={onSelect} onSessionExpired={onSessionExpired} />}
    </Folder>)}
    {busy && !loaded ? <li className="sidebar-project-status" role="status">正在加载…</li> : null}
    {loaded && !items.length && !error ? <li className="sidebar-project-status">暂无已确认目录的教材</li> : null}
    {error ? <li className="sidebar-project-status" role="alert">{error}</li> : null}
    {cursor || error ? <li><button className="sidebar-item sidebar-project-more" type="button" aria-disabled={busy}
      onClick={() => { if (!busy) void load(cursor); }}>{busy ? '正在加载…' : error ? '重试' : '加载更多'}</button></li> : null}
  </ul>;
}
