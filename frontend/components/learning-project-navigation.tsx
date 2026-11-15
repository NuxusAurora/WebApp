'use client';

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { getLearningOutline, listLearningTextbooks, type LearningOutline, type LearningSelection, type LearningTextbook } from '../lib/learning';
import { workspaceHref } from '../lib/workspace-navigation';
import { Icon } from './icon';
import { RemoveLearningTextbook } from './remove-learning-textbook';
import { Input } from './ui';

type Follow = (event: MouseEvent<HTMLAnchorElement>, target: { sectionId: string; pointId?: string }) => void;
type NavigationProps = { selection: LearningSelection | null; revision: number; onSelect: Follow; onSessionExpired: () => void };

function Folder({ title, kind, active, children, textbookId, action }: {
  title: string; kind: 'textbook' | 'chapter' | 'section'; active: boolean; children: (open: boolean) => ReactNode;
  textbookId?: string;
  action?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  const toggle = <button type="button" className={`sidebar-item learning-tree-row learning-tree-${kind}`}
      title={title} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Icon name="chevron" size={12} />{kind === 'textbook' ? <Icon name="folder" size={16} /> : null}
      <span className="learning-tree-label">{title}</span>
    </button>;
  return <li data-textbook-id={textbookId}>
    {action ? <div className="learning-textbook-actions">{toggle}{action}</div> : toggle}
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
    {pointId ? <span className="learning-tree-mark" aria-hidden="true">{studied ? <Icon name="check" size={12} /> : null}</span> : <Icon name="file" size={13} />}
    <span className="learning-tree-label">{title}</span>
    {studied ? <span className="visually-hidden"> 已开始学习</span> : null}
  </a></li>;
}

function OutlineFolders({ chapters, selection, onSelect, expanded = false }: Pick<LearningOutline, 'chapters'> &
  Pick<NavigationProps, 'selection' | 'onSelect'> & { expanded?: boolean }) {
  return chapters.map(chapter => <Folder key={chapter.id} title={chapter.title} kind="chapter"
    active={expanded || selection?.chapterId === chapter.id}>
    {() => chapter.sections.length ? chapter.sections.map(section => section.knowledge_points.length
      ? <Folder key={section.id} title={section.title} kind="section" active={expanded || selection?.sectionId === section.id}>
        {() => section.knowledge_points.map(point => <LearningLink key={point.id} title={point.title}
          sectionId={section.id} pointId={point.id} studied={point.studied} current={selection?.pointId === point.id} onSelect={onSelect} />)}
      </Folder> : <LearningLink key={section.id} title={section.title} sectionId={section.id}
        current={selection?.sectionId === section.id && !selection.pointId} onSelect={onSelect} />)
      : <li className="sidebar-project-status">暂无小节</li>}
  </Folder>);
}

function TextbookContents({ courseId, open, outline, onOutline, selection, revision, onSelect, onSessionExpired }: NavigationProps & {
  courseId: string; open: boolean; outline?: LearningOutline; onOutline: (id: string, outline: LearningOutline) => void;
}) {
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const task = new AbortController();
    setError('');
    getLearningOutline(courseId, task.signal).then(result => {
      if (!task.signal.aborted) onOutline(courseId, result);
    }).catch(reason => {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      else setError(reason instanceof Error ? reason.message : '无法读取教材目录');
    });
    return () => task.abort();
  }, [courseId, open, revision, retry, onOutline, onSessionExpired]);

  if (error) return <li className="sidebar-project-status">
    <p role="alert">{error}</p>
    <button className="sidebar-item sidebar-project-more" type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
  </li>;
  if (!outline) return open ? <li className="sidebar-project-status" role="status">正在加载目录…</li> : null;
  if (!outline.chapters.length) return <li className="sidebar-project-status">暂无目录</li>;
  return <OutlineFolders chapters={outline.chapters} selection={selection} onSelect={onSelect} />;
}

