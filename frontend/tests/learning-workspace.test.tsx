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
  expect(screen.queryByRole('button', { name: '不打断模型提问' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  const question = screen.getByRole('button', { name: '不打断模型提问' });
  expect(question.closest('footer')).toContainElement(screen.getByRole('button', { name: '开始学习' }));
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
  expect(screen.queryByText('继续阅读')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(screen.getByText('继续阅读')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '返回题目' }));
  expect(screen.queryByText('继续阅读')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始讲解' })).toHaveFocus();
  expect(await screen.findByRole('link', { name: /行列式定义/ })).toHaveAttribute('aria-current', 'page');
  expect(location.search).toBe('?view=learning&project=' + projectId);
});

it('opens an unnumbered question as a detail and returns to the question on reload', async () => {
  history.replaceState({}, '', secondHref);
  const lessonPath = 'learning/conversations/' + secondId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  const commands: string[] = [];
  const practice = { types: [
    { title: '定义判断', objective: '按定义判断' }, { title: '构造反例', objective: '识别反例' },
  ], current: 0, mastered: [] as number[], finished: false };
  const firstQuestion: LessonTask = {
    revision: 1, status: 'final_step', actions: ['complete', 'hint', 'custom-question', 'select-type'],
    generated_type_indices: [0],
    question: { question_id: 'question-one', problem: '第一道题' },
    current_step: { step_id: 'step-one', index: 1, title: '第一步讲解', content: '第一道题的解法' },
    practice,
  };
  let lesson: LessonTask = { revision: 0, status: 'not_started', actions: ['start'] };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    const { action: command, type_index } = JSON.parse(String(init.body));
    commands.push(command);
    if (command === 'start') lesson = firstQuestion;
    else if (command === 'complete') {
      const last = lesson.practice?.current === 1;
      lesson = { ...lesson, revision: lesson.revision + 1, status: 'completed',
        actions: last ? ['finish'] : ['custom-question', 'select-type'],
        practice: { ...practice, current: last ? 1 : 0, mastered: last ? [0, 1] : [0] } };
    }
    else if (command === 'select-type') lesson = { ...firstQuestion, revision: 3,
      previous_questions: [{ ...lesson, actions: [] }], generated_type_indices: [0, 1],
      practice: { ...practice, current: type_index, mastered: [0] },
      question: { question_id: 'question-two', problem: '第二道题' },
      current_step: { step_id: 'step-two', index: 1, title: '第二题讲解', content: '第二道题的解法' } };
    else if (command === 'finish') lesson = { ...lesson, revision: 5, actions: [],
      practice: { ...lesson.practice!, finished: true } };
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
  expect(await screen.findByText('第一道题')).toBeVisible();
  expect(screen.queryByText('第一道题的解法')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByText('第一道题的解法')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '我理解了，完成本题' }));
  expect(screen.queryByRole('button', { name: '自定义题目' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /题目类型/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回题目' }));
  expect(await screen.findByRole('button', { name: '自定义题目' })).toBeEnabled();
  const typePicker = screen.getByRole('button', { name: '题目类型 1/2' });
  fireEvent.click(typePicker);
  const options = within(screen.getByRole('list', { name: '选择题型' }));
  expect(typePicker).toHaveAttribute('aria-expanded', 'true');
  expect(commands).toEqual(['start', 'complete']);
  expect(options.getByRole('button', { name: /定义判断/ })).toBeDisabled();
  const target = options.getByRole('button', { name: /构造反例/ });
  expect(target).toHaveFocus();
  expect(target).toHaveTextContent('AI 出题');
  fireEvent.keyDown(target, { key: 'Escape' });
  expect(typePicker).toHaveFocus();
  expect(screen.queryByRole('list', { name: '选择题型' })).not.toBeInTheDocument();
  fireEvent.click(typePicker);
  fireEvent.click(screen.getByRole('button', { name: /构造反例/ }));
  expect(await screen.findByText('第二道题')).toBeVisible();
  expect(screen.queryByRole('list', { name: '选择题型' })).not.toBeInTheDocument();
  expect(screen.getByText('第一道题')).toBeVisible();
  const secondType = screen.getByRole('button', { name: '题目类型 2/2' });
  expect(secondType).toBeEnabled();
  fireEvent.click(secondType);
  const savedType = screen.getByRole('button', { name: /定义判断/ });
  expect(savedType).toHaveTextContent('回原题');
  expect(savedType).toHaveTextContent('已掌握');
  fireEvent.keyDown(savedType, { key: 'Escape' });
  expect(screen.queryByText('第二道题的解法')).not.toBeInTheDocument();
  const conversation = screen.getByRole('region', { name: '练习对话' });
  expect(within(conversation).getAllByRole('button', { name: '开始讲解' })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '完结' })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: '题目 1' })).getByRole('button', { name: '开始讲解' }));
  expect(screen.getByText('第一道题的解法')).toBeVisible();
  expect(screen.queryByRole('button', { name: '我理解了，完成本题' })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('region', { name: '题目 2' })).getByRole('button', { name: '开始讲解' }));
  expect(screen.getByText('第二道题的解法').closest('.lesson-problem-dock')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '我理解了，完成本题' }));
  fireEvent.click(await screen.findByRole('button', { name: '完结' }));
  expect(await screen.findByText('知识点已完结')).toBeVisible();
  expect(screen.getByText('第一道题')).toBeVisible();
  expect(commands).toEqual(['start', 'complete', 'select-type', 'complete', 'finish']);
});

