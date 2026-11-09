'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Course } from '../lib/course-types';
import { Icon } from './icon';
import { Toast, useToast } from './toast';

export function ArchivedCourses({ onSessionExpired }: { onSessionExpired?: () => void }) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const { notification, notify, dismiss } = useToast();
  const sessionExpired = useRef(onSessionExpired);
  sessionExpired.current = onSessionExpired;
  const operation = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(''); setCourses([]);
    api<Course[]>('courses?offset=' + offset, { signal: controller.signal })
      .then(rows => {
        if (!active) return;
        setCourses(rows.filter(course => course.status === 'archived'));
        setHasNext(rows.length === 100);
      })
      .catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) sessionExpired.current?.();
        else setError(error instanceof Error ? error.message : '归档资料读取失败，请重试');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, offset, reload]);

  async function restore(course: Course) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(course.id); setError('');
    try {
      await api<Course>('courses/' + course.id, {
        method: 'PATCH', body: JSON.stringify({ status: 'active' }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setCourses(rows => rows.filter(row => row.id !== course.id));
      notify('已恢复学习');
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) sessionExpired.current?.();
      else setError(error instanceof Error ? error.message : '恢复失败，请重试');
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  return <section className="archived-courses" aria-label="归档资料">
    <button ref={trigger} className="archive-toggle" aria-expanded={open} aria-controls="archived-course-list"
      disabled={Boolean(pending)} onClick={() => setOpen(value => !value)}>
      <span>归档资料</span><Icon name="chevron" size={18} />
    </button>
    <Toast notification={notification} onDismiss={dismiss} />
    {open ? <div id="archived-course-list" className="archive-content" aria-busy={loading}>
      {loading ? <p role="status">正在读取归档资料…</p> : null}
      {error ? <div className="notice error" role="alert"><p>{error}</p>
        <button className="text-button" disabled={Boolean(pending)} onClick={() => setReload(value => value + 1)}>重新加载</button></div> : null}
      {!loading && !error && !courses.length ? <p className="muted">{hasNext || offset ? '本页暂无归档资料' : '暂无归档资料'}</p> : null}
      <ul className="course-list">{courses.map(course => <li key={course.id} className="archive-row">
        <span className="course-description"><strong>{course.title}</strong><span>{course.subject}{course.textbook ? ' · ' + course.textbook : ''}</span></span>
        <button className="button" disabled={Boolean(pending)} aria-label={'恢复学习：' + course.title}
          onClick={() => void restore(course)}>{pending === course.id ? '恢复中…' : '恢复学习'}</button>
      </li>)}</ul>
      {!loading && (offset > 0 || hasNext) ? <div className="index-footer">
        <span>当前第 {Math.floor(offset / 100) + 1} 页</span>
        <div className="pagination"><button className="button" disabled={Boolean(pending) || offset === 0}
          onClick={() => setOffset(value => value - 100)}>上一页</button>
          <button className="button" disabled={Boolean(pending) || !hasNext} onClick={() => setOffset(value => value + 100)}>下一页</button></div>
      </div> : null}
    </div> : null}
  </section>;
}
