// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseSpace } from '../components/course-space';
import { Account } from '../components/account';
import { Workspace } from '../components/workspace';
import { CourseEditor } from '../components/course-editor';
import { Toast, useToast } from '../components/toast';
import { Profile } from '../components/profile';
import { api } from '../lib/api';
import type { Course } from '../lib/course-types';

vi.mock('../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/api')>(), api: vi.fn(),
}));

const courses: Course[] = [
  { id: 'course-a', title: '高等数学', subject: '数学', textbook: '高等数学（上册）', learning_goal: '理解极限', status: 'active' },
  { id: 'course-b', title: '大学物理', subject: '物理', textbook: '大学物理学', learning_goal: '', status: 'archived' },
];

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.mocked(api).mockImplementation(async path => {
    if (path.startsWith('courses?')) return courses;
    if (path.endsWith('/uploads')) return [];
    throw new Error('Unexpected request');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function ready() {
  render(<CourseSpace />);
  await screen.findByRole('heading', { name: '高等数学' });
}

describe('desktop course workspace', () => {
  it('filters the current page by status and by course, subject or textbook', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /^已归档/ }));
    expect(screen.getByRole('button', { name: /大学物理/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /高等数学/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^全部/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页课程' }), { target: { value: '上册' } });
    expect(screen.getByRole('button', { name: /高等数学/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /大学物理/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } });
    expect(screen.getByRole('heading', { name: '没有找到匹配的课程' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: /大学物理/ })).toBeInTheDocument();
  });

  it('protects an unsaved editor and sends only the existing course fields on save', async () => {
    await ready();
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
    await screen.findByRole('heading', { name: '高等数学' });
  });

  it('loads files independently and retries only the selected course files', async () => {
    let requests = 0;
    vi.mocked(api).mockImplementation(async path => {
      if (path.startsWith('courses?')) return courses;
      if (++requests === 1) throw new Error('资料读取失败');
      return [{ id: 'f1', filename: '极限.txt', size: 1024 }];
    });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: /学习资料/ }));
    await screen.findByText('资料读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重试加载资料' }));
    await screen.findByText('极限.txt');
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.startsWith('courses?'))).toHaveLength(1);
  });

  it('ignores the previous course file response after selecting a different course', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(path => {
      if (path.startsWith('courses?')) return Promise.resolve(courses);
      if (path === 'courses/course-a/uploads') return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve([{ id: 'new-file', filename: '物理资料.txt', size: 100 }]);
    });
    await ready();
    await waitFor(() => expect(resolveOld).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /大学物理/ }));
    fireEvent.click(screen.getByRole('tab', { name: /学习资料/ }));
    await screen.findByText('物理资料.txt');
    await act(async () => { resolveOld([{ id: 'old-file', filename: '旧课程资料.txt', size: 100 }]); });
    expect(screen.queryByText('旧课程资料.txt')).not.toBeInTheDocument();
    expect(screen.getByText('物理资料.txt')).toBeInTheDocument();
  });

  it('keeps a course visible when its confirmed deletion fails', async () => {
    await ready();
    vi.mocked(api).mockRejectedValueOnce(new Error('删除失败，请重试'));
    fireEvent.click(screen.getByRole('button', { name: '删除课程' }));
    expect(screen.getByText(/永久删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await screen.findByText('删除失败，请重试');
    expect(screen.getByRole('button', { name: /高等数学/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled();
  });

  it('moves course detail tabs with the keyboard and preserves focus', async () => {
    await ready();
    const first = screen.getByRole('tab', { name: '课程概览' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const files = screen.getByRole('tab', { name: /学习资料/ });
    expect(files).toHaveAttribute('aria-selected', 'true');
    expect(files).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(files, { key: 'Home' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveFocus();
  });
});

describe('account and shell states', () => {
  it('requires confirmation before returning from an unsaved compact editor to the directory', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '新建课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '尚未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '返回课程目录' }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/课程名称/)).toHaveValue('尚未保存');
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '返回课程目录' }));
    expect(screen.queryByLabelText(/课程名称/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的课程' }).closest('.course-space')).not.toHaveClass('showing-detail');
  });

  it('preserves the dirty guard when the active navigation item is clicked again', async () => {
    vi.mocked(api).mockImplementation(async path => path === 'users/me' ?
      { id: 'user-a', display_name: '学生', email: 'student@example.com' } :
      path.startsWith('courses?') ? courses : []);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Workspace />);
    await screen.findByRole('heading', { name: '高等数学' });
    fireEvent.click(screen.getByRole('button', { name: '编辑课程' }));
    fireEvent.change(screen.getByLabelText(/课程名称/), { target: { value: '未保存的课程' } });
    fireEvent.click(screen.getByRole('button', { name: '我的课程' }));
    fireEvent.click(screen.getByRole('button', { name: '账户设置' }));
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

  it('logs into the dedicated test account only when the shortcut is enabled', async () => {
    const login = vi.fn();
    const view = render(<Account onLogin={login} />);
    expect(screen.queryByRole('button', { name: '测试登录' })).not.toBeInTheDocument();
    view.rerender(<Account onLogin={login} testLoginEnabled />);
    vi.mocked(api).mockResolvedValue(user);
    fireEvent.click(screen.getByRole('button', { name: '测试登录' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith(user));
    expect(api).toHaveBeenCalledWith('auth/test-login', { method: 'POST' });
  });
});
