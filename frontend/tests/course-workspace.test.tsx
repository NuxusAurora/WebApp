// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sidebarDOM } from './sidebar-test-dom';
import { CourseSpace } from '../components/course-space';
import { WorkspaceOperations } from '../lib/workspace-operations';
import { Account } from '../components/account';
import { Workspace } from '../components/workspace';
import { CourseEditor } from '../components/course-editor';
import { Toast, useToast } from '../components/toast';
import { Profile } from '../components/profile';
import { ArchivedCourses } from '../components/archived-courses';
import { api, ApiError } from '../lib/api';
import type { Course } from '../lib/course-types';

vi.mock('../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/api')>(), api: vi.fn(),
}));

const courses: Course[] = [
  { id: 'course-a', title: '高等数学', subject: '数学', textbook: '高等数学（上册）', learning_goal: '理解极限', status: 'active' },
  { id: 'course-b', title: '大学物理', subject: '物理', textbook: '大学物理学', learning_goal: '', status: 'archived' },
];

beforeEach(() => {
  history.replaceState({}, '', '/'); localStorage.clear(); sidebarDOM();
  vi.mocked(api).mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.mocked(api).mockImplementation(async path => {
    if (path === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
    if (path.startsWith('courses?')) return courses;
    if (path.endsWith('/uploads')) return [];
    throw new Error('Unexpected request');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function ready() {
  render(<Workspace />);
  await expandSubject();
  fireEvent.click(await screen.findByRole('button', { name: '进入高等数学' }));
  await screen.findByRole('heading', { name: '高等数学' });
}

async function expandSubject(name = '数学') {
  const toggle = await screen.findByRole('button', { name: new RegExp('^' + name + ' \\d+ 门$') });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

describe('textbooks in learning navigation', () => {
  it('shows the directory note and badges from the course list before the sidebar opens', async () => {
    vi.mocked(api).mockResolvedValue([{ ...courses[0], added_to_learning: true }]);
    render(<CourseSpace />);
    await expandSubject();
    const row = (await screen.findByRole('button', { name: '进入高等数学' })).closest<HTMLElement>('.course-row')!;
    expect(screen.getByText('已添加到对话的课程可在左侧「学习对话」中查看。')).toBeVisible();
    expect(within(row).getByText('已添加')).toBeVisible();
    expect(vi.mocked(api).mock.calls.map(([request]) => request)).toEqual(['courses?offset=0']);
  });

  it('adds multiple courses, retries a failed removal, and lets the same course be added again', async () => {
    const activeCourses = [courses[0], { ...courses[1], status: 'active' as const }];
    const entries = new Map<string, string>();
    let failRemoval = true;
    const path = 'learning/projects/textbooks';
    vi.mocked(api).mockImplementation(async (request, options) => {
      if (request === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
      if (request.startsWith('courses?')) return activeCourses;
      if (request === path) return { items: [...entries].map(([id, title]) => ({ id, title })), next_cursor: null };
      const course = activeCourses.find(course => request === path + '/' + course.id);
      if (!course) throw new Error('Unexpected request: ' + request);
      if (options?.method === 'PUT') entries.set(course.id, course.textbook);
      if (options?.method === 'DELETE') {
        if (failRemoval) throw new ApiError(500, '移除失败，请重试');
        entries.delete(course.id);
      }
      return null;
    });

    render(<Workspace />);
    await expandSubject();
    await expandSubject('物理');
    const addMath = screen.getByRole('button', { name: '添加到对话：高等数学' });
    const mathRow = within(addMath.closest<HTMLElement>('.course-row')!);
    expect(mathRow.queryByText('已添加')).not.toBeInTheDocument();
    expect(addMath.parentElement).toContainElement(screen.getByRole('button', { name: '删除课程：高等数学' }));
    fireEvent.click(addMath);
    const removeMath = await screen.findByRole('button', { name: '从学习对话移除：高等数学（上册）' });
    expect(mathRow.getByText('已添加')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '添加到对话：大学物理' }));
    const removePhysics = await screen.findByRole('button', { name: '从学习对话移除：大学物理学' });

    fireEvent.click(removeMath);
    expect(await screen.findByRole('alert')).toHaveTextContent('移除失败，请重试');
    expect(removeMath).toBeVisible();
    expect(mathRow.getByText('已添加')).toBeVisible();
    failRemoval = false;
    fireEvent.click(removeMath);
    await waitFor(() => expect(removeMath).not.toBeInTheDocument());
    expect(mathRow.queryByText('已添加')).not.toBeInTheDocument();
    expect(removePhysics).toBeVisible();
    expect(screen.getByRole('button', { name: '进入高等数学' })).toBeVisible();
    fireEvent.click(addMath);
    expect(await screen.findByRole('button', { name: '从学习对话移除：高等数学（上册）' })).toBeVisible();
    expect(mathRow.getByText('已添加')).toBeVisible();
    expect(location.pathname + location.search).toBe('/');
    expect(vi.mocked(api).mock.calls.some(([request]) => request.startsWith('courses/'))).toBe(false);
  });
});

describe('subject course groups', () => {
  const grouped: Course[] = [courses[0],
    { ...courses[0], id: 'math-2', title: '线性代数', subject: ' 数学 ' },
    { ...courses[1], status: 'active' },
    { ...courses[0], id: 'other', title: '阅读课程', subject: '  ' },
  ];

  beforeEach(() => { vi.mocked(api).mockResolvedValue(grouped); });

  it('starts collapsed, groups by trimmed subject, and toggles groups independently without requests', async () => {
    render(<CourseSpace />);
    const math = await screen.findByRole('button', { name: '数学 2 门' });
    const physics = screen.getByRole('button', { name: '物理 1 门' });
    expect(math).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '进入高等数学' })).not.toBeInTheDocument();
    const calls = vi.mocked(api).mock.calls.length;
    fireEvent.click(math);
    expect(math).toHaveAttribute('aria-current', 'true');
    expect(document.getElementById(math.getAttribute('aria-controls')!)).toBeVisible();
    expect(screen.getByRole('button', { name: '进入线性代数' })).toBeVisible();
    fireEvent.click(physics);
    expect(physics).toHaveAttribute('aria-current', 'true');
    expect(math).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '进入大学物理' })).toBeVisible();
    fireEvent.click(math);
    expect(screen.queryByRole('button', { name: '进入线性代数' })).not.toBeInTheDocument();
    expect(math).toHaveAttribute('aria-current', 'true');
    expect(physics).not.toHaveAttribute('aria-current');
    expect(physics).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '未设置学科 1 门' }));
    expect(screen.getByRole('button', { name: '进入阅读课程' })).toBeVisible();
    expect(api).toHaveBeenCalledTimes(calls);
  });

  it('reveals search matches, allows collapsing results, and resets disclosure when clearing search', async () => {
    render(<CourseSpace />);
    await screen.findByRole('button', { name: '数学 2 门' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '线性' } });
    const math = screen.getByRole('button', { name: '数学 1 门' });
    expect(math).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '进入线性代数' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '物理 1 门' })).not.toBeInTheDocument();
    fireEvent.click(math);
    expect(math).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '清空课程搜索' }));
    expect(screen.getByRole('button', { name: '数学 2 门' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '数学 2 门' })).not.toHaveAttribute('aria-current');
  });

  it('preserves the expanded group and restores the course entry focus on return', async () => {
    const breadcrumbs = vi.fn();
    render(<CourseSpace onBreadcrumbChange={breadcrumbs} />);
    await expandSubject();
    const title = screen.getByRole('button', { name: '进入线性代数' });
    expect(title).toHaveTextContent(/^线性代数$/);
    expect(title.closest('.course-row')).toHaveTextContent('高等数学（上册）');
    expect(screen.queryByText('进入', { exact: true })).not.toBeInTheDocument();
    expect(document.querySelector('.subject-toggle svg:not(:last-child), .course-title-button svg')).toBeNull();
    fireEvent.click(title);
    expect(screen.getByRole('heading', { name: '线性代数' })).toBeInTheDocument();
    const items = breadcrumbs.mock.lastCall![0];
    act(() => items[0].onSelect());
    expect(screen.getByRole('button', { name: '数学 2 门' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '数学 2 门' })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: '进入线性代数' })).toHaveFocus());
  });
});

