// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CourseEditor } from '../components/course-editor';

afterEach(cleanup);

it('keeps native required validation and exposes a readable field error', () => {
  const save = vi.fn();
  render(<CourseEditor course={null} busy={false} onSave={save} onCancel={vi.fn()} onDirty={vi.fn()} />);
  expect(screen.getByRole('heading', { level: 1, name: '新建课程' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '关闭课程编辑' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('教材')).not.toBeInTheDocument();
  expect(screen.getByLabelText('学习目标').closest('.field-pair')).toContainElement(screen.getByLabelText('学科'));
  fireEvent.click(screen.getByRole('button', { name: '保存课程' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('请输入课程名称。');
  expect(screen.getByLabelText(/课程名称/)).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '高等数学' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not overwrite the existing textbook when saving other course fields', () => {
  const save = vi.fn();
  render(<CourseEditor course={{ id: 'course', title: '高等数学', subject: '数学', textbook: '已有教材', learning_goal: '多学一点', status: 'active' }}
    busy={false} onSave={save} onCancel={vi.fn()} onDirty={vi.fn()} />);
  expect(screen.queryByLabelText('教材')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('学习目标'), { target: { value: '大师之境' } });
  fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
  expect(save).toHaveBeenCalledWith({ title: '高等数学', subject: '数学', learning_goal: '大师之境', status: 'active' });
});

it('locks fields and guards form submission while saving, then permits retry', () => {
  const save = vi.fn();
  const props = { course: null, busy: false, onSave: save, onCancel: vi.fn(), onDirty: vi.fn() };
  const { rerender } = render(<CourseEditor {...props} />);
  fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '概率论' } });
  rerender(<CourseEditor {...props} busy />);
  expect(screen.getByLabelText(/课程名称/)).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存中…' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('button', { name: '保存中…' }).closest('form')!);
  expect(save).not.toHaveBeenCalled();
  rerender(<CourseEditor {...props} />);
  expect(screen.getByLabelText(/课程名称/)).toHaveValue('概率论');
  fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
  expect(save).toHaveBeenCalledWith({ title: '概率论', subject: '', textbook: '', learning_goal: '多学一点' });
});
