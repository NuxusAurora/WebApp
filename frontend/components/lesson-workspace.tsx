'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { readLessonTask, requestSubquestionExplanation, runLessonCommand,
  type LessonCommand, type LessonTask, type SubquestionExplanation } from '../lib/lesson-task';
import { LessonContent, LessonStep, ProblemCard } from './lesson-reading';
import { actionLabels, LessonActions, LessonSupport, UnderstandingCheck } from './lesson-actions';
import { TeachingChat } from './teaching-chat';

const supportLabels = { explain: '另一种讲法', hint: '提示', evaluate: '反馈' };

// Generated lessons can already contain step labels. Keep the server's index as the visible label.
function withoutStepLabels(text: string) {
  return text.replace(
    /^[ \t\u3000]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:第[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+[ \t\u3000]*步|步骤[ \t\u3000]*[0-9０-９零〇一二三四五六七八九十百千万两]+|step[ \t]+[0-9０-９]+)(?:\*\*|__)?[ \t\u3000]*(?:[：:、]|[.．](?![0-9０-９])|$)(?:\*\*|__)?[ \t\u3000]*/gim,
    '',
  ).trim();
}

export function LessonWorkspace({ conversationId, title, onQuestionsChange, onSessionExpired }: {
  conversationId: string; title: string;
  onQuestionsChange: (open: boolean) => void; onSessionExpired: () => void;
}) {
  const [progress, setProgress] = useState<LessonTask | null>(null);
  const [busy, setBusy] = useState<'load' | LessonCommand | null>('load');
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<LessonCommand | null>(null);
  const [stale, setStale] = useState(false);
  const [questions, setQuestions] = useState<boolean | null>(null);
  const [selection, setSelection] = useState<{ questionId: string; part: number | 'single' } | null>(null);
  const [explanations, setExplanations] = useState<{
    questionId: string; byNumber: Partial<Record<number, SubquestionExplanation>>;
  } | null>(null);
  const [explainingSubquestion, setExplainingSubquestion] = useState(false);
  const [subquestionError, setSubquestionError] = useState('');
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const detailEntry = useRef<HTMLButtonElement>(null);
  const problemDock = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusDestination = useRef<'problem' | 'step' | 'entry' | null>(null);
  const readingAnchor = useRef<{ node?: HTMLElement; top: number } | null>(null);

  const legacy = progress?.legacy;
  const step = progress?.current_step ?? legacy?.step;
  const problem = progress?.question?.problem ?? legacy?.problem;
  const complete = progress?.status === 'completed' || legacy?.complete;
  const questionId = progress?.question?.question_id ?? 'legacy';
  const scopedQuestionId = progress?.question?.question_id ?? 'legacy:' + progress?.revision;
  const selectedPart = selection?.questionId === scopedQuestionId ? selection.part : undefined;
  const insideDetail = Boolean(problem) && selectedPart !== undefined;
  const singleDetail = insideDetail && selectedPart === 'single';
  const activeSubquestion = typeof selectedPart === 'number' ? selectedPart : undefined;
  const focusedExplanation = activeSubquestion !== undefined && explanations?.questionId === scopedQuestionId
    ? explanations.byNumber[activeSubquestion] : undefined;
  const questionsOpen = insideDetail && Boolean(questions);

  useEffect(() => {
    onQuestionsChange(questionsOpen);
  }, [onQuestionsChange, questionsOpen]);

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
    setSubquestionError('');
    setFailedAction(null);
    setQuestions(previous => previous === null ? null : false);
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
    const destination = focusDestination.current;
    if (destination) {
      const stepHeading = destination === 'step' ? panel?.querySelector<HTMLElement>('#lesson-step') : null;
      const target = destination === 'entry' ? detailEntry.current :
        stepHeading ?? problemDock.current?.querySelector<HTMLElement>('#lesson-problem');
      target?.focus({ preventScroll: true });
      stepHeading?.scrollIntoView?.({ block: 'start' });
      focusDestination.current = null;
    } else if (panel?.clientHeight && readingAnchor.current) {
      const { node, top } = readingAnchor.current;
      panel.scrollTop = node && panel.contains(node)
        ? panel.scrollTop + node.getBoundingClientRect().top - panel.getBoundingClientRect().top + top
        : top;
    }
    readingAnchor.current = null;
  }, [progress, questionsOpen, selectedPart, focusedExplanation]);

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
      if (action === 'start' || action === 'next-question') {
        leaveDetail();
        focusDestination.current = 'problem';
      } else if (action === 'next') {
        focusDestination.current = 'step';
      }
      setProgress(result);
    } catch (cause) {
      if (task.signal.aborted) return;
      setFailedAction(action);
      if (!(cause instanceof ApiError) || [409, 502, 503, 504].includes(cause.status)) {
        try {
          const latest = await readLessonTask(conversationId, task.signal);
          if (task.signal.aborted) return;
          if (latest.question?.question_id !== progress.question?.question_id) leaveDetail();
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
    requestAnimationFrame(() => launch.current?.focus({ preventScroll: true }));
  }

  function leaveDetail() {
    setSelection(null);
    setQuestions(previous => previous === null ? null : false);
  }

  function openSingleDetail() {
    focusDestination.current = 'step';
    setSelection({ questionId: scopedQuestionId, part: 'single' });
  }

  function returnFromSingleDetail() {
    focusDestination.current = 'entry';
    leaveDetail();
  }

  function selectSubquestion(number?: number) {
    if (explainingSubquestion) {
      request.current?.abort();
      request.current = null;
      setExplainingSubquestion(false);
    }
    setSubquestionError('');
    if (number === undefined) {
      leaveDetail();
    } else {
      focusDestination.current = 'step';
      setSelection({ questionId: scopedQuestionId, part: number });
    }
  }

  async function explainSelection() {
    if (!progress || activeSubquestion === undefined || request.current || stale) return;
    const task = new AbortController();
    request.current = task;
    setSubquestionError('');
    setExplainingSubquestion(true);
    try {
      const result = await requestSubquestionExplanation(
        conversationId, progress.revision, activeSubquestion, task.signal,
      );
      if (task.signal.aborted) return;
      focusDestination.current = 'step';
      setExplanations(previous => ({
        questionId: scopedQuestionId,
        byNumber: {
          ...(previous?.questionId === scopedQuestionId ? previous.byNumber : {}),
          [result.number]: result,
        },
      }));
    } catch (cause) {
      if (task.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onSessionExpired();
      else {
        if (cause instanceof ApiError && cause.status === 409) setStale(true);
        setSubquestionError(cause instanceof Error ? cause.message : '小题讲解暂不可用，请重试');
      }
    } finally {
      if (request.current === task) {
        request.current = null;
        setExplainingSubquestion(false);
      }
    }
  }

  const primary: LessonCommand = progress?.status === 'final_step' ? 'complete' :
    progress?.status === 'completed' ? 'next-question' : progress?.status === 'teaching' ? 'next' : 'start';
  const blocked = Boolean(busy) || explainingSubquestion || stale;
  const checkError = failedAction === 'check-answer' || failedAction === 'evaluate-check';
  const localAction = failedAction === 'hint' || failedAction === 'rephrase' || failedAction === 'check-question';
  const overviewAction = progress?.actions.includes('next-question') ? 'next-question' :
    (!problem || (legacy && progress?.problem_parts)) && progress?.actions.includes('start') ? 'start' : undefined;
  const openSingle = Boolean(problem && !progress?.problem_parts);
  const showFooter = Boolean(busy || stale || explainingSubquestion || error || insideDetail || overviewAction || openSingle);

  return <section className="learning-conversation-main learning-conversation-point lesson-workspace"
    aria-label={title} data-questions-open={questionsOpen}>
    <header className="lesson-header">
      <h1 ref={heading} id="learning-point-title" tabIndex={-1}>{title}</h1>
    </header>
    <section className="lesson-main" aria-labelledby="learning-point-title">
      <div className="lesson-reading-pane" data-overview={!insideDetail}>
        {problem ? <div className="lesson-problem-dock" ref={problemDock}>
          <ProblemCard key={questionId} text={problem} format={progress?.question?.format}
            parts={progress?.problem_parts} active={activeSubquestion} onSelect={selectSubquestion}
            onReturn={singleDetail ? returnFromSingleDetail : undefined} />
        </div> : null}
        {insideDetail ? <div className="lesson-content" ref={content} role="region"
          aria-label={singleDetail ? '题目讲解' : '小题讲解'} tabIndex={0}>
          <div className="lesson-body">
            {focusedExplanation ? <LessonStep title={focusedExplanation.title} subquestion={focusedExplanation.number}
              step={{ ...focusedExplanation, index: focusedExplanation.number, format: 'markdown' }} /> : null}
            {singleDetail && progress && step ? <>
              <LessonStep title={withoutStepLabels(step.title)}
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
            </> : null}
            {singleDetail && complete ? <section className="lesson-completion" role="status">
              <strong>本题已完成</strong>
              {progress?.completion && progress.plan ? <p>你确认完成了 {progress.plan.total_steps} 个教学步骤。</p> : null}
            </section> : null}
          </div>
        </div> : null}
      </div>
      {showFooter ? <footer className="lesson-footer">
        {busy && ['load', 'start', 'next', 'next-question', 'complete'].includes(busy) ? <p className="muted" role="status">
          {busy === 'load' ? '正在读取教学进度…' : busy === 'complete' ? '正在保存完成记录…'
            : busy === 'next' ? '正在生成下一步…' : '正在准备题目和教学步骤…'}
        </p> : null}
        {explainingSubquestion ? <p className="muted" role="status">正在准备第（{activeSubquestion}）问的讲解…</p> : null}
        {activeSubquestion !== undefined && subquestionError ? <p className="notice error" role="alert">{subquestionError}</p> : null}
        {error && !localAction && !checkError ? <p className="notice error" role="alert">{error}</p> : null}
        {((!progress && error) || stale) ? <button type="button" className="button secondary"
          disabled={Boolean(busy)} onClick={() => void load()}>重新加载进度</button> : null}
        <div className="lesson-actions">
          {insideDetail ? <button ref={launch} type="button" className="button secondary" aria-expanded={questionsOpen}
            aria-controls={questions === null ? undefined : 'teaching-questions'}
            onClick={() => {
              if (questionsOpen) closeQuestions();
              else { rememberReadingPosition(); setQuestions(true); }
            }}>随时提问</button> : null}
          {activeSubquestion !== undefined && !focusedExplanation ?
            <button type="button" className="button primary lesson-primary-action" disabled={blocked}
              onClick={() => void explainSelection()}>开始讲解</button> : null}
          {singleDetail && progress ? <LessonActions task={progress} primary={primary} disabled={blocked} busy={busy}
            run={action => void act(action)} /> : null}
          {!insideDetail && openSingle ? <button ref={detailEntry} type="button"
            className={overviewAction ? 'button secondary' : 'button primary lesson-primary-action'}
            onClick={openSingleDetail}>开始讲解</button> : null}
          {!insideDetail && overviewAction ? <button type="button" className="button primary lesson-primary-action"
            disabled={blocked} onClick={() => void act(overviewAction)}>
            {legacy ? actionLabels['next-question'] : actionLabels[overviewAction]}
          </button> : null}
        </div>
      </footer> : null}
    </section>
    {questions !== null ? <TeachingChat conversationId={conversationId} open={questionsOpen}
      activeStep={progress?.current_step?.index}
      subquestion={progress && activeSubquestion !== undefined ? { number: activeSubquestion, revision: progress.revision } : undefined}
      onClose={closeQuestions} onSessionExpired={onSessionExpired} /> : null}
  </section>;
}
