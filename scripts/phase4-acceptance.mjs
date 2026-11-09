import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './infra.mjs';

// Runs only in an owned acceptance stack; never uses a real user's courses or model.
export async function phase4Acceptance(ctx, backend, frontend) {
  assert.match(ctx.config().name, /^p0c-verify-/);
  // Phase 3 restarts the backend, which also stops the in-container protocol fixture.
  ctx.compose('cp', resolve(root, 'scripts/fixtures/phase2-check.py'), 'backend:/tmp/phase2-check.py');
  ctx.compose('cp', resolve(root, 'scripts/fixtures/local-model.py'), 'backend:/tmp/phase4-local-model.py');
  ctx.compose('exec', '-d', 'backend', 'python', '/tmp/phase4-local-model.py');
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'ready');
  const marker = randomUUID();
  async function request(base, path, method = 'GET', body, cookie) {
    const response = await fetch(`${base}/api/v1/${path}`, { method,
      headers: { 'X-Requested-With': 'structured-learning', 'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}), ...(base === frontend ? { Origin: frontend } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(185000) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  function data(response) { assert.ok(response.body.success, response.body.error?.code); return response.body.data; }
  async function account(suffix) {
    const email = `phase4-${suffix}-${marker}@example.com`; const password = `phase4-${marker}`;
    data(await request(frontend, 'auth/register', 'POST', { email, password, display_name: '知识验收' }));
    const token = ctx.compose('exec', '-T', 'backend', 'python', '-c',
      'import json,pathlib; print(next(json.loads(p.read_text())["token"] for p in pathlib.Path("/tmp/learning-outbox").glob("*.json") if json.loads(p.read_text())["to"]=="' + email + '"))');
    data(await request(frontend, 'auth/verify-email', 'POST', { token }));
    const result = await request(frontend, 'auth/login', 'POST', { email, password });
    return { cookie: result.headers.get('set-cookie').split(';')[0], id: data(result).id };
  }
  const one = await account('one'); const two = await account('two');
  const send = (path, method, body) => request(frontend, path, method, body, one.cookie);
  const course = data(await send('courses', 'POST', { title: '知识闭环验收' }));
  const directory = `courses/${course.id}/curriculum`;
  const dv = data(await send(directory + '/drafts', 'POST', { base_course_revision: 0,
    payload: { chapters: [{ id: 'tmp-c', title: '函数与极限', sections: [{ id: 'tmp-s', title: '函数' }, { id: 'tmp-t', title: '极限' }] }] } }));
  const dc = data(await send(directory + '/confirm', 'POST', { version_id: dv.id, revision: dv.revision, base_course_revision: 0 }));
  const path = `sections/${dc.id_mapping['tmp-s']}/knowledge-points`;
  const other = `sections/${dc.id_mapping['tmp-t']}/knowledge-points`;
  const provider = data(await send('ai/providers', 'POST', { provider_name: '知识协议fixture', base_url: 'http://127.0.0.1:1234/v1' }));
  const model = data(await send(`ai/providers/${provider.id}/models`, 'POST', { model_name: 'knowledge-fixture' }));
  const draft = data(await send(path + '/generate', 'POST', { provider_id: provider.id, model_id: model.id, base_course_revision: 1 }));
  assert.deepEqual(data(await send(path)).knowledge_points, []);
  assert.deepEqual(data(await send(directory)).versions, []);
  const payload = structuredClone(draft.payload); payload.knowledge_points[0].title += '（核对）';
  const patch = { version_id: draft.id, expected_revision: draft.revision, base_course_revision: 1, payload };
  const edited = data(await send(path, 'PATCH', patch));
  assert.equal((await send(path, 'PATCH', patch)).status, 409);
  const confirm = { version_id: edited.id, expected_revision: edited.revision, base_course_revision: 1 };
  const confirmations = await Promise.all([send(path + '/confirm', 'POST', confirm), send(path + '/confirm', 'POST', confirm)]);
  assert.deepEqual(data(confirmations[0]), data(confirmations[1]));
  let current = data(await send(path)); const point = current.knowledge_points[0];
  assert.equal(point.status, 'NOT_STARTED'); assert.equal(current.confirmed_revision, 2);
  for (const base of [frontend, backend]) assert.equal((await request(base, path, 'GET', undefined, two.cookie)).status, 404);
  assert.equal((await send(other + '/confirm', 'POST', confirm)).status, 404);
  const own = payload.knowledge_points[0]; own.existing_knowledge_point_id = point.id; own.description = '核对后的定义';
  assert.equal((await send(other + '/drafts', 'POST', { base_course_revision: 2, payload })).status, 400);
  const update = data(await send(path + '/drafts', 'POST', { base_course_revision: 2, payload }));
  data(await send(path + '/confirm', 'POST', { version_id: update.id, expected_revision: 1, base_course_revision: 2 }));
  current = data(await send(path)); assert.equal(current.knowledge_points[0].id, point.id);
  // Concurrent confirms of distinct section drafts share the same course revision lock.
  const versions = await Promise.all([send(path + '/drafts', 'POST', { base_course_revision: 3, payload }),
    send(other + '/drafts', 'POST', { base_course_revision: 3, payload: draft.payload })]);
  const concurrent = await Promise.all(versions.map((v, i) => request(frontend, (i ? other : path) + '/confirm', 'POST', {
    version_id: data(v).id, expected_revision: 1, base_course_revision: 3 }, one.cookie)));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const before = data(await send(path)).knowledge_points;
  ctx.compose('restart', 'backend');
  for (let i = 0; i < 40; i++) {
    try { assert.deepEqual(data(await send(path)).knowledge_points, before); break; } catch (error) { if (i === 39) throw error; }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const removed = await send(`courses/${course.id}`, 'DELETE');
  assert.equal(removed.status, 200, 'Course cascade deletion must remove section versions and knowledge points atomically');
  data(removed);
  data(await send(`ai/providers/${provider.id}`, 'DELETE'));
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'cleanup', one.id, two.id);
  console.log('PASS Phase 4 PostgreSQL/HTTP: generation via Gateway, draft isolation/edit conflicts, idempotent concurrent confirmation, stable IDs, tenants/scopes, cross-section race, restart persistence and cascade cleanup');
}