it('reveals a previously generated question at its original position when its type is selected', async () => {
  const lessonPath = 'learning/conversations/' + secondId + '/lesson/task';
  history.replaceState({}, '', secondHref);
  const fallback = vi.mocked(api).getMockImplementation()!;
  const practice = {
    types: [{ title: '定义判断', objective: '应用定义' }, { title: '构造反例', objective: '识别反例' }],
    current: 1, mastered: [0], finished: false,
  };
  const saved: LessonTask = {
    revision: 4, question_order: 1, status: 'completed', actions: [],
    question: { question_id: 'first', problem: '保存的第一题' },
    practice: { ...practice, current: 0 },
    current_step: { index: 2, title: '已经保存的步骤', content: '已经保存的讲解' },
  };
  const current: LessonTask = {
    revision: 5, question_order: 5, status: 'teaching', actions: ['select-type'],
    question: { question_id: 'second', problem: '当前第二题' }, practice,
  };
  let lesson: LessonTask = { ...current, previous_questions: [saved] };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'select-type', type_index: 0 });
    lesson = { ...saved, revision: 6, actions: ['select-type'], previous_questions: [{ ...current, actions: [] }] };
    return lesson;
  });
  render(<Workspace />);
  const firstCard = await screen.findByRole('region', { name: '题目 1' });
  fireEvent.click(within(firstCard).getByRole('button', { name: '收起题目' }));
  expect(screen.getByText('保存的第一题')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '题目类型 2/2' }));
  fireEvent.click(screen.getByRole('button', { name: /定义判断/ }));
  await screen.findByRole('button', { name: '题目类型 1/2' });
  const firstHeading = screen.getByRole('heading', { name: '题目 1' });
  expect(firstHeading).toHaveFocus();
  expect(within(firstCard).getByText('保存的第一题')).toBeVisible();
  expect(within(screen.getByRole('region', { name: '题目 2' })).getByText('当前第二题')).toBeVisible();
  fireEvent.click(within(firstCard).getByRole('button', { name: '开始讲解' }));
  expect(screen.getByText('已经保存的讲解')).toBeVisible();
});

it.each([false, true])('preserves third-type generation across a point switch (finished while away: %s)', async finishedAway => {
  const lessonPath = 'learning/conversations/' + firstId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  const practice = {
    types: ['判断符号', '交换规律', '奇偶性辨析'].map(title => ({ title, objective: title })),
    current: 1, mastered: [0], finished: false,
  };
  let lesson: LessonTask = {
    revision: 5, status: 'teaching', actions: ['select-type'],
    practice, generated_type_indices: [0, 1],
    question: { question_id: 'previous', problem: '交换规律练习' },
  };
  const pending = Promise.withResolvers<void>();
  const commands: RequestInit[] = [];
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    commands.push(init);
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'select-type', expected_revision: 5, type_index: 2 });
    await pending.promise;
    if (init.signal?.aborted) throw init.signal.reason;
    lesson = { ...lesson, revision: 6, practice: { ...practice, current: 2 }, generated_type_indices: [0, 1, 2],
      previous_questions: [lesson], question: { question_id: 'third', problem: '奇偶性辨析练习' } };
    return lesson;
  });
  render(<Workspace />);
  fireEvent.click(await screen.findByRole('button', { name: '题目类型 2/3' }));
  const thirdType = screen.getByRole('button', { name: /奇偶性辨析/ });
  expect(thirdType).toHaveTextContent('AI 出题');
  fireEvent.click(thirdType);
  await screen.findByText('正在打开所选题型…');
  fireEvent.click(await screen.findByRole('link', { name: /排列与逆序数/ }));
  await screen.findByRole('heading', { name: '排列与逆序数' });
  expect(screen.queryByText('正在打开所选题型…')).not.toBeInTheDocument();
  expect(commands[0]?.signal?.aborted).toBe(false);

  if (finishedAway) await act(async () => pending.resolve());
  fireEvent.click(await screen.findByRole('link', { name: /行列式定义/ }));
  if (!finishedAway) {
    expect(await screen.findByText('正在打开所选题型…')).toBeVisible();
    expect(await screen.findByRole('button', { name: '题目类型 2/3' })).toBeDisabled();
    await act(async () => pending.resolve());
  }
  expect(await screen.findByText('奇偶性辨析练习')).toBeVisible();
  expect(await screen.findByRole('button', { name: '题目类型 3/3' })).toBeEnabled();
  expect(screen.getByText('交换规律练习')).toBeVisible();
  expect(commands).toHaveLength(1);
});

