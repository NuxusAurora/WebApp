'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math-extended';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ContentFormat, LessonProblemParts, PublishedStep } from '../lib/lesson-task';

export function LessonContent({ text, format }: { text: string; format?: ContentFormat }) {
  if (format !== 'markdown') return <p>{text}</p>;
  return <div className="lesson-rich">
    <Markdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false }]]}
      components={{
        img: ({ alt }) => alt ? <span>{alt}</span> : null,
        pre: ({ children }) => <pre tabIndex={0} role="region" aria-label="代码块">{children}</pre>,
        table: ({ children }) => <div className="lesson-wide" role="region" tabIndex={0} aria-label="表格"><table>{children}</table></div>,
      }}>{text}</Markdown>
  </div>;
}

export function ProblemCard({ text, format, parts, active, label = '题目', onSelect, onReturn, onExplain }: {
  text: string; format?: ContentFormat; parts?: LessonProblemParts;
  active?: number; label?: string; onSelect?: (number?: number) => void;
  onReturn?: () => void; onExplain?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const headingId = useId();
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);
  const returnPart = useRef<number | undefined>(undefined);
  const visibleParts = active === undefined ? parts?.parts : parts?.parts.filter(part => part.number === active);
  useLayoutEffect(() => {
    if (!open || active === undefined || !body.current) return;
    const panel = body.current;
    const part = panel.querySelector('[data-active="true"]');
    if (!part) return;
    const bottom = part.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
    if (bottom > 0) panel.scrollTop += bottom;
  }, [active, open]);
  useLayoutEffect(() => {
    if (active !== undefined || returnPart.current === undefined) return;
    body.current?.querySelector<HTMLButtonElement>(`[data-part="${returnPart.current}"]`)?.focus();
    returnPart.current = undefined;
  }, [active]);
  function clearPart() {
    returnPart.current = active;
    setOpen(true);
    onSelect?.();
  }
  return <section className="lesson-block lesson-problem-card" aria-labelledby={headingId}>
    <div className="lesson-problem-header">
      <h2 id={headingId} data-problem-heading tabIndex={-1}>{active === undefined ? label : `第（${active}）问`}</h2>
      <div className="lesson-problem-controls">
        {onReturn ? <button type="button" className="text-button" onClick={onReturn}>返回题目</button> : null}
        {onExplain ? <button type="button" className="text-button" data-detail-entry
          onClick={onExplain}>开始讲解</button> : null}
        {active !== undefined ? <button type="button" className="text-button"
          onClick={clearPart}>查看全部小题</button> : null}
        <button type="button" className="text-button" aria-expanded={open} aria-controls={bodyId}
          onClick={() => setOpen(!open)}>{open ? '收起题目' : '展开题目'}</button>
      </div>
    </div>
    <div id={bodyId} ref={body} className="lesson-problem-text" hidden={!open} tabIndex={0} role="region" aria-label="题面">
      {parts && visibleParts?.length && onSelect ? <>
        {parts.statement ? <LessonContent text={parts.statement} format={format} /> : null}
        <div className="lesson-problem-parts">
          {visibleParts.map(part => <div key={part.number} className="lesson-problem-part"
            data-active={part.number === active} onClick={event => {
              if (active !== undefined || !(event.target instanceof Element) || window.getSelection()?.toString()) return;
              const interactive = event.target.closest('button, a, [tabindex]');
              if (!event.currentTarget.contains(interactive)) onSelect(part.number);
            }}>
            <button type="button" className="text-button lesson-part-number" data-part={part.number}
              aria-label={`第（${part.number}）问`} aria-pressed={part.number === active}
              onClick={part.number === active ? clearPart : () => onSelect(part.number)}>（{part.number}）</button>
            <LessonContent text={part.text} format={format} />
          </div>)}
        </div>
      </> : <LessonContent text={text} format={format} />}
    </div>
  </section>;
}

export function LessonStep({ title, step, subquestion, current = true }: {
  title: string; step: PublishedStep; subquestion?: number; current?: boolean;
}) {
  return <section className="lesson-block lesson-reading-step"
    aria-label={subquestion === undefined ? `第 ${step.index} 步` : `第（${subquestion}）问讲解`}>
    {current ? <>
      {subquestion !== undefined ? <p className="lesson-step-number">解第（{subquestion}）问：</p> : null}
      <h2 id="lesson-step" tabIndex={-1}>{subquestion !== undefined ? title : `第 ${step.index} 步${title ? '：' + title : ''}`}</h2>
    </> : <h3>第 {step.index} 步：{title}</h3>}
    {step.objective ? <p className="lesson-objective"><strong>本步目标</strong> {step.objective}</p> : null}
    <LessonContent text={step.content} format={step.format} />
    {step.takeaway ? <p><strong>本步结论</strong> {step.takeaway}</p> : null}
  </section>;
}