describe('desktop course workspace', () => {
  it('opens deletion from the list without navigating and returns focus on cancellation', async () => {
    render(<CourseSpace />);
    await expandSubject();
    const remove = screen.getByRole('button', { name: '删除课程：高等数学' });
    fireEvent.click(remove);
    expect(screen.getByRole('alertdialog', { name: '删除“高等数学”？' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '高等数学' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '进入高等数学' }));
    expect(screen.queryByRole('button', { name: /删除课程/ })).not.toBeInTheDocument();
  });

  it('deletes only the confirmed list row and keeps the other course', async () => {
    let rows = [courses[0], { ...courses[0], id: 'math-2', title: '线性代数' }];
    let finish!: () => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (init?.method === 'DELETE') {
        await new Promise<void>(resolve => { finish = resolve; });
        rows = rows.filter(course => path !== 'courses/' + course.id);
        return null;
      }
      if (path.startsWith('courses?')) return rows;
      throw new Error('Unexpected request');
    });
    render(<CourseSpace />);
    await expandSubject();
    fireEvent.click(screen.getByRole('button', { name: '删除课程：线性代数' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('button', { name: '删除中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除课程：高等数学' })).toBeDisabled();
    expect(screen.getByRole('searchbox')).toBeDisabled();
    await act(async () => finish());
    await screen.findByRole('button', { name: '进入高等数学' });
    expect(screen.queryByRole('button', { name: '进入线性代数' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数学 1 门' })).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([
      ['courses/math-2', { method: 'DELETE' }],
    ]);
  });

  it('clears a pending row confirmation when search or collapsing hides it', async () => {
    render(<CourseSpace />);
    await expandSubject();
    fireEvent.click(screen.getByRole('button', { name: '删除课程：高等数学' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '数学' } });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除课程：高等数学' }));
    fireEvent.click(screen.getByRole('button', { name: '数学 1 门' }));
    fireEvent.click(screen.getByRole('button', { name: '数学 1 门' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('protects model subpage edits and preserves the selected connection across navigation', async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === 'ai/providers') return [{ id: 'provider', provider_name: '导航连接', enabled: true, has_api_key: false, base_url: 'http://localhost:1234/v1', models: [] }];
      if (path === 'ai/options') return { allowed_origins: [] };
      if (path.includes('discovery') || path.startsWith('ai/logs')) return [];
      return original(path, options);
    });
    history.replaceState({}, '', '/?view=ai');
    render(<Workspace />);
    await screen.findByLabelText('接口地址');
    expect(screen.queryByRole('group', { name: '模型设置分类' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
    expect(screen.getByRole('button', { name: '模型设置' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: '模型与测试' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('接口地址')).toHaveValue('http://localhost:11434/v1');
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(location.search).toBe('?view=ai');
    expect(screen.getByLabelText('接口地址')).toHaveValue('http://localhost:11434/v1');
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    await screen.findByLabelText('选择模型');
    expect(screen.queryByLabelText('本地连接')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '模型与测试' })).toHaveAttribute('aria-current', 'page');
    history.replaceState({ workspaceIndex: 0 }, '', '/?view=ai');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.queryByLabelText('本地连接')).not.toBeInTheDocument();
    expect(screen.getByLabelText('接口地址')).toHaveValue('http://localhost:1234/v1');
  });
  it('keeps the connection page mounted until an in-flight selection settles', async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    let stored: object[] = [];
    let finish!: () => void;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === 'ai/providers') return options?.method === 'POST' ? new Promise(resolve => { finish = () => { const custom = { id: 'saved', provider_kind: 'custom', provider_name: '自定义连接', base_url: '', enabled: true, has_api_key: false, models: [] }; stored = [custom]; resolve(custom); }; }) : stored;
      return original(path, options);
    });
    history.replaceState({}, '', '/?view=ai');
    render(<Workspace />);
    fireEvent.click(await screen.findByRole('button', { name: '选择自定义连接' }));
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    expect(location.search).toBe('?view=ai');
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await screen.findByRole('button', { name: '自定义连接已启用' });
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    expect(location.search).toBe('?view=ai&tab=models');
    expect(screen.getByRole('heading', { name: '先填写自定义连接' })).toBeInTheDocument();
  });
  it('navigates each course breadcrumb level and protects unsaved changes', async () => {
    await ready();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '尚未保存的课程' } });
    fireEvent.click(screen.getByRole('button', { name: '高等数学' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('尚未保存的课程');
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '高等数学' }));
    expect(screen.queryByLabelText(/课程名称/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '高等数学' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    expect(screen.getByRole('region', { name: '学习中的课程' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建课程' }));
    expect(screen.queryByRole('button', { name: '返回我的课程' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    expect(screen.queryByLabelText(/课程名称/)).not.toBeInTheDocument();
  });
  it('preserves all form values after a failed create and retries the same API contract', async () => {
    render(<CourseSpace />);
    fireEvent.click(await screen.findByRole('button', { name: '新建课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '数值分析' } });
    fireEvent.change(screen.getByLabelText('学科'), { target: { value: '数学' } });
    expect(screen.queryByLabelText('教材')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('学习目标'), { target: { value: '大师之境' } });
    vi.mocked(api).mockRejectedValueOnce(new Error('保存失败，请重试'));
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('数值分析');
    expect(screen.getByLabelText('学习目标')).toHaveValue('大师之境');
    vi.mocked(api).mockResolvedValueOnce({ ...courses[0], id: 'new-course', title: '数值分析', learning_goal: '大师之境' });
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    await screen.findByRole('heading', { name: '数值分析' });
    const writes = vi.mocked(api).mock.calls.filter(([path, init]) => path === 'courses' && init?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1][1]!.body as string)).toEqual({ title: '数值分析', subject: '数学', textbook: '', learning_goal: '大师之境' });
  });
  it('keeps curriculum edits protected when the current tab is clicked again', async () => {
    vi.mocked(api).mockImplementation(async path => {
      if (path.startsWith('courses?')) return courses;
      if (path.endsWith('/curriculum')) return { confirmed_revision: 1,
        curriculum: { chapters: [{ id: 'chapter', title: '函数与极限', sections: [] }] }, versions: [] };
      if (path.endsWith('/uploads') || path.endsWith('/images') || path === 'ai/providers') return [];
      throw new Error('Unexpected request');
    });
    const dirty = vi.fn();
    render(<CourseSpace onDirtyChange={dirty} />, { wrapper: WorkspaceOperations });
    await expandSubject();
    fireEvent.click(await screen.findByRole('button', { name: '进入高等数学' }));
    await screen.findByRole('heading', { name: '高等数学' });
    fireEvent.click(screen.getByRole('tab', { name: '目录与小节' }));
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^章节 1 / }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    fireEvent.change(screen.getByLabelText('章节 1标题'), { target: { value: '未保存的目录' } });
    fireEvent.click(screen.getByRole('tab', { name: '目录与小节' }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('tab', { name: /课程概览/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('章节 1标题')).toHaveValue('未保存的目录');
  });
  it('shows only active courses in one container and opens detail explicitly', async () => {
    render(<Workspace />);
    await expandSubject();
    const enter = await screen.findByRole('button', { name: '进入高等数学' });
    expect(screen.queryByRole('heading', { name: '高等数学' })).not.toBeInTheDocument();
    expect(screen.queryByText('大学物理')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('当前页课程状态')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /我的课程|课程目录/ })).not.toBeInTheDocument();
    const list = screen.getByRole('region', { name: '学习中的课程' });
    expect(list).toContainElement(screen.getByRole('searchbox'));
    expect(list).toContainElement(screen.getByRole('button', { name: '新建课程' }));
    fireEvent.click(enter);
    expect(screen.getByRole('heading', { name: '高等数学' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '学习中的课程' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页课程' }), { target: { value: '上册' } });
    expect(screen.getByRole('button', { name: '进入高等数学' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '进入大学物理' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } });
    expect(screen.getByRole('heading', { name: '没有找到匹配的课程' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /大学物理/ })).not.toBeInTheDocument();
  });

  it('protects an unsaved editor and sends only the existing course fields on save', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    fireEvent.click(screen.getByRole('button', { name: '新建课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '概率论' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('概率论');
    const created = { ...courses[0], id: 'course-new', title: '概率论', subject: '', textbook: '', learning_goal: '多学一点' };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === 'courses' && init?.method === 'POST') return created;
      if (path.endsWith('/uploads')) return [];
      return courses;
    });
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    await screen.findByRole('heading', { name: '概率论' });
    expect(screen.getByRole('status')).toHaveTextContent('课程已保存');
    const call = vi.mocked(api).mock.calls.find(([path, init]) => path === 'courses' && init?.method === 'POST')!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ title: '概率论', subject: '', textbook: '', learning_goal: '多学一点' });
    expect(screen.queryByLabelText(/课程名称/)).not.toBeInTheDocument();
  });

  it('retries a course loading failure without inventing an empty success state', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('课程服务暂时不可用'));
    render(<CourseSpace />);
    await screen.findByText('课程服务暂时不可用');
    expect(screen.queryByRole('heading', { name: '还没有课程' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载课程' }));
    await expandSubject();
    await screen.findByRole('button', { name: '进入高等数学' });
  });

  it('does not show or fetch learning materials when switching courses', async () => {
    await ready();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.queryByRole('tab', { name: /学习资料/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    fireEvent.click(screen.getByRole('button', { name: '进入高等数学' }));
    expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/uploads'))).toBe(false);
  });

  it('keeps the list course and confirmation available when deletion fails', async () => {
    render(<CourseSpace />);
    await expandSubject();
    vi.mocked(api).mockRejectedValueOnce(new Error('删除失败，请重试'));
    fireEvent.click(screen.getByRole('button', { name: '删除课程：高等数学' }));
    expect(screen.getByText(/永久删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await screen.findByText('删除失败，请重试');
    expect(screen.getByRole('button', { name: '进入高等数学' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled();
  });

  it('moves course detail tabs with the keyboard and preserves focus', async () => {
    await ready();
    const first = screen.getByRole('tab', { name: '课程概览' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const files = screen.getByRole('tab', { name: '目录与小节' });
    expect(files).toHaveAttribute('aria-selected', 'true');
    expect(files).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(files, { key: 'Home' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveFocus();
  });
  it('loads knowledge under the expanded section and protects unsaved edits when changing sections', async () => {
    const point = { title: '函数定义', description: '集合间的唯一对应', learning_objectives: ['解释定义'], mastery_criteria: ['判断函数'], importance: 'HIGH' };
    const draft = { id: 'draft', revision: 1, status: 'DRAFT', base_course_revision: 1, source: { kind: 'ai' },
      payload: { knowledge_points: [{ ...point, temp_id: 'p', existing_knowledge_point_id: null }] },
      change_summary: { added: [], modified: [], archived: [] } };
    const request = vi.mocked(api);
    let saved = false;
    request.mockImplementation(async path => {
      if (path === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
      if (path.startsWith('courses?')) return courses;
      if (path === 'ai/providers') return [{ id: 'provider', enabled: true, models: [{ id: 'model', enabled: true }] }];
      if (path.endsWith('/curriculum')) return { confirmed_revision: 1, versions: [], curriculum: {
        chapters: [{ id: 'chapter', title: '函数与极限', sections: [{ id: 's1', title: '函数' }, { id: 's2', title: '极限' }] }],
      } };
      if (path === 'sections/s1/knowledge-points/generate') { saved = true; return draft; }
      if (path === 'sections/s1/knowledge-points') return { confirmed_revision: 1, knowledge_points: [], draft: saved ? draft : null };
      if (path === 'sections/s2/knowledge-points') return { confirmed_revision: 1, draft: null, knowledge_points: [
        { ...point, id: 'existing', section_id: 's2', status: 'NOT_STARTED', title: '数列极限' },
      ] };
      throw new Error('Unexpected request');
    });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: '目录与小节' }));
    const chapter = await screen.findByRole('button', { name: '章节 1 函数与极限' });
    fireEvent.click(chapter);
    const first = screen.getByRole('button', { name: '小节 1.1 函数' });
    const second = screen.getByRole('button', { name: '小节 1.2 极限' });
    expect(request.mock.calls.some(([path]) => path.startsWith('sections/'))).toBe(false);
    fireEvent.click(first);
    const generate = await within(first.closest('li')!).findByRole('button', { name: '生成具体知识点' });
    expect(request.mock.calls.some(([path]) => path.endsWith('/generate'))).toBe(false);
    fireEvent.click(generate);
    fireEvent.change(await screen.findByLabelText('知识点 1名称'), { target: { value: '未保存的名称' } });
    fireEvent.click(second);
    fireEvent.click(chapter);
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByDisplayValue('未保存的名称')).toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path.startsWith('sections/s2/'))).toBe(false);
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    fireEvent.click(second);
    expect(await within(second.closest('li')!).findByRole('heading', { name: '数列极限' })).toBeVisible();
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('集合间的唯一对应')).not.toBeInTheDocument();
  });
  it('opens knowledge editing and regeneration from the confirmed section menu', async () => {
    const point = { id: 'point', section_id: 's1', title: '函数定义', description: '集合间的唯一对应',
      learning_objectives: ['解释定义'], mastery_criteria: ['判断函数'], importance: 'HIGH', status: 'NOT_STARTED' };
    const draft = { id: 'draft', revision: 1, status: 'DRAFT', base_course_revision: 1, source: { kind: 'ai' },
      payload: { knowledge_points: [{ ...point, temp_id: 'p', existing_knowledge_point_id: 'point' }] },
      change_summary: { added: [], modified: [], archived: [] } };
    const request = vi.mocked(api);
    let saved = false;
    request.mockImplementation(async path => {
      if (path === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
      if (path.startsWith('courses?')) return courses;
      if (path === 'ai/providers') return [{ id: 'provider', enabled: true, models: [{ id: 'model', enabled: true }] }];
      if (path.endsWith('/curriculum')) return { confirmed_revision: 1, versions: [], curriculum: {
        chapters: [{ id: 'chapter', title: '函数与极限', sections: [{ id: 's1', title: '函数' }] }],
      } };
      if (path === 'sections/s1/knowledge-points/generate') { saved = true; return draft; }
      if (path === 'sections/s1/knowledge-points') return { confirmed_revision: 1, knowledge_points: [point], draft: saved ? draft : null };
      throw new Error('Unexpected request');
    });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: '目录与小节' }));
    fireEvent.click(await screen.findByRole('button', { name: '章节 1 函数与极限' }));
    const more = screen.getByRole('button', { name: '小节 1.1操作' });
    expect(screen.queryByRole('button', { name: /添加到对话栏/ })).not.toBeInTheDocument();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑知识点' }));
    expect(await screen.findByDisplayValue('函数定义')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成知识点' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑知识点' })).not.toBeInTheDocument();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: '重新生成知识点' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.some(([path]) => path.endsWith('/generate'))).toBe(false);
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: '重新生成知识点' }));
    await screen.findByText('知识草稿已生成');
    const generate = request.mock.calls.filter(([path]) => path.endsWith('/generate'));
    expect(generate).toHaveLength(1);
    expect(JSON.parse(String(generate[0][1]?.body))).toEqual({
      provider_id: 'provider', model_id: 'model', base_course_revision: 1,
    });
  });

  it('keeps one generation running when leaving the workspace page and reopening the section', async () => {
    const point = { temp_id: 'p', title: '函数定义', description: '集合间的唯一对应',
      learning_objectives: ['解释定义'], mastery_criteria: ['判断函数'], importance: 'HIGH' };
    const draft = { id: 'draft', revision: 1, status: 'DRAFT', base_course_revision: 1,
      payload: { knowledge_points: [point] }, change_summary: { added: [], modified: [], archived: [] } };
    let saved: typeof draft | null = null;
    const generation = Promise.withResolvers<void>();
    const request = vi.mocked(api);
    request.mockImplementation(async path => {
      if (path === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
      if (path.startsWith('courses?')) return courses;
      if (path === 'ai/providers') return [{ id: 'provider', enabled: true, models: [{ id: 'model', enabled: true }] }];
      if (path.endsWith('/curriculum')) return { confirmed_revision: 1, versions: [], curriculum: {
        chapters: [{ id: 'chapter', title: '函数与极限', sections: [{ id: 's1', title: '函数' }, { id: 's2', title: '极限' }] }],
      } };
      if (path === 'sections/s1/knowledge-points/generate') { await generation.promise; saved = draft; return draft; }
      if (path.startsWith('sections/')) return { confirmed_revision: 1, knowledge_points: [], draft: path.includes('/s1/') ? saved : null };
      return [];
    });
    async function openSection(name: string) {
      fireEvent.click(screen.getByRole('tab', { name: '目录与小节' }));
      fireEvent.click(await screen.findByRole('button', { name: '章节 1 函数与极限' }));
      fireEvent.click(screen.getByRole('button', { name }));
      return screen.findByRole('button', { name: '生成具体知识点' });
    }
    await ready();
    fireEvent.click(await openSection('小节 1.1 函数'));
    await screen.findByText('正在生成知识点…');
    const signal = request.mock.calls.find(([path]) => path.endsWith('/generate'))?.[1]?.signal;
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: '账户设置' })); });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: '目录与小节' })).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: '我的课程' }));
    await expandSubject();
    fireEvent.click(await screen.findByRole('button', { name: '进入高等数学' }));
    expect(await openSection('小节 1.2 极限')).toBeEnabled();
    expect(screen.queryByText('正在生成知识点…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '小节 1.1 函数' }));
    expect(await screen.findByRole('button', { name: '生成具体知识点' })).toBeDisabled();
    await screen.findByText('正在生成知识点…');
    await act(async () => generation.resolve());
    expect(await screen.findByDisplayValue('函数定义')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认无误' })).toBeEnabled();
    expect(request.mock.calls.filter(([path]) => path.endsWith('/generate'))).toHaveLength(1);
    expect(request.mock.calls.some(([path]) => path.endsWith('/confirm'))).toBe(false);
  });
});

