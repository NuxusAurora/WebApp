'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { openSectionConversation, openLearningProject, type LearningProjectDetail, type LearningSelection } from '../lib/learning';
import type { LearningTarget } from '../lib/workspace-navigation';
import { SectionKnowledge } from './knowledge';
import { TeachingChat } from './teaching-chat';

export function LearningConversation({ target, onOpened, onDirtyChange, onSessionExpired }: {
  target: LearningTarget | null;
  onOpened: (target: LearningTarget, selection: LearningSelection) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSessionExpired: () => void;
}) {
  const [project, setProject] = useState<LearningProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    if (!target || request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(true);
    setError('');
    try {
      const result = 'sectionId' in target
        ? await openSectionConversation(target.sectionId, task.signal, target.pointId)
        : await openLearningProject(target.projectId, task.signal);
      if (!task.signal.aborted) {
        setProject(result);
        onOpened(target, {
          courseId: result.course_id, chapterId: result.chapter_id, sectionId: result.section_id,
          pointId: result.conversation?.knowledge_point_id,
        });
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
  }, [target, onOpened, onSessionExpired]);

  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  const selectedPoint = project?.knowledge_points.find(point => point.id === project.conversation?.knowledge_point_id);
  const title = project?.section_title;
  useEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);

  if (selectedPoint && project?.conversation) return <TeachingChat key={project.conversation.id}
    conversationId={project.conversation.id} title={selectedPoint.title} onSessionExpired={onSessionExpired} />;

  return <section className="learning-conversation" aria-label="学习对话">
    <header className="learning-conversation-header">
      <h1 ref={heading} tabIndex={-1}>{title ?? '学习对话'}</h1>
      {project ? <p className="muted">{project.textbook_title}</p> : null}
    </header>
    {!target ? <p className="learning-conversation-empty muted">从「我的课程」添加教材，再从左侧选择小节或知识点。</p> : null}
    {target && !project && busy ? <p role="status" className="learning-conversation-empty muted">正在打开对话…</p> : null}
    {error ? <div className="learning-conversation-error">
      <p className="notice error" role="alert">{error}</p>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>重新打开</button>
    </div> : null}
    {project ? <div className="learning-conversation-main" aria-busy={busy}>
      <SectionKnowledge sectionId={project.section_id} generateLabel="生成知识点"
        onConfirmed={load} onDirtyChange={onDirtyChange} onSessionExpired={onSessionExpired} />
    </div> : null}
  </section>;
}
