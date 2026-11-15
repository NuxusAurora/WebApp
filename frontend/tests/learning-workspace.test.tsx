// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workspace } from '../components/workspace';
import { api } from '../lib/api';
import type { LessonTask } from '../lib/lesson-task';
import { sidebarDOM } from './sidebar-test-dom';

vi.mock('../lib/api', async load => ({ ...await load<typeof import('../lib/api')>(), api: vi.fn() }));

const sectionId = '00000000-0000-4000-8000-000000000001';
const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000004';
const firstHref = '/?view=learning&section=' + sectionId + '&point=' + firstId;
const secondHref = '/?view=learning&section=' + sectionId + '&point=' + secondId;
const points = [{ id: firstId, title: '行列式定义', studied: true }, { id: secondId, title: '排列与逆序数', studied: false }];
const chapters = [{ id: 'chapter', title: '行列式', sections: [{ id: sectionId, title: '基本概念', knowledge_points: points }] }];
function project(pointId: string) {
  return {
    id: projectId, course_id: 'course', course_title: '高等数学', textbook_title: '线性代数教材',
    chapter_id: 'chapter', section_id: sectionId, section_title: '基本概念', knowledge_points: points,
    conversation: { id: pointId, knowledge_point_id: pointId },
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sidebarDOM();
  history.replaceState({}, '', firstHref);
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === 'users/me') return { id: 'student', display_name: '学生', email: 'student@example.com' };
    if (path === 'learning/projects/textbooks') return { items: [{ id: 'course', title: '线性代数教材' }], next_cursor: null };
    if (path === 'learning/projects/textbooks/course') return { chapters };
    if (path === 'learning/projects') return project(JSON.parse(String(init?.body)).knowledge_point_id);
    if (path === 'learning/projects/' + projectId + '/open') return project(firstId);
    if (path === 'learning/conversations/' + firstId + '/lesson/task') {
      return { revision: 4, actions: ['start'], status: 'legacy', legacy: { revision: 4, problem: '已有题目',
        step: { index: 2, title: '已有步骤', content: '继续阅读', final: true } } };
    }
    if (path === 'learning/conversations/' + secondId + '/lesson/task') return { revision: 0, status: 'not_started', actions: ['start'] };
    throw new Error('Unexpected request: ' + path);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState({}, '', '/'); });

it('keeps the lesson header to its title and searches the loaded outline without rewriting navigation', async () => {
  render(<Workspace />);
  const heading = await screen.findByRole('heading', { name: '行列式定义' });
  expect(heading).toHaveFocus();
  expect(await screen.findByText('已有题目')).toBeVisible();
  expect(heading.closest('header')).toHaveTextContent(/^行列式定义$/);
  expect(screen.queryByRole('navigation', { name: '面包屑' })).not.toBeInTheDocument();
  const question = screen.getByRole('button', { name: '随时提问' });
  expect(question.closest('footer')).toContainElement(screen.getByRole('button', { name: '开始下一题' }));
  expect(question).toHaveAttribute('aria-expanded', 'false');
  expect(api).not.toHaveBeenCalledWith('courses/course/curriculum', expect.anything());
  const selected = await screen.findByRole('link', { name: /行列式定义/ });
  expect(selected).toHaveAttribute('aria-current', 'page');
  expect(selected).toHaveAttribute('href', firstHref);
  const searchToggle = screen.getByRole('button', { name: '搜索目录' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(searchToggle);
  const search = screen.getByRole('searchbox', { name: '搜索已加载的学习目录' });
  expect(search).toHaveFocus();
  expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(search, { target: { value: '逆序' } });
  const results = screen.getByRole('list', { name: '目录搜索结果' });
  expect(within(results).queryByRole('link', { name: /行列式定义/ })).not.toBeInTheDocument();
  fireEvent.click(within(results).getByRole('link', { name: '排列与逆序数' }));
  expect(await screen.findByRole('heading', { name: '排列与逆序数' })).toBeVisible();
  expect(location.pathname + location.search).toBe(secondHref);
  expect(await screen.findByRole('button', { name: '开始学习' })).toBeVisible();
  await act(async () => {
    const navigated = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    history.back();
    await navigated;
  });
  expect(await screen.findByRole('heading', { name: '行列式定义' })).toBeVisible();
  expect(await screen.findByText('已有题目')).toBeVisible();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(searchToggle).toHaveFocus();
  expect(screen.getByRole('link', { name: /行列式定义/ })).toHaveAttribute('aria-current', 'page');
});

it('restores the saved conversation from the legacy project URL without rewriting it', async () => {
  history.replaceState({}, '', '/?view=learning&project=' + projectId);
  render(<Workspace />);
  expect(await screen.findByText('已有题目')).toBeVisible();
  expect(screen.getByText('继续阅读')).toBeVisible();
  expect(await screen.findByRole('link', { name: /行列式定义/ })).toHaveAttribute('aria-current', 'page');
  expect(location.search).toBe('?view=learning&project=' + projectId);
});

it('shows each new question before its explanation and remembers the reveal in the same tab', async () => {
  history.replaceState({}, '', secondHref);
  const lessonPath = 'learning/conversations/' + secondId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  const commands: string[] = [];
  const firstQuestion: LessonTask = {
    revision: 1, status: 'final_step', actions: ['complete', 'hint'],
    question: { question_id: 'question-one', problem: '第一道题' },
    current_step: { step_id: 'step-one', index: 1, title: '第一步讲解', content: '第一道题的解法' },
  };
  let lesson: LessonTask = { revision: 0, status: 'not_started', actions: ['start'] };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    const command = JSON.parse(String(init.body)).action;
    commands.push(command);
    if (command === 'start') lesson = firstQuestion;
    else if (command === 'complete') lesson = { ...lesson, revision: 2, status: 'completed', actions: ['next-question'] };
    else if (command === 'next-question') lesson = { ...firstQuestion, revision: 3,
      question: { question_id: 'question-two', problem: '第二道题' },
      current_step: { step_id: 'step-two', index: 1, title: '第二题讲解', content: '第二道题的解法' } };
    return lesson;
  });

  const firstLoad = render(<Workspace />);
  fireEvent.click(await screen.findByRole('button', { name: '开始学习' }));
  expect(await screen.findByText('第一道题')).toBeVisible();
  expect(screen.queryByText('第一道题的解法')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '给我提示' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByText('第一道题的解法')).toBeVisible();
  expect(commands).toEqual(['start']);

  firstLoad.unmount();
  render(<Workspace />);
  expect(await screen.findByText('第一道题的解法')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '我理解了，完成本题' }));
  fireEvent.click(await screen.findByRole('button', { name: '开始下一题' }));
  expect(await screen.findByText('第二道题')).toBeVisible();
  expect(screen.queryByText('第二道题的解法')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始讲解' })).toBeVisible();
  expect(commands).toEqual(['start', 'complete', 'next-question']);
});
