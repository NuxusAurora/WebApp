// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { useState } from 'react';
import { LessonContent, ProblemCard } from '../components/lesson-reading';

afterEach(cleanup);

it('uses the same KaTeX package for the renderer and its CSS', () => {
  const require = createRequire(import.meta.url);
  const rendererRequire = createRequire(require.resolve('rehype-katex'));

  expect(rendererRequire.resolve('katex/package.json')).toBe(require.resolve('katex/package.json'));
});

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

it('typesets inline math and matrices in both the common statement and numbered parts', () => {
  const statement = String.raw`已知矩阵 $A=(a_{ij})$：

$$
A=\begin{bmatrix}2 & -1 \\ 5 & 3\end{bmatrix}
$$`;
  const parts = [
    { number: 1, text: String.raw`求 $a_{21}$ 和 $\det(A)$。` },
    { number: 2, text: String.raw`已知

$$
B=\begin{pmatrix}1 & 0 \\ 0 & 2\end{pmatrix}
$$

求 $b_{22}$。` },
  ];
  const { container } = render(<ProblemCard text={statement} format="markdown" parts={{ statement, parts }} onSelect={() => {}} />);
  const body = screen.getByRole('region', { name: '题面' });
  const stem = body.querySelector(':scope > .lesson-rich');
  const [first, second] = body.querySelectorAll('.lesson-problem-part');

  expect(stem?.querySelector('msub')).toHaveTextContent('aij');
  expect(stem?.querySelectorAll('.katex-display mtr')).toHaveLength(2);
  expect(first?.querySelector('msub')).toHaveTextContent('a21');
  expect(first?.querySelectorAll('.katex')).toHaveLength(2);
  expect(second?.querySelector('msub')).toHaveTextContent('b22');
  expect(second?.querySelectorAll('.katex-display mtd')).toHaveLength(4);
  expect(container.querySelector('.katex-error')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  expect(screen.getByText('第一小题')).toBeVisible();
  expect(screen.getByRole('button', { name: '第（2）问' })).toHaveFocus();
});
