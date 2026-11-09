'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Course } from '../lib/course-types';
import { courseDate } from '../lib/course-types';
import { learningGoalDescription } from '../lib/learning-goals';
import { CourseEditor } from './course-editor';
import { CurriculumEditor } from './curriculum';
import { Icon } from './icon';
import { Toast, useToast } from './toast';

export function CourseSpace({ onDirtyChange, onSessionExpired }: {
  onDirtyChange?: (dirty: boolean) => void;
  onSessionExpired?: () => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notification, notify: setMessage, dismiss } = useToast();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'curriculum'>('overview');
  const [mobileDetail, setMobileDetail] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const detailRegion = useRef<HTMLDivElement>(null);
  const sessionExpired = useRef(onSessionExpired);
  sessionExpired.current = onSessionExpired;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    function guard(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const handleError = useCallback((error: unknown, set: (text: string) => void) => {
    if (error instanceof ApiError && error.status === 401) sessionExpired.current?.();
    else set(error instanceof Error ? error.message : '操作失败，请重试');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setLoadError('');
    api<Course[]>('courses?offset=' + offset, { signal: controller.signal })
      .then(rows => {
        if (!active) return;
        setCourses(rows);
        setSelected(current => rows.find(row => row.id === current?.id) ?? rows[0] ?? null);
      })
      .catch(error => { if (active) handleError(error, setLoadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [offset, reload, handleError]);

  useEffect(() => { if (deleteTarget) confirmButton.current?.focus({ preventScroll: true }); }, [deleteTarget]);

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = ['overview', 'curriculum'] as const;
    const index = tabs.indexOf(detailTab);
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] :
      tabs[(index + 1) % tabs.length];
    if (next === detailTab || !leaveEditor()) return;
    setDirty(false);
    setDetailTab(next);
    document.getElementById(next + '-tab')?.focus();
  }

  function leaveEditor() {
    return !dirty || window.confirm('课程修改尚未保存。放弃修改？');
  }

  function openCourse(course: Course) {
    if (!leaveEditor()) return;
    setSelected(course); setEditing(null); setDirty(false); setDeleteTarget(null);
    setDetailTab('overview'); setError(''); setMessage('');
    setMobileDetail(true);
    if (window.innerWidth < 741) requestAnimationFrame(() => document.getElementById('course-detail-title')?.focus({ preventScroll: true }));
  }

  function backToDirectory() {
    if (!leaveEditor()) return;
    setEditing(null); setDirty(false); setMobileDetail(false); setDeleteTarget(null);
    requestAnimationFrame(() => newButton.current?.focus({ preventScroll: true }));
  }

  function newCourse() {
    if (!leaveEditor()) return;
    setEditing('new'); setDirty(false); setDeleteTarget(null); setError(''); setMessage('');
  }

  function cancelEditor() {
    if (!leaveEditor()) return;
    setEditing(null); setDirty(false);
    requestAnimationFrame(() => newButton.current?.focus({ preventScroll: true }));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); return true; }
    catch (error) {
      handleError(error, setError);
      requestAnimationFrame(() => errorElement.current?.focus({ preventScroll: true }));
      return false;
    } finally { setBusy(false); }
  }

  async function save(data: Record<string, FormDataEntryValue>) {
    await run(async () => {
      const isNew = editing === 'new';
      const course = await api<Course>(isNew ? 'courses' : 'courses/' + selected!.id, {
        method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(data),
      });
      setSelected(course); setEditing(null); setDirty(false);
      setMobileDetail(true);
      setCourses(previous => isNew ? [course, ...previous].slice(0, 100) :
        previous.map(row => row.id === course.id ? course : row));
      if (isNew && offset !== 0) setOffset(0);
      setQuery(''); setFilter('all'); setDetailTab('overview'); setMessage('课程已保存');
    });
  }

  async function removeCourse() {
    if (!deleteTarget) return;
    await run(async () => {
      await api('courses/' + deleteTarget.id, { method: 'DELETE' });
      setDeleteTarget(null); setSelected(null); setMessage('课程已删除');
      setMobileDetail(false);
      if (courses.length === 1 && offset > 0) setOffset(previous => Math.max(0, previous - 100));
      else setReload(previous => previous + 1);
      requestAnimationFrame(() => newButton.current?.focus({ preventScroll: true }));
    });
  }

  function page(next: number) {
    if (!leaveEditor()) return;
    setEditing(null); setDirty(false); setDeleteTarget(null);
    setQuery(''); setFilter('all'); setOffset(next);
  }

  const needle = query.trim().toLocaleLowerCase();
  const visible = courses.filter(course =>
    (filter === 'all' || course.status === filter) &&
    (!needle || [course.title, course.subject, course.textbook].some(value => value.toLocaleLowerCase().includes(needle))));
  const activeCount = courses.filter(course => course.status === 'active').length;
  const hasFilters = Boolean(needle || filter !== 'all');

  return <div className={'course-space' + (editing || mobileDetail ? ' showing-detail' : '')}>
    <div className="page-heading">
      <div><h1>我的课程</h1><p>管理课程和教材目录。</p></div>
      <button ref={newButton} className="button primary" disabled={busy} onClick={newCourse}>
        <Icon name="plus" size={18} />新建课程</button>
    </div>
    {error ? <p ref={errorElement} tabIndex={-1} className="notice error" role="alert">
      <Icon name="alert" size={18} />{error}</p> : null}
    <Toast notification={notification} onDismiss={dismiss} />
    <div className="library-toolbar">
      <div className="segmented-control course-filters" aria-label="当前页课程状态">
        {([['all', '全部', courses.length], ['active', '学习中', activeCount],
          ['archived', '已归档', courses.length - activeCount]] as const).map(([value, label, count]) =>
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}<span className="filter-count">{count}</span></button>)}
      </div>
      <div className="search-field"><Icon name="search" size={18} />
        <label className="visually-hidden" htmlFor="course-search">搜索当前页课程</label>
        <input id="course-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="搜索课程、学科或教材" autoComplete="off" />
        {query ? <button className="icon-button" aria-label="清空课程搜索" onClick={() => setQuery('')}><Icon name="close" size={16} /></button> : null}
      </div>
    </div>
    <div className="course-workarea">
      <section className="course-index" aria-label="课程列表" aria-busy={loading}>
        <div className="index-heading"><h2>课程目录</h2>
          <span className="count-label">{loading ? '读取中…' : hasFilters ? visible.length + ' 门匹配' : courses.length + ' 门课程'}</span></div>
        {loading ? <div className="course-skeleton" role="status" aria-label="正在加载课程">
          {[1, 2, 3].map(row => <div className="skeleton-row" key={row}><div className="skeleton skeleton-square" />
            <div><div className="skeleton" /><div className="skeleton skeleton-short" /></div></div>)}
        </div> : loadError ? <div className="index-empty inline-error" role="alert"><Icon name="alert" size={30} />
          <h3>课程读取失败</h3><p>{loadError}</p><button className="button" onClick={() => setReload(value => value + 1)}>重新加载课程</button></div> :
          !visible.length && hasFilters ? <div className="index-empty"><Icon name="search" size={34} />
            <h3>没有找到匹配的课程</h3>
            <p>换个关键词，或清除筛选查看当前页课程。</p>
            <button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button></div> :
            <ul className="course-list">{visible.map(course => <li key={course.id}>
              <button className={'course-row' + (selected?.id === course.id && editing !== 'new' ? ' is-selected' : '')}
                aria-pressed={selected?.id === course.id && editing !== 'new'} disabled={busy} onClick={() => openCourse(course)}>
                <span className="course-symbol"><Icon name="book" size={22} /></span>
                <span className="course-description"><strong>{course.title}</strong>
                  <span>{course.subject || '未设置学科'}{course.textbook ? ' · ' + course.textbook : ''}</span></span>
                <span className={'status-tag' + (course.status === 'archived' ? ' neutral' : '')}>{course.status === 'active' ? '学习中' : '已归档'}</span>
              </button>
            </li>)}</ul>}
        {!loading && !loadError ? <div className="index-footer">
          <span>当前第 {Math.floor(offset / 100) + 1} 页{hasFilters ? ' · 筛选仅作用于本页' : ''}</span>
          <div className="pagination"><button className="icon-button" aria-label="上一页课程" disabled={busy || offset === 0}
            onClick={() => page(offset - 100)}><span className="rotate-icon"><Icon name="chevron" size={16} /></span></button>
            <button className="icon-button" aria-label="下一页课程" disabled={busy || courses.length < 100}
              onClick={() => page(offset + 100)}><Icon name="chevron" size={16} /></button></div></div> : null}
      </section>
      <div className="detail-region" ref={detailRegion}>
        <button className="text-button detail-back" disabled={busy} onClick={backToDirectory}>
          <span className="rotate-icon"><Icon name="chevron" size={16} /></span>返回课程目录
        </button>
        {editing ? <CourseEditor key={editing === 'new' ? 'new' : selected!.id} course={editing === 'new' ? null : selected}
          busy={busy} onSave={data => void save(data)} onCancel={cancelEditor} onDirty={() => setDirty(true)} /> :
          selected ? <section className="detail-panel" aria-labelledby="course-detail-title">
            <div className="detail-heading"><span className={'status-tag' + (selected.status === 'archived' ? ' neutral' : '')}>
              {selected.status === 'active' ? '学习中' : '已归档'}</span>
              <button className="button button-small" disabled={busy} onClick={() => { if (!leaveEditor()) return; setDirty(false); setEditing('edit'); setDeleteTarget(null); }}>
                <Icon name="edit" size={16} />编辑课程</button></div>
            <h2 className="course-detail-title" id="course-detail-title" tabIndex={-1} title={selected.title}>{selected.title}</h2>
            {courseDate(selected.updated_at) ? <p className="last-edited">更新于 {courseDate(selected.updated_at)}</p> : null}
            <div className="detail-tabs" role="tablist" aria-label="课程详情">
              <button role="tab" id="overview-tab" aria-selected={detailTab === 'overview'} aria-controls="course-tab-panel"
                tabIndex={detailTab === 'overview' ? 0 : -1} onKeyDown={tabKey}
                onClick={() => { if (detailTab !== 'overview' && leaveEditor()) { setDirty(false); setDetailTab('overview'); } }}>课程概览</button>
              <button role="tab" id="curriculum-tab" aria-selected={detailTab === 'curriculum'} aria-controls="course-tab-panel"
                tabIndex={detailTab === 'curriculum' ? 0 : -1} onKeyDown={tabKey}
                onClick={() => { if (detailTab !== 'curriculum' && leaveEditor()) { setDirty(false); setDetailTab('curriculum'); } }}>教材目录</button>
            </div>
            <div id="course-tab-panel" role="tabpanel" aria-labelledby={detailTab + '-tab'}>
              {detailTab === 'overview' ? <dl className="course-metadata">
                <dt>学科</dt><dd>{selected.subject || <span className="muted">未设置</span>}</dd>
                <dt>教材</dt><dd>{selected.textbook || <span className="muted">未设置</span>}</dd>
                <dt>学习目标</dt><dd className="learning-goal">{selected.learning_goal || <span className="muted">还没有选择学习目标。</span>}
                  {learningGoalDescription(selected.learning_goal) ? <small className="goal-description">{learningGoalDescription(selected.learning_goal)}</small> : null}</dd>
              </dl> :
              <CurriculumEditor key={selected.id} courseId={selected.id} onDirtyChange={setDirty} onSessionExpired={onSessionExpired} />}
            </div>
            <div className="detail-bottom"><button className="text-button danger-quiet" disabled={busy}
              onClick={() => setDeleteTarget(selected)}><Icon name="trash" size={16} />删除课程</button></div>
            {deleteTarget ? <div className="delete-confirmation" role="alert" aria-labelledby="delete-course-title">
              <h3 id="delete-course-title">删除这门课程？</h3><p>“{deleteTarget.title}”及其目录、文件将被永久删除，此操作无法撤销。</p>
              <div className="button-row"><button ref={confirmButton} className="button danger" disabled={busy}
                onClick={() => void removeCourse()}>{busy ? '删除中…' : '确认删除'}</button>
                <button className="button" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button></div>
            </div> : null}
          </section> : null}
      </div>
    </div>
  </div>;
}
