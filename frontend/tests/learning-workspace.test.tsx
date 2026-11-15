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
    revision: 1, status: 'final_step', actions: ['complete', 'hint'],
    question: { question_id: 'question-one', problem: '第一道题' },
    current_step: { step_id: 'step-one', index: 1, title: '第一步讲解', content: '第一道题的解法' },
    practice,
  };
  let lesson: LessonTask = { revision: 0, status: 'not_started', actions: ['start'] };
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path !== lessonPath) return fallback(path, init);
    if (init?.method !== 'POST') return lesson;
    const command = JSON.parse(String(init.body)).action;
    commands.push(command);
    if (command === 'start') lesson = firstQuestion;
    else if (command === 'complete') {
      const last = lesson.practice?.current === 1;
      lesson = { ...lesson, revision: lesson.revision + 1, status: 'completed',
        actions: last ? ['finish'] : ['similar-question', 'next-type'],
        practice: { ...practice, current: last ? 1 : 0, mastered: last ? [0, 1] : [0] } };
    }
    else if (command === 'next-type') lesson = { ...firstQuestion, revision: 3,
      previous_questions: [{ ...lesson, actions: [] }],
      practice: { ...practice, current: 1, mastered: [0] },
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
  expect(await screen.findByRole('button', { name: '相似题目' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '下一个类型题目' }));
  expect(await screen.findByText('第二道题')).toBeVisible();
  expect(screen.getByText('第一道题')).toBeVisible();
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
  expect(commands).toEqual(['start', 'complete', 'next-type', 'complete', 'finish']);
});

it('keeps explanations inside the selected subquestion even when whole-question progress exists', async () => {
  history.replaceState({}, '', secondHref);
  const lessonPath = 'learning/conversations/' + secondId + '/lesson/task';
  const fallback = vi.mocked(api).getMockImplementation()!;
  const selectedRequests: object[] = [];
  const lesson: LessonTask = {
    revision: 7, status: 'teaching', actions: ['next', 'similar-question', 'next-type', 'hint'],
    previous_questions: [{
      revision: 3, status: 'completed', actions: [],
      question: { question_id: 'earlier', problem: '已练习题' },
      problem_parts: { statement: '历史题干', parts: [
        { number: 1, text: '历史第一问' }, { number: 2, text: '历史第二问' },
      ] },
    }],
    question: { question_id: 'multi-part', problem: '一道三问的题目' },
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
      return { number: 3, title: '第三问的讲解', content: '直接用第三问的数据求解。' };
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
  expect(screen.getByRole('button', { name: '相似题目' })).toBeEnabled();
  expect(third.closest('.lesson-problem-dock')).toBeNull();
  conversation.scrollTop = 180;
  fireEvent.click(third);
  expect(conversation.scrollTop).toBe(0);
  expect(screen.queryByRole('region', { name: '题目 1' })).not.toBeInTheDocument();
  expect(screen.getByText('历史题干')).not.toBeVisible();
  expect(screen.getByRole('button', { name: '返回全部题目' }).closest('.lesson-problem-dock')).not.toBeNull();
  expect(screen.queryByText('第二小题')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('模型暂不可用');
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始讲解' }));
  expect(await screen.findByRole('heading', { name: '第三问的讲解' })).toBeVisible();
  expect(screen.getByText('解第（3）问：')).toBeVisible();
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  expect(selectedRequests).toEqual([{ expected_revision: 7, subquestion: 3 }, { expected_revision: 7, subquestion: 3 }]);

  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  expect(conversation.scrollTop).toBe(180);
  expect(screen.getByText('历史题干')).toBeVisible();
  expect(screen.getByText('第二小题')).toBeVisible();
  expect(screen.queryByText('旧的整题讲解')).not.toBeInTheDocument();
  expect(screen.queryByText('直接用第三问的数据求解。')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开始讲解' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '第（3）问' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '第（3）问' }));
  expect(screen.getByRole('heading', { name: '第三问的讲解' })).toBeVisible();
  expect(selectedRequests).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '返回全部题目' }));
  const earlier = within(screen.getByRole('region', { name: '题目 1' }));
  fireEvent.click(earlier.getByRole('button', { name: '第（2）问' }));
  expect(screen.getByText('历史第二问')).toBeVisible();
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
