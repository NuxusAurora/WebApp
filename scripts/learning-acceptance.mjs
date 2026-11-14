import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './infra.mjs';

export async function learningAcceptance(ctx, frontend) {
  assert.match(ctx.config().name, /^p0c-verify-/);
  const fixture = resolve(root, 'scripts/fixtures/local-model.py');
  ctx.compose('cp', fixture, 'backend:/tmp/lesson-fixture.py');
  ctx.compose('exec', '-d', 'backend', 'python', '/tmp/lesson-fixture.py');
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'ready');
  let cookie;
  const send = async (path, method = 'GET', body, signal = AbortSignal.timeout(185000)) => {
    const response = await fetch(frontend + '/api/v1/' + path, {
      method, signal,
      headers: {
        'X-Requested-With': 'structured-learning', 'Content-Type': 'application/json',
        Origin: frontend, ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { wire: await response.json(), status: response.status, headers: response.headers,
      operation: body?.action ?? path };
  };
  const data = ({ wire, operation }) => {
    assert.equal(wire.success, true, operation + ' ' + JSON.stringify(wire.error));
    return wire.data;
  };
  const loggedIn = await send('auth/test-login', 'POST');
  const user = data(loggedIn);
  cookie = loggedIn.headers.get('set-cookie').split(';')[0];
  const course = data(await send('courses', 'POST', { title: '教学协议验收', textbook: '函数' }));
  const curriculum = 'courses/' + course.id + '/curriculum';
  const tree = data(await send(curriculum + '/drafts', 'POST', {
    base_course_revision: 0,
    payload: { chapters: [{ id: 'tmp-c', title: '函数', sections: [{ id: 'tmp-s', title: '定义' }] }] },
  }));
  const published = data(await send(curriculum + '/confirm', 'POST', {
    version_id: tree.id, revision: tree.revision, base_course_revision: 0,
  }));
  const section_id = published.id_mapping['tmp-s'];
  const source = 'sections/' + section_id + '/knowledge-points';
  const provider = data(await send('ai/providers', 'POST', {
    provider_name: '教学协议 fixture', base_url: 'http://127.0.0.1:1234/v1',
  }));
  const model = data(await send('ai/providers/' + provider.id + '/models', 'POST', { model_name: 'knowledge-fixture' }));
  const draft = data(await send(source + '/generate', 'POST', {
    provider_id: provider.id, model_id: model.id, base_course_revision: 1,
  }));
  data(await send(source + '/confirm', 'POST', {
    version_id: draft.id, expected_revision: draft.revision, base_course_revision: 1,
  }));
  const project = data(await send('learning/projects', 'POST', { section_id }));
  data(await send('learning/projects/textbooks/' + course.id, 'PUT'));
  const conversation = 'learning/conversations/' + project.conversation.id;
  const task = conversation + '/lesson/task';
  const setModel = async model_name => data(await send('ai/models/' + model.id, 'PUT', { model_name }));
  const fixtureBudget = value => ctx.compose('exec', '-T', 'backend', 'python', '-c',
    'import hashlib,os,redis,sys; r=redis.Redis.from_url(os.environ["REDIS_URL"]); r.set("auth-limit:lesson-ai:"+hashlib.sha256(sys.argv[1].encode()).hexdigest(), sys.argv[2], ex=600);r.close()', user.id, String(value));
  await setModel('lesson-fixture');
  let state = data(await send(task));
  function command(action, fields = {}) {
    return {
      action, request_id: randomUUID(), expected_revision: state.revision,
      expected_task_id: state.task_id, expected_plan_id: state.plan?.plan_id,
      expected_step_index: state.current_step?.index, ...fields,
    };
  }
  async function act(action, fields) {
    state = data(await send(task, 'POST', command(action, fields)));
    return state;
  }
  const first = await act('start');
  for (let i = 0; i < 3; i++) await act('hint');
  assert.deepEqual(state.support.hints.map(h => h.level), [1, 2, 3]);
  await act('rephrase');
  await act('check-question');
  const check_id = state.check.check_id;
  await act('check-answer', { check_id, answer: '每个输入只对应一个输出。' });
  await setModel('lesson-evaluation-error');
  assert.equal((await send(task, 'POST', command('evaluate-check', { check_id }))).status, 502);
  assert.equal(data(await send(task)).check.answer, '每个输入只对应一个输出。');
  await setModel('lesson-fixture');
  await act('evaluate-check', { check_id });
  assert.equal(state.check.status, 'feedback_ready');
  assert.equal(state.current_step.step_id, first.current_step.step_id);
  const beforeLimit = state;
  fixtureBudget(24);
  const limited = await send(task, 'POST', command('next'));
  assert.equal(limited.status, 429);
  assert.deepEqual(data(await send(task)), beforeLimit);
  fixtureBudget(0);
  for (let index = 0; index < 2; index++) {
    data(await send(conversation + '/turns', 'POST', {
      request_id: randomUUID(), after: index, question: '为什么要检查同一输入？',
    }));
  }
  assert.deepEqual(data(await send(task)), state);
  await setModel('lesson-delayed');
  const abort = new AbortController();
  const cancelled = send(task, 'POST', command('next'), abort.signal);
  setTimeout(() => abort.abort(), 400);
  await assert.rejects(cancelled, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 2300));
  assert.deepEqual(data(await send(task)), state);
  await setModel('lesson-fixture');
  const advancing = command('next');
  const competing = { ...advancing, request_id: randomUUID() };
  const pair = await Promise.all([send(task, 'POST', advancing), send(task, 'POST', competing)]);
  assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
  state = data(pair.find(r => r.status === 200));
  assert.equal(state.status, 'final_step');
  assert.equal(state.question.question_id, first.question.question_id);
  assert.deepEqual(data(await send(task, 'POST', pair[0].status === 200 ? advancing : competing)), state);
  await act('complete');
  assert.ok(state.completion.completed_at);
  await act('next-question');
  assert.notEqual(state.question.question_id, first.question.question_id);
  assert.notEqual(state.question.problem, first.question.problem);
  const current = state;
  ctx.compose('restart', 'backend');
  for (let i = 0; i < 30; i++) {
    try {
      assert.deepEqual(data(await send(task)), current);
      break;
    } catch (error) {
      if (i === 29) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  assert.equal(data(await send(conversation + '/turns')).turns.length, 2);
  await send('auth/logout', 'POST');
  console.log('PASS Learning Protocol PostgreSQL and same-origin HTTP: progression, support, recovery, idempotency, limit, turn separation and restart');
}