export function LearningProjectNavigation({ selection, revision, onSelect, onSessionExpired }: NavigationProps) {
  const [items, setItems] = useState<LearningTextbook[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outlines, setOutlines] = useState<Record<string, LearningOutline>>({});
  const [query, setQuery] = useState('');
  const search = useId();
  const saveOutline = useCallback((id: string, outline: LearningOutline) => {
    setOutlines(previous => ({ ...previous, [id]: outline }));
  }, []);
  const request = useRef<AbortController | null>(null);
  const focusId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLUListElement>(null);
  const removed = useRef(new Set<string>());

  const load = useCallback(async (before: string | null) => {
    if (request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(true);
    setError('');
    try {
      const result = await listLearningTextbooks(task.signal, before);
      if (task.signal.aborted) return;
      const incoming = result.items.filter(item => !removed.current.has(item.id));
      if (before && list.current?.contains(document.activeElement)) focusId.current = incoming[0]?.id;
      setItems(previous => {
        if (!before) return incoming;
        const ids = new Set(previous.map(item => item.id));
        return previous.concat(incoming.filter(item => !ids.has(item.id)));
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
    removed.current.clear();
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

  function removeFromList(id: string) {
    removed.current.add(id);
    const position = items.findIndex(item => item.id === id);
    const row = list.current?.querySelector(`[data-textbook-id="${id}"]`);
    if (row?.contains(document.activeElement)) {
      focusId.current = (items[position + 1] ?? items[position - 1])?.id;
      if (!focusId.current) {
        document.getElementById('learning-navigation-toggle')?.focus();
      }
    }
    setItems(previous => previous.filter(item => item.id !== id));
    setOutlines(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
  }

  const term = query.trim().toLocaleLowerCase();
  const matches = (title: string) => title.toLocaleLowerCase().includes(term);
  const results = term ? items.flatMap(item => {
    const outline = outlines[item.id];
    if (matches(item.title)) return [{ item, chapters: outline?.chapters }];
    const chapters = outline?.chapters.flatMap(chapter => {
      if (matches(chapter.title)) return [chapter];
      const sections = chapter.sections.flatMap(section => {
        if (matches(section.title)) return [section];
        const points = section.knowledge_points.filter(point => matches(point.title));
        return points.length ? [{ ...section, knowledge_points: points }] : [];
      });
      return sections.length ? [{ ...chapter, sections }] : [];
    });
    return chapters?.length ? [{ item, chapters }] : [];
  }) : [];

  return <>
    <div className="learning-tree-search">
      <label htmlFor={search} className="visually-hidden">搜索已加载的学习目录</label>
      <Icon name="search" size={15} />
      <Input id={search} type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="搜索已加载目录" autoComplete="off" />
    </div>
    {term ? <>
      <p className="learning-search-status" role="status">
        {results.length ? `${results.length} 本教材匹配` : busy && !loaded ? '正在读取教材…' : '已加载目录中没有匹配项'}
      </p>
      <ul className="sidebar-submenu sidebar-projects learning-tree learning-search-results" aria-label="目录搜索结果">
        {results.map(({ item, chapters }) => <Folder key={item.id} title={item.title} kind="textbook" active>
          {() => chapters?.length ? <OutlineFolders chapters={chapters} selection={selection} onSelect={onSelect} expanded /> :
            <li className="sidebar-project-status">{chapters ? '暂无目录' : '清除搜索后展开教材可读取知识点。'}</li>}
        </Folder>)}
      </ul>
    </> : null}
    <ul ref={list} hidden={Boolean(term)} className="sidebar-submenu sidebar-projects learning-tree" aria-label="学习教材" aria-busy={busy}>
    {items.map(item => <Folder key={item.id} title={item.title} kind="textbook" active={selection?.courseId === item.id}
      textbookId={item.id} action={<RemoveLearningTextbook courseId={item.id} title={item.title}
        onRemoved={() => removeFromList(item.id)} onSessionExpired={onSessionExpired} />}>
      {open => <TextbookContents courseId={item.id} open={open} outline={outlines[item.id]} onOutline={saveOutline} revision={revision}
        selection={selection?.courseId === item.id ? selection : null} onSelect={onSelect} onSessionExpired={onSessionExpired} />}
    </Folder>)}
    {busy && !loaded ? <li className="sidebar-project-status" role="status">正在加载…</li> : null}
    {loaded && !items.length && !error ? <li className="sidebar-project-status">还没有添加教材</li> : null}
    {error ? <li className="sidebar-project-status" role="alert">{error}</li> : null}
    {cursor || error ? <li><button className="sidebar-item sidebar-project-more" type="button" aria-disabled={busy}
      onClick={() => { if (!busy) void load(cursor); }}>{busy ? '正在加载…' : error ? '重试' : '加载更多'}</button></li> : null}
    </ul>
  </>;
}
