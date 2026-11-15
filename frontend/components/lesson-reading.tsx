'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ContentFormat, PublishedStep } from '../lib/lesson-task';

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

export function ProblemCard({ text, format }: { text: string; format?: ContentFormat }) {
  const [open, setOpen] = useState(true);
  const long = text.length > 220 || text.split('\n').length > 5;
  return <section className="lesson-block lesson-problem-card" aria-labelledby="lesson-problem">
    <div className="lesson-problem-header">
      <h2 id="lesson-problem">题目</h2>
      {long ? <button type="button" className="text-button" aria-expanded={open} aria-controls="lesson-problem-text"
        onClick={() => setOpen(!open)}>{open ? '收起题目' : '展开题目'}</button> : null}
    </div>
    <div id="lesson-problem-text" hidden={long && !open}><LessonContent text={text} format={format} /></div>
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