it('submits custom question requirements and keeps the draft when generation fails', async () => {
  const lessonPath = 'learning/conversations/' + firstId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  let lesson: LessonTask = {
    revision: 2, status: 'teaching', actions: ['custom-question', 'next-type'],
    question: { question_id: 'initial', problem: '题面' },
  };
  const requests: object[] = [];
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    requests.push(JSON.parse(String(init.body)));
    if (requests.length === 1) throw new Error('生成失败，请重试');
    lesson = { ...lesson, revision: 3, previous_questions: [lesson],
      question: { question_id: 'custom', problem: '按要求生成的题面' } };
    return lesson;
  });
  render(<Workspace />);
  const trigger = await screen.findByRole('button', { name: '自定义题目' });
  fireEvent.click(trigger);
  const field = screen.getByRole('textbox', { name: '出题要求' });
  expect(field).toHaveFocus();
  expect(screen.getByRole('button', { name: '生成题目' })).toBeDisabled();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.change(screen.getByRole('textbox', { name: '出题要求' }), { target: { value: '  用学校场景出题  ' } });
  fireEvent.click(screen.getByRole('button', { name: '生成题目' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('生成失败，请重试');
  expect(screen.getByRole('textbox', { name: '出题要求' })).toHaveValue('  用学校场景出题  ');
  expect(requests[0]).toMatchObject({ action: 'custom-question', expected_revision: 2, question_request: '用学校场景出题' });
  fireEvent.click(screen.getByRole('button', { name: '生成题目' }));
  expect(await screen.findByText('按要求生成的题面')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: '出题要求' })).not.toBeInTheDocument();
  expect(screen.getByText('题面')).toBeVisible();
});

