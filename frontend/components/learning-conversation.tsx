'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { openLearningProject, type LearningProjectDetail } from '../lib/learning';

export function LearningConversation({ projectId, onOpened, onSessionExpired }: {
  projectId: string | null;
  onOpened: () => void;
  onSessionExpired: () => void;
}) {
  const [project, setProject] = useState<LearningProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (pointId?: string) => {
    if (!projectId || request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(true);
    setError('');
    try {
      const result = await openLearningProject(projectId, task.signal, pointId);
      if (!task.signal.aborted) {
        setProject(result);
        if (!pointId) onOpened();
      }
    } catch (reason) {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      else setError(reason instanceof Error ? reason.message : '无法打开学习对话');
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(false);
      }
    }
  }, [projectId, onOpened, onSessionExpired]);

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  const title = project?.section_title;
  useEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);

  const selectedPoint = project?.knowledge_points.find(point => point.id === project.conversation?.knowledge_point_id);

  return <section className="learning-conversation" aria-label="学习对话">
    <header className="learning-conversation-header">
      <h1 ref={heading} tabIndex={-1}>{title ?? '学习对话'}</h1>
      {project ? <p className="muted">{project.course_title}</p> : null}
    </header>
    {!projectId ? <p className="learning-conversation-empty muted">在左侧选择学习对话。</p> : null}
    {projectId && !project && busy ? <p role="status" className="learning-conversation-empty muted">正在打开对话…</p> : null}
    {error ? <div className="learning-conversation-error">
      <p className="notice error" role="alert">{error}</p>
      {!project ? <button type="button" className="button secondary" onClick={() => void load()}>重新打开</button> : null}
    </div> : null}
    {project ? <div className="learning-conversation-layout" aria-busy={busy}>
      <div className="learning-conversation-main">
        {selectedPoint ? <>
          <h2>{selectedPoint.title}</h2>
          <p className="muted">教学功能待接入</p>
        </> : <p className="muted">暂无已确认的知识点。请先在课程目录中生成并确认。</p>}
      </div>
      {project.knowledge_points.length ? <aside className="learning-conversation-outline" aria-labelledby="learning-outline-title">
        <h2 id="learning-outline-title">知识点</h2>
        <ol>{project.knowledge_points.map((point, index) => {
          const current = point.id === selectedPoint?.id;
          return <li key={point.id}><button type="button" className="learning-point-button"
            aria-current={current ? 'true' : undefined} aria-disabled={busy || current}
            onClick={() => { if (!busy && !current) void load(point.id); }}>
            <span aria-hidden="true">{index + 1}</span>{point.title}
          </button></li>;
        })}</ol>
      </aside> : null}
    </div> : null}
  </section>;
}
