'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { createLessonFocusMotion, findLessonQuestion,
  type LessonFocusOrigin, type LessonReturnOrigin } from '../lib/lesson-focus-motion';
import { readLessonTask, requestSubquestionExplanation, runLessonCommand,
  type LessonCommand, type LessonCommandFields, type LessonTask, type SubquestionExplanation } from '../lib/lesson-task';
import { LessonContent, LessonStep, ProblemCard } from './lesson-reading';
import { actionLabels, LessonActions, LessonSupport, PracticeActions, UnderstandingCheck } from './lesson-actions';
import { TeachingChat, teachingChatLabel } from './teaching-chat';

const supportLabels = { explain: '另一种讲法', hint: '提示', evaluate: '反馈' };
const questionActions: LessonCommand[] = ['start', 'custom-question', 'select-type'];
const questionKey = (task: LessonTask) => task.question?.question_id ?? 'legacy:' + task.revision;
const questionNumberLabel = (index: number) => `题目 ${index + 1}`;
function questionLabel(task: LessonTask, index: number) {
  const type = task.question?.type_title;
  return type ? `${questionNumberLabel(index)} · ${type}` : questionNumberLabel(index);
}
type FocusTransition = {
  motion: NonNullable<ReturnType<typeof createLessonFocusMotion>>;
} & ({ direction: 'enter'; origin: LessonFocusOrigin | null } |
  { direction: 'return'; origin: LessonReturnOrigin | null; part: number });

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
  const [explanations, setExplanations] = useState<Record<string, Partial<Record<number, SubquestionExplanation>>>>({});
  const [explainingSubquestion, setExplainingSubquestion] = useState(false);
  const [subquestionError, setSubquestionError] = useState('');
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const problemDock = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const overviewScrollTop = useRef(0);
  const focusMotion = useRef<FocusTransition | null>(null);
  const focusDestination = useRef<{
    questionId: string; selector: string; showQuestion?: boolean; scrollOnly?: boolean;
    restoreScrollTop?: number;
  } | 'step' | 'dock' | null>(null);
  const readingAnchor = useRef<{ node?: HTMLElement; top: number } | null>(null);

  const timeline = progress ? [...(progress.previous_questions ?? []), progress]
    .filter(task => task.question?.problem || task.legacy?.problem)
    .sort((a, b) => (a.question_order ?? a.revision) - (b.question_order ?? b.revision)) : [];
  const selectedIndex = selection ? timeline.findIndex(task => questionKey(task) === selection.questionId) : -1;
  const selectedQuestion = selectedIndex >= 0 ? timeline[selectedIndex] : undefined;
  const selectedPart = selectedQuestion ? selection?.part : undefined;
  const currentDetail = Boolean(selectedQuestion && selectedQuestion === progress);
  const singleDetail = selectedPart === 'single';
  const legacy = selectedQuestion?.legacy;
  const step = selectedQuestion?.current_step ?? legacy?.step;
  const complete = selectedQuestion?.status === 'completed' || legacy?.complete;
  const activeSubquestion = typeof selectedPart === 'number' ? selectedPart : undefined;
  const focusedExplanation = selection && activeSubquestion !== undefined
    ? explanations[selection.questionId]?.[activeSubquestion] : undefined;
  const pinProblem = Boolean(selectedQuestion && activeSubquestion !== undefined);
  const questionsOpen = currentDetail && Boolean(questions);

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
      if (result.previous_questions?.length) {
        focusDestination.current = {
          questionId: questionKey(result), selector: '[data-problem-heading]', showQuestion: true, scrollOnly: true,
        };
      }
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
      focusMotion.current?.motion.cancel();
      focusMotion.current = null;
    };
  }, [load]);

  useLayoutEffect(() => {
    const panel = content.current;
    const destination = focusDestination.current;
    if (destination) {
      const slot = findLessonQuestion(panel, typeof destination === 'string' ? selection?.questionId : destination.questionId);
      const target = destination === 'step' ? slot?.querySelector<HTMLElement>('#lesson-step') :
        destination === 'dock' ? problemDock.current?.querySelector<HTMLElement>('[data-problem-heading]') :
          slot?.querySelector<HTMLElement>(destination.selector);
      const transition = focusMotion.current;
      let deferFocus = false;
      if (destination === 'dock') {
        if (panel) panel.scrollTop = 0;
        if (transition?.direction === 'enter' && transition.origin && problemDock.current && activeSubquestion !== undefined) {
          void transition.motion.settle(problemDock.current, activeSubquestion, transition.origin,
            slot?.querySelector<HTMLElement>('.lesson-reading-step'))
            .catch(() => transition.motion.cancel())
            .finally(() => { if (focusMotion.current === transition) focusMotion.current = null; });
        }
      } else if (typeof destination !== 'string' && destination.showQuestion) {
        slot?.scrollIntoView?.({ block: 'start' });
      } else if (panel && typeof destination !== 'string' && destination.restoreScrollTop !== undefined) {
        const readingTop = destination.restoreScrollTop;
        if (transition?.direction === 'return' && transition.origin && slot) {
          deferFocus = true;
          panel.focus({ preventScroll: true });
          void transition.motion.restore(slot, transition.part, transition.origin, readingTop)
            .catch(() => {
              transition.motion.cancel();
              if (focusMotion.current === transition) panel.scrollTop = readingTop;
            })
            .finally(() => {
              if (focusMotion.current !== transition) return;
              focusMotion.current = null;
              if (document.activeElement === panel) target?.focus({ preventScroll: true });
            });
        } else {
          panel.scrollTop = readingTop;
        }
      } else {
        target?.scrollIntoView?.({ block: 'nearest' });
      }
      if (!deferFocus && (typeof destination === 'string' || !destination.scrollOnly)) target?.focus({ preventScroll: true });
      focusDestination.current = null;
    } else if (panel?.clientHeight && readingAnchor.current) {
      const { node, top } = readingAnchor.current;
      panel.scrollTop = node && panel.contains(node)
        ? panel.scrollTop + node.getBoundingClientRect().top - panel.getBoundingClientRect().top + top
        : top;
    }
    readingAnchor.current = null;
  }, [progress, questionsOpen, selection, activeSubquestion, focusedExplanation]);

  async function act(action: LessonCommand, fields?: LessonCommandFields) {
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
      if (questionActions.includes(action) || action === 'finish' || action === 'master-type') {
        leaveDetail();
        focusDestination.current = {
          questionId: questionKey(result), selector: '[data-problem-heading]', showQuestion: true,
        };
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

  function clearSelection() {
    setSelection(null);
    setQuestions(previous => previous === null ? null : false);
  }

  function stopFocusMotion() {
    focusMotion.current?.motion.cancel();
    focusMotion.current = null;
  }

  function leaveDetail() {
    stopFocusMotion();
    clearSelection();
  }

  function openSingleDetail(task: LessonTask) {
    stopFocusMotion();
    cancelSubquestion();
    setQuestions(previous => previous === null ? null : false);
    focusDestination.current = 'step';
    setSelection({ questionId: questionKey(task), part: 'single' });
  }

  function returnFromSingleDetail(task: LessonTask) {
    focusDestination.current = { questionId: questionKey(task), selector: '[data-detail-entry]' };
    leaveDetail();
  }

  function cancelSubquestion() {
    if (explainingSubquestion) {
      request.current?.abort();
      request.current = null;
      setExplainingSubquestion(false);
    }
    setSubquestionError('');
  }

  function returnFromSubquestion(questionId: string, part: number) {
    if (focusMotion.current?.direction === 'return') return;
    stopFocusMotion();
    const panel = content.current;
    const dock = problemDock.current;
    const motion = panel && dock && createLessonFocusMotion(panel);
    const showOverview = () => {
      focusDestination.current = {
        questionId,
        selector: `[data-part="${part}"]`,
        restoreScrollTop: overviewScrollTop.current,
      };
      clearSelection();
    };
    if (!motion || !dock) {
      showOverview();
      return;
    }
    const transition: FocusTransition = { direction: 'return', motion, part, origin: null };
    focusMotion.current = transition;
    const slot = findLessonQuestion(panel, questionId);
    void motion.depart(dock, part, slot?.querySelector<HTMLElement>('.lesson-reading-step')).catch(() => null).then(origin => {
      if (focusMotion.current !== transition) return;
      transition.origin = origin;
      if (!origin) stopFocusMotion();
      showOverview();
    });
  }

  function selectSubquestion(task: LessonTask, number?: number) {
    cancelSubquestion();
    const questionId = questionKey(task);
    if (number === undefined) {
      if (activeSubquestion !== undefined) returnFromSubquestion(questionId, activeSubquestion);
      return;
    }

    const panel = content.current;
    if (!pinProblem && focusMotion.current?.direction !== 'enter') overviewScrollTop.current = panel?.scrollTop ?? 0;
    stopFocusMotion();
    const open = () => {
      setQuestions(previous => previous === null ? null : false);
      focusDestination.current = 'dock';
      setSelection({ questionId, part: number });
    };
    const slot = findLessonQuestion(panel, questionId);
    const motion = panel && slot && createLessonFocusMotion(panel);
    if (!motion || !slot) {
      open();
      return;
    }
    const transition: FocusTransition = { direction: 'enter', motion, origin: null };
    focusMotion.current = transition;
    void motion.lift(slot, number).catch(() => null).then(origin => {
      if (focusMotion.current !== transition) return;
      transition.origin = origin;
      if (!origin) {
        motion.cancel();
        focusMotion.current = null;
      }
      open();
    });
  }

  async function explainSelection() {
    if (!progress || !selectedQuestion || !selection || activeSubquestion === undefined || request.current || stale) return;
    const task = new AbortController();
    request.current = task;
    setSubquestionError('');
    setExplainingSubquestion(true);
    try {
      const result = await requestSubquestionExplanation(
        conversationId, progress.revision, activeSubquestion, task.signal,
        currentDetail ? undefined : selectedQuestion.revision,
      );
      if (task.signal.aborted) return;
      focusDestination.current = 'step';
      setExplanations(previous => ({
        ...previous,
        [selection.questionId]: {
          ...previous[selection.questionId],
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
    progress?.status === 'teaching' ? 'next' : 'start';
  const blocked = Boolean(busy) || explainingSubquestion || stale;
  const checkError = failedAction === 'check-answer' || failedAction === 'evaluate-check';
  const localAction = failedAction === 'hint' || failedAction === 'rephrase' || failedAction === 'check-question';
  const canStart = progress?.actions.includes('start');
  const practice = progress?.practice;
  const busyNavigation = busy && (questionActions.includes(busy as LessonCommand) ||
    ['load', 'next', 'complete', 'master-type', 'finish'].includes(busy));
  const showFooter = Boolean(busy || stale || explainingSubquestion || error || currentDetail ||
    activeSubquestion !== undefined || canStart || practice || progress?.actions.some(action => action === 'custom-question' || action === 'select-type'));

  return <section className="learning-conversation-main learning-conversation-point lesson-workspace"
    aria-label={title} data-questions-open={questionsOpen}>
    <header className="lesson-header">
      <h1 ref={heading} id="learning-point-title" tabIndex={-1}>{title}</h1>
    </header>
    <section className="lesson-main" aria-labelledby="learning-point-title">
      <div className="lesson-reading-pane">
        {pinProblem && selectedQuestion ? <div className="lesson-problem-dock" ref={problemDock}>
          <ProblemCard key={questionKey(selectedQuestion)}
            text={selectedQuestion.question?.problem ?? selectedQuestion.legacy?.problem ?? ''}
            format={selectedQuestion.question?.format} parts={selectedQuestion.problem_parts}
            label={questionLabel(selectedQuestion, selectedIndex)}
            active={activeSubquestion} onSelect={number => selectSubquestion(selectedQuestion, number)} />
        </div> : null}
        <div className="lesson-content" ref={content} role="region" aria-label="练习对话" tabIndex={0}>
          <div className="lesson-body">{timeline.map((task, index) => {
            const key = questionKey(task);
            const selected = task === selectedQuestion;
            const showSingleDetail = selected && singleDetail;
            return <div className="lesson-question" key={key} data-lesson-question={key} hidden={pinProblem && !selected}>
              {!(selected && pinProblem) ? <ProblemCard
                text={task.question?.problem ?? task.legacy?.problem ?? ''}
                format={task.question?.format} parts={task.problem_parts}
                label={questionLabel(task, index)} isCurrent={task === progress}
                onSelect={number => selectSubquestion(task, number)}
                onReturn={showSingleDetail ? () => returnFromSingleDetail(task) : undefined}
                onExplain={!task.problem_parts && !showSingleDetail ? () => openSingleDetail(task) : undefined} /> : null}
              {selected && focusedExplanation ? <LessonStep
                title={`${questionNumberLabel(index)} · ${focusedExplanation.title}`} subquestion={focusedExplanation.number}
                step={{ ...focusedExplanation, index: focusedExplanation.number, format: 'markdown' }} /> : null}
              {showSingleDetail && step ? <>
                <LessonStep title={withoutStepLabels(step.title)}
                  step={{ ...step, content: withoutStepLabels(step.content) }} />
                {Boolean(task.completed_steps?.some(entry => entry.index < step.index)) ? <details className="lesson-history">
                  <summary>已完成步骤（{step.index - 1}）</summary>
                  {task.completed_steps?.filter(entry => entry.index < step.index).map(entry => <LessonStep key={entry.step_id}
                    title={withoutStepLabels(entry.title)} step={entry} current={false} />)}
                </details> : null}
                {legacy?.check ? <section className="lesson-block"><h2>理解检测</h2><p>{legacy.check}</p></section> : null}
                {legacy?.support ? <section className="lesson-block" aria-live="polite">
                  <h2>{supportLabels[legacy.support.kind]}</h2>
                  <LessonContent text={legacy.support.text} />
                </section> : null}
                <LessonSupport key={task.current_step?.step_id ?? 'legacy-support'} support={task.support} />
                {currentDetail && (busy === 'hint' || busy === 'rephrase' || busy === 'check-question') ? <p role="status">
                  {busy === 'check-question' ? '正在准备检测题…' : '正在生成辅助讲解…'}
                </p> : null}
                {currentDetail && error && localAction ? <p className="notice error" role="alert">{error}</p> : null}
                {task.check ? <UnderstandingCheck key={task.check.check_id} check={task.check}
                  busy={currentDetail ? busy : null} disabled={!currentDetail || blocked || task.status === 'completed'}
                  error={currentDetail && checkError ? error : ''} submit={(action, fields) => void act(action, fields)} /> : null}
              </> : null}
              {showSingleDetail && complete ? <section className="lesson-completion" role="status">
                <strong>本题已完成</strong>
              </section> : null}
            </div>;
          })}</div>
        </div>
      </div>
      {showFooter ? <footer className="lesson-footer">
        {busyNavigation ? <p className="muted" role="status">
          {busy === 'load' ? '正在读取教学进度…' : busy === 'complete' || busy === 'master-type' || busy === 'finish' ? '正在保存完成记录…'
            : busy === 'next' ? '正在生成下一步…'
              : busy === 'select-type' ? '正在打开所选题型…' : '正在准备题目和教学步骤…'}
        </p> : null}
        {explainingSubquestion ? <p className="muted" role="status">正在准备讲解…</p> : null}
        {activeSubquestion !== undefined && subquestionError ? <p className="notice error" role="alert">{subquestionError}</p> : null}
        {error && !localAction && !checkError ? <p className="notice error" role="alert">{error}</p> : null}
        {((!progress && error) || stale) ? <button type="button" className="button secondary"
          disabled={Boolean(busy)} onClick={() => void load()}>重新加载进度</button> : null}
        {practice?.finished ? <p className="lesson-practice-status" role="status">知识点已完结</p> :
          practice ? <details className="lesson-practice-status">
            <summary><span role="status">已掌握 {practice.mastered.length} / {practice.types.length} 种题型</span></summary>
            <ol>{practice.types.map(({ title }, index) => <li key={title}>
              {title} · {practice.mastered.includes(index) ? '已掌握' : index === practice.current ? '当前题型' : '待掌握'}
            </li>)}</ol>
          </details> : null}
        <div className="lesson-actions">
          {activeSubquestion !== undefined && !focusedExplanation ?
            <button type="button" className="button primary" disabled={blocked}
              onClick={() => void explainSelection()}>开始讲解</button> : null}
          {singleDetail && currentDetail && progress && progress.status !== 'legacy' ? <LessonActions task={progress}
            primary={primary} disabled={blocked} busy={busy}
            run={action => void act(action)} /> : null}
          {canStart ? <button type="button" className="button primary lesson-primary-action"
            disabled={blocked} onClick={() => void act('start')}>{actionLabels.start}</button> : null}
          {progress ? <PracticeActions task={progress} disabled={blocked} allowMastery={!selectedQuestion || currentDetail}
            showNavigation={!selectedQuestion} run={(action, fields) => void act(action, fields)} /> : null}
          {currentDetail ? <button ref={launch} type="button" className="button secondary lesson-ask-action"
            aria-expanded={questionsOpen} aria-controls={questions === null ? undefined : 'teaching-questions'}
            onClick={() => {
              if (questionsOpen) closeQuestions();
              else { rememberReadingPosition(); setQuestions(true); }
            }}>{teachingChatLabel}</button> : null}
        </div>
      </footer> : null}
    </section>
    {questions !== null ? <TeachingChat conversationId={conversationId} open={questionsOpen}
      activeStep={progress?.current_step?.index}
      subquestion={progress && activeSubquestion !== undefined ? { number: activeSubquestion, revision: progress.revision } : undefined}
      onClose={closeQuestions} onSessionExpired={onSessionExpired} /> : null}
  </section>;
}
