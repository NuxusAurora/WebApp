// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LessonContent, ProblemCard } from '../components/lesson-reading';

afterEach(cleanup);

it('keeps old content literal and typesets only advertised Markdown without active HTML or remote images', () => {
  const text = '$a+b$\n\n<script>alert(1)</script>\n\n![图](https://example.invalid/a.png)';
  const { container, rerender } = render(<LessonContent text={text} />);
  expect(container.querySelector('.katex')).toBeNull();
  expect(container.textContent).toContain('<script>');
  rerender(<LessonContent text={text} format="markdown" />);
  expect(container.querySelector('.katex')).not.toBeNull();
  expect(container.querySelector('img, script')).toBeNull();
});

it('opens long questions by default and lets the student collapse them', () => {
  render(<ProblemCard text={'长题面'.repeat(100)} />);
  const button = screen.getByRole('button', { name: '收起题目' });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(button);
  expect(button).toHaveAccessibleName('展开题目');
  expect(document.getElementById('lesson-problem-text')).not.toBeVisible();
});
