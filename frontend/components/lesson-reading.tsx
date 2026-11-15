'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
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

export function ProblemCard({ text, format, parts, active, onSelect }: {
  text: string; format?: ContentFormat; parts?: LessonProblemParts;
  active?: number; onSelect?: (number?: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<number | undefined>(undefined);
  const visibleParts = active === undefined ? parts?.parts : parts?.parts.filter(part => part.number === active);
  useLayoutEffect(() => {
    if (active !== undefined || restoreFocus.current === undefined) return;
    body.current?.querySelector<HTMLButtonElement>(`[data-part="${restoreFocus.current}"]`)?.focus();
    restoreFocus.current = undefined;
  }, [active]);
  return <section className="lesson-block lesson-problem-card" aria-labelledby="lesson-problem">
    <div className="lesson-problem-header">
      <h2 id="lesson-problem" tabIndex={-1}>题目</h2>
      <div className="lesson-problem-controls">
        {open && active !== undefined ? <button type="button" className="text-button" onClick={() => {
          restoreFocus.current = active;
          onSelect?.();
        }}>查看全部小题</button> : null}
        <button type="button" className="text-button" aria-expanded={open} aria-controls="lesson-problem-text"
          onClick={() => setOpen(!open)}>{open ? '收起题目' : '展开题目'}</button>
      </div>
    </div>
    <div id="lesson-problem-text" ref={body} hidden={!open} tabIndex={0} role="region" aria-label="题面">
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
              onClick={() => onSelect(part.number === active ? undefined : part.number)}>（{part.number}）</button>
            <LessonContent text={part.text} format={format} />
          </div>)}
        </div>
      </> : <LessonContent text={text} format={format} />}
    </div>
  </section>;
}

export function LessonStep({ title, step, total, current = true }: {
  title: string; step: PublishedStep; total?: number; current?: boolean;
}) {
  return <section className="lesson-block lesson-reading-step" aria-label={`第 ${step.index} 步`}>
    {current ? <>
      {total ? <p className="lesson-step-number">解第（{step.index}）问：</p> : null}
      <h2 id="lesson-step" tabIndex={-1}>{total ? title : `第 ${step.index} 步${title ? '：' + title : ''}`}</h2>
    </> : <h3>第 {step.index} 步：{title}</h3>}
    {step.objective ? <p className="lesson-objective"><strong>本步目标</strong> {step.objective}</p> : null}
    <LessonContent text={step.content} format={step.format} />
    {step.takeaway ? <p><strong>本步结论</strong> {step.takeaway}</p> : null}
  </section>;
}
