'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { LessonCheck, LessonCommand, LessonCommandFields, LessonTask } from '../lib/lesson-task';
import { LessonContent } from './lesson-reading';

export const actionLabels: Record<LessonCommand, string> = {
  start: '开始学习', next: '我理解了，下一步', complete: '我理解了，完成本题',
  'custom-question': '自定义题目', 'similar-question': '相似题目', 'next-type': '题目类型',
  'master-type': '掌握本题型', finish: '完结',
  hint: '给我提示', rephrase: '换一种方式',
  'check-question': '验证一下', 'check-answer': '提交回答', 'evaluate-check': '重新评价',
};

export function LessonSupport({ support }: { support: LessonTask['support'] }) {
  return <>
    {support?.hints?.length ? <section className="lesson-block lesson-support" aria-label="提示">
      {support.hints.map(({ level, text }) => <details key={level} open={level === support.hints?.length}>
        <summary>提示 {level} / 3</summary><LessonContent text={text} format="markdown" />
      </details>)}
    </section> : null}
    {support?.rephrase ? <details open className="lesson-block lesson-support">
      <summary>另一种解释</summary><LessonContent text={support.rephrase} format="markdown" />
    </details> : null}
  </>;
}

export function UnderstandingCheck({ check, busy, disabled, error, submit }: {
  check: LessonCheck; busy: 'load' | LessonCommand | null; disabled: boolean; error: string;
  submit: (action: 'check-answer' | 'evaluate-check', fields: { check_id: string; answer?: string }) => void;
}) {
  const [draft, setDraft] = useState('');
  return <section className="lesson-block lesson-check" aria-labelledby="check-title">
    <h2 id="check-title">理解检测</h2>
    <LessonContent text={check.question} format="markdown" />
    {check.status === 'awaiting_answer' ? <form className="lesson-check-form" onSubmit={event => {
      event.preventDefault(); if (draft.trim()) submit('check-answer', { check_id: check.check_id, answer: draft.trim() });
    }}>
      <label htmlFor="lesson-response">你的回答</label>
      <textarea id="lesson-response" rows={3} maxLength={1000} value={draft}
        placeholder="写下你的理解…" onChange={event => setDraft(event.target.value)} readOnly={disabled} />
      <button className="button secondary" disabled={disabled || !draft.trim()}>提交回答</button>
    </form> : <>
      <p><strong>你的回答</strong></p><p>{check.answer}</p>
      {check.status === 'feedback_ready' ? <>
        <h3>理解反馈</h3><LessonContent text={check.feedback ?? ''} format="markdown" />
      </> : busy !== 'evaluate-check' ? <button type="button" className="button secondary" disabled={disabled}
        onClick={() => submit('evaluate-check', { check_id: check.check_id })}>重新评价</button> : null}
    </>}
    {busy === 'check-answer' || busy === 'evaluate-check' ? <p role="status">正在评价…</p> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
  </section>;
}

export function LessonActions({ task, primary, busy, disabled, run }: {
  task: LessonTask; primary: LessonCommand; busy: 'load' | LessonCommand | null; disabled: boolean;
  run: (action: LessonCommand) => void;
}) {
  const supporting = (['rephrase', 'hint', 'check-question'] as const).filter(action => task.actions.includes(action));
  const buttons = supporting.map(action => <button key={action} type="button" className="button secondary"
    disabled={disabled} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); run(action); }}>
    {busy === action ? '正在生成…' : actionLabels[action]}
  </button>);
  return <>
    {supporting.length ? <>
      <div className="lesson-secondary-actions">{buttons}</div>
      <details className="lesson-actions-menu"><summary>更多操作</summary><div>{buttons}</div></details>
    </> : null}
    {task.actions.includes(primary) ? <button type="button" className="button primary lesson-primary-action"
      disabled={disabled} onClick={() => run(primary)}>{actionLabels[primary]}</button> : null}
  </>;
}

function PracticeNavigation({ task, disabled, run }: {
  task: LessonTask; disabled: boolean; run: (action: LessonCommand, fields?: LessonCommandFields) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const fieldId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  const { practice } = task;
  const canCustomize = task.actions.includes('custom-question');
  const canAdvance = task.actions.includes('next-type');
  if (!canCustomize && !canAdvance) return null;
  const typeLabel = practice
    ? `${actionLabels['next-type']} ${practice.current + 1}/${practice.types.length}`
    : actionLabels['next-type'];

  return <>
    <div className="lesson-practice-actions">
      {canCustomize ? <button ref={trigger} type="button" className="button secondary" disabled={disabled}
        aria-expanded={open} aria-controls={open ? fieldId + '-form' : undefined}
        onClick={() => setOpen(!open)}>{actionLabels['custom-question']}</button> : null}
      <button type="button" className="button primary" disabled={disabled || !canAdvance}
        title={canAdvance ? '切换到下一个题型' : undefined}
        onClick={() => run('next-type')}>{typeLabel}</button>
    </div>
    {canCustomize && open ? <form id={fieldId + '-form'} className="lesson-custom-question" onSubmit={event => {
      event.preventDefault();
      if (!disabled && draft.trim()) run('custom-question', { question_request: draft.trim() });
    }} onKeyDown={event => {
      if (event.key === 'Escape' && !disabled) {
        event.preventDefault();
        close();
      }
    }}>
      <label htmlFor={fieldId}>出题要求</label>
      <textarea ref={field} id={fieldId} className="ui-input" rows={2} maxLength={1000} required readOnly={disabled}
        value={draft} onChange={event => setDraft(event.target.value)} placeholder="例如，用实际场景出一道有三小题的练习" />
      <div className="lesson-custom-question-actions">
        <button type="button" className="button secondary" disabled={disabled} onClick={close}>取消</button>
        <button type="submit" className="button primary" disabled={disabled || !draft.trim()}>生成题目</button>
      </div>
    </form> : null}
  </>;
}

export function PracticeActions({ task, disabled, allowMastery, showNavigation, run }: {
  task: LessonTask; disabled: boolean; allowMastery: boolean; showNavigation: boolean;
  run: (action: LessonCommand, fields?: LessonCommandFields) => void;
}) {
  if (task.actions.includes('finish')) return <button type="button" className="button primary lesson-primary-action"
    disabled={disabled} onClick={() => run('finish')}>{actionLabels.finish}</button>;
  return <>
    {allowMastery && task.actions.includes('master-type') ? <button type="button" className="button secondary"
      disabled={disabled} onClick={() => run('master-type')}>{actionLabels['master-type']}</button> : null}
    {showNavigation ? <PracticeNavigation key={task.question?.question_id} task={task}
      disabled={disabled} run={run} /> : null}
  </>;
}
