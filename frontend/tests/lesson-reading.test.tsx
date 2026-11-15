// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { LessonContent, ProblemCard } from '../components/lesson-reading';

afterEach(cleanup);

it('typesets TeX-delimited inline formulas and a matrix within a Markdown list', () => {
  const text = String.raw`- **\(A\) 是一个三阶方阵**
  \[
  A=\begin{pmatrix}2&-1&0\\4&3&5\\1&6&-2\end{pmatrix}.
  \]
- \(\det(A)\) 也可记作 \(|A|\)。

${'`'}\(literal\)${'`'}

~~~
\[not math\]
~~~`;
  const { container } = render(<LessonContent text={text} format="markdown" />);

  expect(container.querySelectorAll('li .katex:not(.katex-display .katex)')).toHaveLength(3);
  expect(container.querySelectorAll('li .katex-display mtr')).toHaveLength(3);
  expect(container.querySelectorAll('li .katex-display mtd')).toHaveLength(9);
  expect(container.querySelector('.katex-error')).toBeNull();
  expect(container.querySelector('p > code')).toHaveTextContent(String.raw`\(literal\)`);
  expect(container.querySelector('pre > code')).toHaveTextContent(String.raw`\[not math\]`);
});

it('keeps old content literal and typesets only advertised Markdown without active HTML or remote images', () => {
  const text = '$a+b$\n\n<script>alert(1)</script>\n\n![图](https://example.invalid/a.png)';
  const { container, rerender } = render(<LessonContent text={text} />);
  expect(container.querySelector('.katex')).toBeNull();
  expect(container.textContent).toContain('<script>');
  rerender(<LessonContent text={text} format="markdown" />);
  expect(container.querySelector('.katex')).not.toBeNull();
  expect(container.querySelector('img, script')).toBeNull();
});

it('can collapse and reopen even a short problem', () => {
  render(<ProblemCard text="短题面" />);
  const button = screen.getByRole('button', { name: '收起题目' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(button);
  expect(button).toHaveAccessibleName('展开题目');
  expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeVisible();
  fireEvent.click(button);
  expect(screen.getByText('短题面')).toBeVisible();
});

it.each([
  ['编号', () => screen.getByRole('button', { name: '第（2）问' })],
  ['正文', () => screen.getByText('第二小题')],
])('pins the selected part when clicking %s and restores the other parts on request', (_, target) => {
  function SelectableProblem() {
    const [active, setActive] = useState<number>();
    return <ProblemCard text="共用题干" parts={{ statement: '共用题干', parts: [
      { number: 1, text: '第一小题' }, { number: 2, text: '第二小题' },
    ] }} active={active} onSelect={setActive} />;
  }
  render(<SelectableProblem />);
  fireEvent.click(target());
  expect(screen.getByText('共用题干')).toBeVisible();
  expect(screen.getByText('第二小题')).toBeVisible();
  expect(screen.queryByText('第一小题')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '第（2）问' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '收起题目' }));
  fireEvent.click(screen.getByRole('button', { name: '展开题目' }));
  expect(screen.queryByText('第一小题')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看全部小题' }));
  expect(screen.getByText('第一小题')).toBeVisible();
  expect(screen.getByRole('button', { name: '第（2）问' })).toHaveFocus();
});
