'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { readLessonTask, runLessonCommand, type LessonCommand, type LessonTask } from '../lib/lesson-task';
import { LessonContent, LessonStep, ProblemCard } from './lesson-reading';
import { LessonActions, LessonSupport, UnderstandingCheck } from './lesson-actions';
import { TeachingChat } from './teaching-chat';
import { LearningContextPath } from './learning-context-path';

const supportLabels = { explain: '另一种讲法', hint: '提示', evaluate: '反馈' };

// Generated lessons can already contain step labels. Keep the server's index as the visible label.
function withoutStepLabels(text: string) {
  return text.replace(
    /^[ \t\u3000]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:第[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+[ \t\u3000]*步|步骤[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+|step[ \t]+[0-9０-９]+)(?:\*\*|__)?[ \t\u3000]*(?:[：:、]|[.．](?![0-9０-９])|$)(?:\*\*|__)?[ \t\u3000]*/gim,
    '',
  ).trim();
}

export function LessonWorkspace({ conversationId, title, path, onQuestionsChange, onSessionExpired }: {
  conversationId: string; title: string; path: (string | undefined)[];
  onQuestionsChange: (open: boolean) => void; onSessionExpired: () => void;
}) {
  const [progress, setProgress] = useState<LessonTask | null>(null);
  const [busy, setBusy] = useState<'load' | LessonCommand | null>('load');
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<LessonCommand | null>(null);
  const [stale, setStale] = useState(false);
  const [questions, setQuestions] = useState<boolean | null>(null);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusStep = useRef(false);
  const readingAnchor = useRef<{ node?: HTMLElement; top: number } | null>(null);

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) onSessionExpired();
    else setError(cause instanceof Error ? cause.message : '教学暂不可用，请重试');
  }, [onSessionExpired]);

  const load = useCallback(async () => {
    if (request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy('load');
    setError('');
    setFailedAction(null);
    try {
      const result = await readLessonTask(conversationId, task.signal);
      if (task.signal.aborted) return;
      setProgress(result);
      setStale(false);
    } catch (cause) {
      if (!task.signal.aborted) fail(cause);
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(null);
      }
    }
  }, [conversationId, fail]);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  useLayoutEffect(() => {
    const panel = content.current;
    if (!panel?.clientHeight) return;
    if (focusStep.current) {
      const stepHeading = panel.querySelector<HTMLElement>('#lesson-step');
      stepHeading?.focus({ preventScroll: true });
      stepHeading?.scrollIntoView?.({ block: 'start' });
      focusStep.current = false;
    } else if (readingAnchor.current) {
      const { node, top } = readingAnchor.current;
      panel.scrollTop = node && panel.contains(node)
        ? panel.scrollTop + node.getBoundingClientRect().top - panel.getBoundingClientRect().top + top
        : top;
    }
    readingAnchor.current = null;
  }, [progress, questions]);

  async function act(action: LessonCommand, fields?: { check_id: string; answer?: string }) {
    if (!progress?.actions.includes(action) || request.current || stale) return;
    const task = new AbortController();
    request.current = task;
    setError('');
    setFailedAction(null);
    setBusy(action);
    try {
      let result = await runLessonCommand(conversationId, progress, action, task.signal, fields);
      if (task.signal.aborted) return;
      if (action === 'check-answer' && result.check) {
        setProgress(result);
        setBusy('evaluate-check');
        result = await runLessonCommand(conversationId, result, 'evaluate-check', task.signal, {
          check_id: result.check.check_id,
        });
        if (task.signal.aborted) return;
      }
      focusStep.current = result.current_step?.step_id !== progress.current_step?.step_id;
      setProgress(result);
    } catch (cause) {
      if (task.signal.aborted) return;
      setFailedAction(action);
      if (!(cause instanceof ApiError) || [409, 502, 503, 504].includes(cause.status)) {
        try {
          const latest = await readLessonTask(conversationId, task.signal);
          if (task.signal.aborted) return;
          setProgress(latest);
          if (latest.revision !== progress.revision && cause instanceof ApiError && cause.status === 409) {
            setError('进度已更新，请确认当前步骤');
            return;
          }
        } catch { if (!task.signal.aborted) setStale(true); }
      }
      fail(cause);
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(null);
      }
    }
  }

  function rememberReadingPosition() {
    const panel = content.current;
    if (!panel?.clientHeight) return;
    const panelTop = panel.getBoundingClientRect().top;
    const node = Array.from(panel.querySelectorAll<HTMLElement>('.lesson-body > *'))
      .find(child => child.getBoundingClientRect().bottom > panelTop);
    readingAnchor.current = { node, top: node ? panelTop - node.getBoundingClientRect().top : panel.scrollTop };
  }

  function closeQuestions() {
    rememberReadingPosition();
    setQuestions(false);
    onQuestionsChange(false);
    requestAnimationFrame(() => launch.current?.focus({ preventScroll: true }));
  }

  const legacy = progress?.legacy;
  const step = progress?.current_step ?? legacy?.step;
  const problem = progress?.question?.problem ?? legacy?.problem;
  const complete = progress?.status === 'completed' || legacy?.complete;
  const primary: LessonCommand = progress?.status === 'final_step' ? 'complete' :
    progress?.status === 'completed' ? 'next-question' : progress?.status === 'teaching' ? 'next' : 'start';
  const blocked = Boolean(busy) || stale;
  const checkError = failedAction === 'check-answer' || failedAction === 'evaluate-check';
  const localAction = failedAction === 'hint' || failedAction === 'rephrase' || failedAction === 'check-question';
  const contextStatus = stale ? '进度已变化' : busy === 'load' ? '正在读取进度' :
    busy === 'start' ? (complete ? '正在准备下一题' : '正在准备教学') :
      complete ? '本题已完成' : step ? (progress?.status === 'final_step' || legacy?.step?.final ? '最后一步' : '学习中') :
        progress ? '未开始' : error ? '无法读取进度' : '';

  return <section className="learning-conversation-main learning-conversation-point lesson-workspace"
    aria-label={title} data-questions-open={Boolean(questions)}>
    <section className="lesson-main" aria-labelledby="learning-point-title">
      <header className="lesson-header">
        <div className="lesson-header-copy">
          <LearningContextPath labels={path} />
          <h1 ref={heading} id="learning-point-title" tabIndex={-1}>{title}</h1>
        </div>
        <p className="lesson-context-status" role="status">
          {contextStatus}
        </p>
        <button ref={launch} type="button" className="button secondary" aria-expanded={Boolean(questions)}
          aria-controls={questions === null ? undefined : 'teaching-questions'}
          onClick={() => {
            if (questions) closeQuestions();
            else { rememberReadingPosition(); setQuestions(true); onQuestionsChange(true); }
          }}>随时提问</button>
      </header>
      <div className="lesson-content" ref={content} role="region" aria-label="当前教学内容" tabIndex={0}>
        <div className="lesson-body">
          {progress && step && problem ? <>
            <ProblemCard key={progress.question?.question_id ?? 'legacy-problem'} text={problem} format={progress.question?.format} />
            <LessonStep title={withoutStepLabels(step.title)} total={progress.plan?.total_steps}
              step={{ ...step, content: withoutStepLabels(step.content) }} />
            {Boolean(progress.completed_steps?.length) ? <details className="lesson-history">
              <summary>已完成步骤（{progress.completed_steps?.length}）</summary>
              {progress.completed_steps?.map(entry => <LessonStep key={entry.step_id}
                title={withoutStepLabels(entry.title)} step={entry} current={false} />)}
            </details> : null}
            {legacy?.check ? <section className="lesson-block"><h2>理解检测</h2><p>{legacy.check}</p></section> : null}
            {legacy?.support ? <section className="lesson-block" aria-live="polite">
              <h2>{supportLabels[legacy.support.kind]}</h2>
              <LessonContent text={legacy.support.text} />
            </section> : null}
            <LessonSupport key={progress.current_step?.step_id ?? 'legacy-support'} support={progress.support} />
            {busy === 'hint' || busy === 'rephrase' || busy === 'check-question' ? <p role="status">
              {busy === 'check-question' ? '正在准备检测题…' : '正在生成辅助讲解…'}
            </p> : null}
            {error && localAction ? <p className="notice error" role="alert">{error}</p> : null}
            {progress.check ? <UnderstandingCheck key={progress.check.check_id} check={progress.check}
              busy={busy} disabled={blocked || progress.status === 'completed'}
              error={checkError ? error : ''} submit={(action, fields) => void act(action, fields)} /> : null}
          </> : progress ? <p className="muted">从一道题开始，一次学一步。</p> : null}
          {complete ? <section className="lesson-completion" role="status">
            <strong>本题已完成</strong>
            {progress?.completion && progress.plan ? <p>你确认完成了 {progress.plan.total_steps} 个教学步骤。</p> : null}
          </section> : null}
        </div>
      </div>
      <footer className="lesson-footer">
        {busy && ['load', 'start', 'next', 'next-question', 'complete'].includes(busy) ? <p className="muted" role="status">
          {busy === 'load' ? '正在读取教学进度…' : busy === 'complete' ? '正在保存完成记录…'
            : busy === 'next' ? '正在生成下一步…' : '正在准备题目和教学步骤…'}
        </p> : null}
        {error && !localAction && !checkError ? <p className="notice error" role="alert">{error}</p> : null}
        {((!progress && error) || stale) ? <button type="button" className="button secondary"
          disabled={Boolean(busy)} onClick={() => void load()}>重新加载进度</button> : null}
        {progress ? <LessonActions task={progress} primary={primary} disabled={blocked} busy={busy}
          run={action => void act(action)} /> : null}
      </footer>
    </section>
    {questions !== null ? <TeachingChat conversationId={conversationId} open={questions}
      onClose={closeQuestions} onSessionExpired={onSessionExpired} /> : null}
  </section>;
}