describe('archived courses in settings', () => {
  it('returns an archived course to settings instead of keeping its detail open', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '编辑课程' }));
    fireEvent.change(screen.getByLabelText('课程状态'), { target: { value: 'archived' } });
    vi.mocked(api).mockResolvedValueOnce({ ...courses[0], status: 'archived' });
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    await screen.findByText('课程已归档，可在账户设置中恢复学习');
    expect(screen.getByRole('region', { name: '学习中的课程' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '进入高等数学' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '高等数学' })).not.toBeInTheDocument();
  });

  it('retries a failed archive query without showing an empty success', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('读取失败'));
    render(<ArchivedCourses />);
    fireEvent.click(screen.getByRole('button', { name: '归档资料' }));
    await screen.findByText('读取失败');
    expect(screen.queryByText('暂无归档资料')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByRole('button', { name: '恢复学习：大学物理' });
  });

  it('loads archives only on demand and restores through the existing status API', async () => {
    render(<ArchivedCourses />);
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '归档资料' }));
    const restore = await screen.findByRole('button', { name: '恢复学习：大学物理' });
    expect(screen.queryByText('高等数学')).not.toBeInTheDocument();
    vi.mocked(api).mockResolvedValueOnce({ ...courses[1], status: 'active' });
    fireEvent.click(restore);
    await screen.findByText('已恢复学习');
    expect(api).toHaveBeenCalledWith('courses/course-b', expect.objectContaining({ method: 'PATCH', body: '{"status":"active"}' }));
    expect(screen.queryByRole('button', { name: '恢复学习：大学物理' })).not.toBeInTheDocument();
  });

  it('keeps an archive available after a failed restore and retries it', async () => {
    render(<ArchivedCourses />);
    fireEvent.click(screen.getByRole('button', { name: '归档资料' }));
    const restore = await screen.findByRole('button', { name: '恢复学习：大学物理' });
    vi.mocked(api).mockRejectedValueOnce(new Error('恢复失败，请重试'));
    fireEvent.click(restore);
    await screen.findByText('恢复失败，请重试');
    expect(restore).toBeEnabled();
    vi.mocked(api).mockResolvedValueOnce({ ...courses[1], status: 'active' });
    fireEvent.click(restore);
    await screen.findByText('已恢复学习');
  });

  it('aborts loading and ignores late results after leaving settings', async () => {
    let finish!: (value: Course[]) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ArchivedCourses />);
    fireEvent.click(screen.getByRole('button', { name: '归档资料' }));
    const signal = vi.mocked(api).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(courses));
    expect(screen.queryByText('大学物理')).not.toBeInTheDocument();
  });

  it('shows a restored course on returning from account settings', async () => {
    let restored = false;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === 'users/me') return { id: 'user', display_name: '学生', email: 'student@example.com' };
      if (init?.method === 'PATCH') { restored = true; return { ...courses[1], status: 'active' }; }
      if (path.startsWith('courses?')) return courses.map(course => restored ? { ...course, status: 'active' } : course);
      return [];
    });
    render(<Workspace />);
    await expandSubject();
    await screen.findByRole('button', { name: '进入高等数学' });
    expect(screen.queryByText('大学物理')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '账户设置' }));
    fireEvent.click(screen.getByRole('button', { name: '归档资料' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复学习：大学物理' }));
    await screen.findByText('已恢复学习');
    fireEvent.click(screen.getByRole('link', { name: '我的课程' }));
    await expandSubject('物理');
    await screen.findByRole('button', { name: '进入大学物理' });
  });
});

