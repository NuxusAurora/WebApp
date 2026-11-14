// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workspace } from '../components/workspace';
import { api } from '../lib/api';
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
  sidebarDOM();
  history.replaceState({}, '', firstHref);
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === 'users/me') return { id: 'student', display_name: '学生', email: 'student@example.com' };
    if (path === 'learning/projects/textbooks') return { items: [{ id: 'course', title: '线性代数教材' }], next_cursor: null };
    if (path === 'learning/projects/textbooks/course') return { chapters };
    if (path === 'courses/course/curriculum') return { curriculum: { chapters } };
    if (path === 'learning/projects') return project(JSON.parse(String(init?.body)).knowledge_point_id);
    if (path === 'learning/projects/' + projectId + '/open') return project(firstId);
    if (path === 'learning/conversations/' + firstId + '/lesson') {
      return { revision: 4, problem: '已有题目', step: { index: 2, title: '已有步骤', content: '继续阅读', final: true } };
    }
    if (path === 'learning/conversations/' + secondId + '/lesson') return { revision: 0 };
    throw new Error('Unexpected request: ' + path);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState({}, '', '/'); });

it('reads the deep link, shows real context and searches the loaded outline without rewriting navigation', async () => {
  render(<Workspace />);
  const heading = await screen.findByRole('heading', { name: '行列式定义' });
  expect(heading).toHaveFocus();
  expect(await screen.findByText('最后一步', { selector: '.lesson-context-status' })).toBeVisible();
  const path = screen.getByRole('navigation', { name: '面包屑' });
  for (const label of ['高等数学', '行列式', '基本概念']) expect(await within(path).findByText(label)).toBeVisible();
  const selected = await screen.findByRole('link', { name: /行列式定义/ });
  expect(selected).toHaveAttribute('aria-current', 'page');
  expect(selected).toHaveAttribute('href', firstHref);
  const search = screen.getByRole('searchbox', { name: '搜索已加载的学习目录' });
  fireEvent.change(search, { target: { value: '逆序' } });
  const results = screen.getByRole('list', { name: '目录搜索结果' });
  expect(within(results).queryByRole('link', { name: /行列式定义/ })).not.toBeInTheDocument();
  fireEvent.click(within(results).getByRole('link', { name: '排列与逆序数' }));
  expect(await screen.findByRole('heading', { name: '排列与逆序数' })).toBeVisible();
  expect(location.pathname + location.search).toBe(secondHref);
  expect(await screen.findByText('未开始', { selector: '.lesson-context-status' })).toBeVisible();
  await act(async () => {
    const navigated = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    history.back();
    await navigated;
  });
  expect(await screen.findByRole('heading', { name: '行列式定义' })).toBeVisible();
  expect(await screen.findByText('已有题目')).toBeVisible();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByRole('link', { name: /行列式定义/ })).toHaveAttribute('aria-current', 'page');
});

it('restores the saved conversation from the legacy project URL without rewriting it', async () => {
  history.replaceState({}, '', '/?view=learning&project=' + projectId);
  render(<Workspace />);
  expect(await screen.findByText('已有题目')).toBeVisible();
  expect(await screen.findByRole('link', { name: /行列式定义/ })).toHaveAttribute('aria-current', 'page');
  expect(location.search).toBe('?view=learning&project=' + projectId);
});