it('keeps explanations inside the selected subquestion even when whole-question progress exists', async () => {
  history.replaceState({}, '', secondHref);
  const lessonPath = 'learning/conversations/' + secondId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  const selectedRequests: object[] = [];
  const lesson: LessonTask = {
    revision: 7, status: 'teaching', actions: ['next', 'custom-question', 'select-type', 'hint'],
    practice: { types: [{ title: '基础练习', objective: '应用定义' }, { title: '变式', objective: '变式应用' }],
      current: 0, mastered: [], finished: false },
    previous_questions: [{
      revision: 3, status: 'completed', actions: [],
      question: { question_id: 'earlier', problem: '已练习题' },
      problem_parts: { statement: '历史题干', parts: [
        { number: 1, text: '历史第一问' }, { number: 2, text: '历史第二问' },
      ] },
    }],
    question: { question_id: 'multi-part', problem: '一道三问的题目', type_title: '基础练习' },
    problem_parts: { statement: '共用题干', parts: [
      { number: 1, text: '第一小题' }, { number: 2, text: '第二小题' }, { number: 3, text: '第三小题' },
    ] },
    current_step: { step_id: 'second-step', index: 2, title: '第二步', content: '旧的整题讲解' },
    plan: { plan_id: 'whole-plan', plan_version: 1, learning_objective: '目标', total_steps: 3 },
    support: { hints: [{ level: 1, text: '旧的整题提示' }] },
  };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === lessonPath && init?.method !== 'POST') return lesson;
    if (path === lessonPath + '/subquestion' && init?.method === 'POST') {
      selectedRequests.push(JSON.parse(String(init.body)));
      if (selectedRequests.length === 1) throw new Error('模型暂不可用');
      return { number: 3, title: '判断对应关系', content: '直接用第三问的数据求解。' };
    }
    return fallback(path, init);
  });
  render(<Workspace />);
  const third = await screen.findByRole('button', { name: '第（3）问' });
  const conversation = screen.getByRole('region', { name: '练习对话' });
  expect(screen.getByText('历史题干')).toBeVisible();
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  expect(screen.queryByText('旧的整题提示')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开始讲解' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '不打断模型提问' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '自定义题目' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '题目类型 1/2' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '题目类型 1/2' }));
  expect(screen.getByRole('list', { name: '选择题型' })).toBeVisible();
  expect(third.closest('.lesson-problem-dock')).toBeNull();
  conversation.scrollTop = 180;
  fireEvent.click(third);
  expect(conversation.scrollTop).toBe(0);
  expect(screen.queryByRole('list', { name: '选择题型' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '自定义题目' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /题目类型/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '题目 1' })).not.toBeInTheDocument();
  expect(screen.getByText('历史题干')).not.toBeVisible();
  expect(screen.getByRole('heading', { name: '题目 2 · 基础练习' }).closest('.lesson-problem-dock')).not.toBeNull();
  expect(screen.queryByText('第二小题')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('模型暂不可用');
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByRole('heading', { name: '题目 2 · 判断对应关系' })).toBeVisible();
  expect(screen.queryByText('解第（3）问：')).not.toBeInTheDocument();
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  expect(selectedRequests).toEqual([{ expected_revision: 7, subquestion: 3 }, { expected_revision: 7, subquestion: 3 }]);

  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  expect(conversation.scrollTop).toBe(180);
  expect(screen.getByRole('button', { name: '自定义题目' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '题目类型 1/2' })).toBeEnabled();
  expect(screen.getByText('历史题干')).toBeVisible();
  expect(screen.getByText('第二小题')).toBeVisible();
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  expect(screen.queryByText('直接用第三问的数据求解。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开始讲解' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '第（3）问' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '第（3）问' }));
  expect(screen.getByRole('heading', { name: '题目 2 · 判断对应关系' })).toBeVisible();
  expect(selectedRequests).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  const earlier = within(screen.getByRole('region', { name: '题目 1' }));
  fireEvent.click(earlier.getByRole('button', { name: '第（2）问' }));
  expect(screen.getByRole('heading', { name: '题目 1' }).closest('.lesson-problem-dock')).not.toBeNull();
  expect(screen.getByText('历史第二问')).toBeVisible();
  expect(screen.queryByRole('button', { name: '自定义题目' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /题目类型/ })).not.toBeInTheDocument();
  expect(screen.getByText('共用题干')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  expect(screen.getByText('共用题干')).toBeVisible();
  expect(screen.getByText('历史第一问')).toBeVisible();
  expect(within(screen.getByRole('region', { name: '题目 1' }))
    .getByRole('button', { name: '第（2）问' })).toHaveFocus();
});

it('opens a fresh question thread while the original conversation keeps answering', async () => {
  const turnsPath = 'learning/conversations/' + firstId + '/turns';
  const fallback = vi.mocked(api).getMockImplementation()!;
  let finishOriginal: (result: object) => void = () => {};
  let newThread: string | undefined;
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === turnsPath + '/threads') return [];
    if (path === turnsPath && init?.method !== 'POST') return {
      turns: [{ id: 'previous', position: 1, question: '以前的提问', answer: '原有回答' }], before: null,
    };
    if (path === turnsPath && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      if (payload.question === '原对话追问') {
        expect(payload.after).toBe(1);
        return new Promise(resolve => { finishOriginal = resolve; });
      }
      expect(payload.after).toBe(0);
      newThread = payload.thread_id;
      return { id: 'new-answer', position: 1, question: payload.question, answer: '新对话回答' };
    }
    return fallback(path, init);
  });

  render(<Workspace />);
  fireEvent.click(await screen.findByRole('button', { name: '开始讲解' }));
  fireEvent.click(screen.getByRole('button', { name: '不打断模型提问' }));
  fireEvent.change(await screen.findByRole('textbox', { name: '提问' }), { target: { value: '原对话追问' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(screen.getByText('正在回答…')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '新开对话' }));
  const newInput = screen.getByRole('textbox', { name: '提问' });
  expect(newInput).toHaveFocus();
  expect(newInput).toHaveValue('');
  expect(screen.getByText('原有回答')).not.toBeVisible();
  expect(screen.getByText('继续阅读')).toBeVisible();
  fireEvent.change(newInput, { target: { value: '新对话问题' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByText('新对话回答')).toBeVisible();
  expect(newThread).toMatch(/^[0-9a-f-]{36}$/);

  await act(async () => finishOriginal({
    id: 'original-answer', position: 2, question: '原对话追问', answer: '原对话继续生成的回答',
  }));
  const switcher = screen.getByRole('combobox', { name: '切换对话' });
  fireEvent.change(switcher, { target: { value: '' } });
  expect(screen.getByText('原对话继续生成的回答')).toBeVisible();
  expect(screen.getByText('新对话回答')).not.toBeVisible();
  fireEvent.change(switcher, { target: { value: newThread } });
  expect(screen.getByText('新对话回答')).toBeVisible();
});