describe('account and shell states', () => {
  it('restores URL selection and preserves the session and menu after a failed logout', async () => {
    history.replaceState({}, '', '/?view=profile');
    vi.mocked(api).mockImplementation(async path => {
      if (path === 'users/me') return { id: 'user-a', display_name: '学生', email: 'student@example.com' };
      if (path === 'auth/logout') throw new Error('退出失败，请重试');
      return [];
    });
    render(<Workspace />);
    await screen.findByRole('button', { name: '修改昵称' });
    expect(screen.getByRole('link', { name: '账户设置' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.workspace-user')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '账户菜单，学生' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('退出失败，请重试');
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '修改昵称' })).toBeInTheDocument();
  });
  it('keeps the existing public connection page available for a signed-out visitor', async () => {
    history.replaceState({}, '', '/system');
    vi.mocked(api).mockRejectedValue(new ApiError(401, '请登录'));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
    render(<Workspace systemView />);
    expect(await screen.findByRole('region', { name: '服务连接' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '连接状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '连接状态' })).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('link', { name: '登录工作台' });
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  });
  it('shows deployment account availability after resolving a signed-out session', async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError(401, '请登录'));
    render(<Workspace accountNotice="邮件服务待配置，注册和找回密码暂不可用。" />);
    expect(await screen.findByText('邮件服务待配置，注册和找回密码暂不可用。')).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
  });
  it('continues password recovery into the reset form after requesting a code', async () => {
    vi.mocked(api).mockResolvedValue({ message: '重置邮件已发送' });
    render(<Account onLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }));
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'student@example.com' } });
    fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
    await screen.findByRole('heading', { name: '重置密码' });
    expect(screen.getByLabelText('邮件验证码')).toBeInTheDocument();
    expect(screen.getByLabelText('密码', { exact: true })).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls[0][0]).toBe('auth/forgot-password');
  });

  it('lets an unverified account request another code and return to verification', async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError(403, '请先验证邮箱'))
      .mockResolvedValue({ message: '验证邮件已发送' });
    render(<Account onLogin={vi.fn()} />);
    fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
    await screen.findByRole('heading', { name: '验证邮箱' });
    fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' }));
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'student@example.com' } });
    fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
    await screen.findByRole('heading', { name: '验证邮箱' });
    expect(screen.getByLabelText('邮件验证码')).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(['auth/login', 'auth/resend-verification']);
  });

  it('requires confirmation before returning from an unsaved compact editor to the directory', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    fireEvent.click(screen.getByRole('button', { name: '新建课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '尚未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('尚未保存');
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    expect(screen.queryByLabelText(/课程名称/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学习中的课程' }).closest('.course-space')).not.toHaveClass('showing-detail');
  });

  it('preserves the dirty guard when the active navigation item is clicked again', async () => {
    vi.mocked(api).mockImplementation(async path => path === 'users/me' ?
      { id: 'user-a', display_name: '学生', email: 'student@example.com' } :
      path.startsWith('courses?') ? courses : []);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Workspace />);
    await expandSubject();
    fireEvent.click(await screen.findByRole('button', { name: '进入高等数学' }));
    await screen.findByRole('heading', { name: '高等数学' });
    fireEvent.click(screen.getByRole('button', { name: '编辑课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '未保存的课程' } });
    fireEvent.click(screen.getByRole('link', { name: '我的课程' }));
    fireEvent.click(screen.getByRole('link', { name: '账户设置' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('未保存的课程');
    fireEvent.click(screen.getByRole('link', { name: '连接状态' }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('uses the existing registration contract and reaches the email verification form', async () => {
    vi.mocked(api).mockResolvedValue({ message: '验证邮件已发送' });
    render(<Account onLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'student@example.com' } });
    fireEvent.change(screen.getByLabelText('称呼'), { target: { value: '学生' } });
    fireEvent.change(screen.getByLabelText('密码', { exact: true }), { target: { value: 'example-password' } });
    fireEvent.submit(screen.getByLabelText('邮箱').closest('form')!);
    await screen.findByLabelText('邮件验证码');
    expect(vi.mocked(api).mock.calls[0][0]).toBe('auth/register');
    expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string)).toEqual({
      email: 'student@example.com', display_name: '学生', password: 'example-password',
    });
  });

  it('distinguishes a disconnected service from a signed-out account', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('无法连接服务'));
    render(<Workspace />);
    await screen.findByRole('heading', { name: '暂时无法连接' });
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
    vi.mocked(api).mockImplementation(async path => path === 'users/me' ?
      { id: 'user-a', display_name: '学生', email: 'student@example.com' } :
      path.startsWith('courses?') ? courses : []);
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    await screen.findByRole('navigation', { name: '主导航' });
  });
});

describe('learning goal choices', () => {
  it('offers the three requested goals and saves the chosen goal without claiming AI is connected', () => {
    const save = vi.fn();
    render(<CourseEditor course={null} busy={false} onSave={save} onCancel={vi.fn()} onDirty={vi.fn()} />);
    const goal = screen.getByRole('combobox', { name: '学习目标' });
    expect(goal).toHaveValue('多学一点');
    expect(Array.from((goal as HTMLSelectElement).options).map(option => option.text)).toEqual(['及格就好', '多学一点', '大师之境']);
    fireEvent.change(goal, { target: { value: '大师之境' } });
    expect(screen.getByText('深入推导与综合应用，探索高阶问题。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '高等数学' } });
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ learning_goal: '大师之境' }));
  });

  it('preserves an older custom goal until the user actively replaces it', () => {
    const save = vi.fn();
    render(<CourseEditor course={courses[0]} busy={false} onSave={save} onCancel={vi.fn()} onDirty={vi.fn()} />);
    const goal = screen.getByRole('combobox', { name: '学习目标' });
    expect(goal).toHaveValue('');
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    expect(save.mock.calls[0][0]).not.toHaveProperty('learning_goal');
    fireEvent.change(goal, { target: { value: '及格就好' } });
    fireEvent.submit(screen.getByRole('button', { name: '保存课程' }).closest('form')!);
    expect(save.mock.calls[1][0]).toHaveProperty('learning_goal', '及格就好');
  });
});

describe('success toast lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); });

  function SaveExample() {
    const { notification, notify, dismiss } = useToast();
    return <><button onClick={() => notify('课程已保存')}>保存</button>
      <Toast notification={notification} onDismiss={dismiss} /></>;
  }

  it('shows each successful save for three seconds, including repeated identical saves', () => {
    vi.useFakeTimers();
    render(<SaveExample />);
    const save = screen.getByRole('button', { name: '保存' });
    save.focus();
    fireEvent.click(save);
    expect(save).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('课程已保存');
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(save);
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.getByRole('status')).toHaveClass('is-dismissing');
    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not dispatch a stale dismissal after the surface unmounts', () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const view = render(<Toast notification={{ message: '资料已保存', id: 1 }} onDismiss={dismiss} />);
    view.unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('personal account overview', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
      value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
      value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  });
  const user = { id: 'profile-user', display_name: '学习者', email: 'student@example.com' };

  it('shows five unavailable statistics honestly and keeps email editing disabled', () => {
    render(<Profile user={user} onUpdate={vi.fn()} onPasswordChanged={vi.fn()} />);
    expect(screen.getAllByLabelText('暂无统计')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /修改邮箱/ })).toBeDisabled();
    expect(screen.getByText('学习统计待接入')).toBeInTheDocument();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
  });

  it('preserves an unsaved nickname, then uses the profile API and closes on success', async () => {
    const updated = { ...user, display_name: '新昵称' };
    const update = vi.fn();
    vi.mocked(api).mockResolvedValue(updated);
    render(<Profile user={user} onUpdate={update} onPasswordChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '修改昵称' }));
    expect(screen.getByLabelText('昵称')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新昵称' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('昵称')).toHaveValue('新昵称');
    fireEvent.submit(screen.getByLabelText('昵称').closest('form')!);
    await waitFor(() => expect(update).toHaveBeenCalledWith(updated));
    expect(api).toHaveBeenCalledWith('users/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ display_name: '新昵称' }) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('昵称已修改');
  });

  it('preserves password fields and recovery actions when the API fails', async () => {
    vi.mocked(api).mockRejectedValue(new Error('当前密码错误'));
    render(<Profile user={user} onUpdate={vi.fn()} onPasswordChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }));
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password-123' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password-123' } });
    fireEvent.submit(screen.getByLabelText('新密码').closest('form')!);
    await screen.findByText('当前密码错误');
    expect(screen.getByLabelText('新密码')).toHaveValue('new-password-123');
    expect(screen.getByRole('button', { name: '修改密码并退出' })).toBeEnabled();
  });

  it('logs into the dedicated test account by default without credentials', async () => {
    const login = vi.fn();
    render(<Account onLogin={login} />);
    vi.mocked(api).mockResolvedValue(user);
    fireEvent.click(screen.getByRole('button', { name: '测试登录' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith(user));
    expect(api).toHaveBeenCalledWith('auth/test-login', { method: 'POST' });
  });
});
