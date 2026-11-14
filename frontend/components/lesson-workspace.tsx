'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { getLesson, updateLesson, type LessonAction, type LessonProgress, type LessonRequest } from '../lib/learning';
import { TeachingChat } from './teaching-chat';

const supportLabels = { explain: '另一种讲法', hint: '提示', evaluate: '反馈' };

// Generated lessons can already contain step labels. Keep the server's index as the visible label.
function withoutStepLabels(text: string) {
  return text.replace(
    /^[ \t\u3000]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:第[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+[ \t\u3000]*步|步骤[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+|step[ \t]+[0-9０-９]+)(?:\*\*|__)?[ \t\u3000]*(?:[：:、]|[.．](?![0-9０-９])|$)(?:\*\*|__)?[ \t\u3000]*/gim,
    '',
  ).trim();
}

export function LessonWorkspace({ conversationId, title, onSessionExpired }: {
  conversationId: string; title: string; onSessionExpired: () => void;
}) {
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [busy, setBusy] = useState<'load' | LessonAction | null>('load');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [response, setResponse] = useState('');
  const [questions, setQuestions] = useState<boolean | null>(null);
  const request = useRef<AbortController | null>(null);
  const retry = useRef<LessonRequest | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollToEnd = useRef(false);

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
    try {
      const result = await getLesson(conversationId, task.signal);
      if (task.signal.aborted) return;
      setProgress(result);
      setStale(false);
      retry.current = null;
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
    if (!scrollToEnd.current || !panel?.clientHeight) return;
    panel.scrollTop = panel.scrollHeight;
    scrollToEnd.current = false;
  }, [progress, questions]);

  async function act(action: LessonAction) {
    if (!progress || request.current || stale) return;
    const input = action === 'evaluate' ? response.trim() : '';
    if (action === 'evaluate' && !input) return;
    const task = new AbortController();
    request.current = task;
    const previous = retry.current;
    const body: LessonRequest = previous?.action === action && previous.response === input
      ? previous : { request_id: crypto.randomUUID(), revision: progress.revision, action, response: input };
    retry.current = body;
    setError('');
    setBusy(action);
    try {
      const result = await updateLesson(conversationId, body, task.signal);
      if (task.signal.aborted) return;
      if (action === 'start' || action === 'next' || action === 'check' || action === 'evaluate') setResponse('');
      scrollToEnd.current = true;
      setProgress(result);
      retry.current = null;
    } catch (cause) {
      if (task.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 409) setStale(true);
      fail(cause);
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(null);
      }
    }
  }

  function closeQuestions() {
    setQuestions(false);
    requestAnimationFrame(() => launch.current?.focus({ preventScroll: true }));
  }

  const step = progress?.step;
  const stepTitle = step ? withoutStepLabels(step.title) : '';
  const stepContent = step ? withoutStepLabels(step.content) : '';
  const complete = progress?.complete;
  const blocked = Boolean(busy) || stale;

  return <section className="learning-conversation-main learning-conversation-point lesson-workspace"
    aria-label={title} data-questions-open={Boolean(questions)}>
    <section className="lesson-main" aria-labelledby="learning-point-title">
      <header className="lesson-header">
        <h1 ref={heading} id="learning-point-title" tabIndex={-1}>{title}</h1>
        <button ref={launch} type="button" className="button secondary" aria-expanded={Boolean(questions)}
          aria-controls={questions === null ? undefined : 'teaching-questions'}
          onClick={() => questions ? closeQuestions() : setQuestions(true)}>随时提问</button>
      </header>
      <div className="lesson-content" ref={content} role="region" aria-label="当前教学内容" tabIndex={0}>
        <div className="lesson-body">
          {progress && step ? <>
            <section className="lesson-block" aria-labelledby="lesson-problem">
              <h2 id="lesson-problem">题目</h2>
              <p>{progress.problem}</p>
            </section>
            <section className="lesson-block" aria-labelledby="lesson-step">
              <h2 id="lesson-step">第 {step.index} 步{stepTitle ? `：${stepTitle}` : null}</h2>
              {stepContent ? <p>{stepContent}</p> : null}
            </section>
            {progress.check && !complete ? <form className="lesson-block lesson-check"
              onSubmit={event => { event.preventDefault(); void act('evaluate'); }}>
              <label htmlFor="lesson-response">理解检测</label>
              <p>{progress.check}</p>
              <textarea id="lesson-response" rows={2} maxLength={1000} value={response}
                onChange={event => setResponse(event.target.value)} disabled={blocked} placeholder="写下你的理解…" />
              <button className="button secondary" type="submit" disabled={blocked || !response.trim()}>提交回答</button>
            </form> : null}
            {progress.support ? <section className="lesson-block" aria-live="polite">
              <h2>{supportLabels[progress.support.kind]}</h2>
              <p>{progress.support.text}</p>
            </section> : null}
          </> : progress ? <p className="muted">从一道题开始，一次学一步。</p> : null}
          {complete ? <p role="status">已完成这道题。</p> : null}
        </div>
      </div>
      <footer className="lesson-footer">
        {busy ? <p className="muted" role="status">{busy === 'load' ? '正在读取教学进度…' : '导师正在准备…'}</p> : null}
        {error ? <p className="notice error" role="alert">{error}</p> : null}
        {((!progress && error) || stale) ? <button type="button" className="button secondary"
          disabled={Boolean(busy)} onClick={() => void load()}>重新加载进度</button> : null}
        {progress ? <div className="lesson-actions">
          <button type="button" className="button primary" disabled={blocked}
            onClick={() => void act(!step || complete ? 'start' : 'next')}>
            {!step ? '开始学习' : complete ? '下一题' : step.final ? '我理解了，完成本题' : '我理解了，下一步'}
          </button>
          {step && !complete ? <>
            <button type="button" className="button secondary" disabled={blocked} onClick={() => void act('explain')}>换一种方式</button>
            <button type="button" className="button secondary" disabled={blocked} onClick={() => void act('hint')}>给我提示</button>
            <button type="button" className="button secondary" disabled={blocked} onClick={() => void act('check')}>验证一下</button>
          </> : null}
        </div> : null}
      </footer>
    </section>
    {questions !== null ? <TeachingChat conversationId={conversationId} open={questions}
      onClose={closeQuestions} onSessionExpired={onSessionExpired} /> : null}
  </section>;
}
