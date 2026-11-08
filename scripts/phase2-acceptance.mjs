import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { root } from './infra.mjs';

export async function phase2Acceptance(ctx, backend, frontend) {
  // These operations are only called by verify against its owned disposable project.
  assert.match(ctx.config().name, /^p0c-verify-/);
  console.log('Checking Phase 2 migration roundtrip and ORM metadata…');
  ctx.compose('cp', resolve(root, 'scripts/fixtures/phase2-check.py'), 'backend:/tmp/phase2-check.py');
  ctx.compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'downgrade', '0002_users_courses');
  for (let i = 0; i < 2; i++) ctx.compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head');
  const metadata = ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'metadata');
  assert.equal(metadata, 'metadata-ok');
  ctx.compose('cp', resolve(root, 'scripts/fixtures/local-model.py'), 'backend:/tmp/phase2-local-model.py');
  ctx.compose('exec', '-d', 'backend', 'python', '/tmp/phase2-local-model.py');
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'ready');
  const marker = randomUUID();
  const key = `phase2-key-${marker}`;
  const password = `phase2-password-${marker}`;
  const request = async (base, path, method = 'GET', body, cookie) => {
    const response = await fetch(`${base}/api/v1/${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'structured-learning',
        ...(cookie ? { Cookie: cookie } : {}), ...(base === frontend ? { Origin: frontend } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35000) });
    const text = await response.text();
    assert.ok(!text.includes(key) && !text.includes(password), 'Credential disclosure');
    return { status: response.status, text, headers: response.headers };
  };
  const data = result => {
    assert.ok(result.status >= 200 && result.status < 300, `Phase 2 API: ${JSON.parse(result.text).error?.code}`);
    return JSON.parse(result.text).data;
  };
  const account = async (suffix) => {
    const email = `phase2-${suffix}-${marker}@example.com`;
    data(await request(frontend, 'auth/register', 'POST', { email, password, display_name: '协议验收' }));
    const token = ctx.compose('exec', '-T', 'backend', 'python', '-c',
      'import json,pathlib; print(next(json.loads(p.read_text())["token"] for p in pathlib.Path("/tmp/learning-outbox").glob("*.json") if json.loads(p.read_text())["to"]=="' + email + '"))');
    data(await request(frontend, 'auth/verify-email', 'POST', { token }));
    const login = await request(frontend, 'auth/login', 'POST', { email, password });
    const user = data(login);
    return { cookie: login.headers.get('set-cookie').split(';')[0], userId: user.id };
  };
  const first = await account('a');
  const second = await account('b');
  const provider = data(await request(frontend, 'ai/providers', 'POST', {
    provider_name: '隔离本地协议服务', base_url: 'http://127.0.0.1:1234/v1', api_key: key,
  }, first.cookie));
  const model = data(await request(frontend, `ai/providers/${provider.id}/models`, 'POST', {
    model_name: 'local-one', capabilities_confirmed: true,
    capabilities: { streaming: true, structured_output: true },
  }, first.cookie));
  const course = data(await request(frontend, 'courses', 'POST', { title: '模型切换保持不变' }, first.cookie));
  const courseBefore = data(await request(frontend, `courses/${course.id}`, 'GET', undefined, first.cookie));
  for (const kind of ['chat', 'stream', 'structured']) {
    data(await request(frontend, `ai/models/${model.id}/test`, 'POST', { kind }, first.cookie));
  }
  const body = { provider_id: provider.id, model_id: model.id,
    messages: [{ role: 'user', content: 'private-protocol-question' }], task_context: { policy_version: 'example-v1' } };
  assert.equal(data(await request(frontend, 'ai/calls', 'POST', body, first.cookie)).usage.input_tokens, 8);
  const stream = await request(frontend, 'ai/calls/stream', 'POST', body, first.cookie);
  assert.equal(stream.status, 200); assert.ok(stream.text.includes('"done": true'));
  data(await request(frontend, `ai/models/${model.id}`, 'PUT', { model_name: 'local-two' }, first.cookie));
  data(await request(frontend, 'ai/calls', 'POST', body, first.cookie));
  assert.deepEqual(data(await request(frontend, `courses/${course.id}`, 'GET', undefined, first.cookie)), courseBefore);
  assert.deepEqual(data(await request(frontend, 'ai/providers', 'GET', undefined, second.cookie)), []);
  for (const base of [backend, frontend]) {
    assert.equal((await request(base, `ai/providers/${provider.id}/key`, 'DELETE', undefined, second.cookie)).status, 404);
    assert.equal((await request(base, `ai/models/${model.id}/test`, 'POST', {}, second.cookie)).status, 404);
    assert.equal((await request(base, 'ai/calls', 'POST', body, second.cookie)).status, 404);
  }
  data(await request(frontend, `ai/models/${model.id}`, 'PUT', { model_name: 'invalid-key-model' }, first.cookie));
  const failure = await request(frontend, 'ai/calls', 'POST', body, first.cookie);
  assert.equal(failure.status, 502); assert.ok(!failure.text.includes('private-provider-error'));
  const logs = data(await request(frontend, 'ai/calls', 'GET', undefined, first.cookie));
  assert.equal(logs.length, 7); assert.ok(logs.some(row => row.error_code === 'AI_AUTH_FAILED'));
  assert.ok(!JSON.stringify(logs).includes('private-protocol-question'));
  const encrypted = ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'encrypted');
  assert.equal(encrypted, 'encrypted-ok');
  data(await request(frontend, `ai/providers/${provider.id}/key`, 'DELETE', undefined, first.cookie));
  data(await request(frontend, `ai/models/${model.id}`, 'PUT', { model_name: 'local-keyless' }, first.cookie));
  data(await request(frontend, 'ai/calls', 'POST', body, first.cookie));
  const applicationLogs = ctx.compose('logs', '--no-color', 'backend', 'frontend');
  assert.ok(!applicationLogs.includes(key) && !applicationLogs.includes('private-protocol-question'));
  data(await request(frontend, `ai/providers/${provider.id}`, 'DELETE', undefined, first.cookie));
  data(await request(frontend, `courses/${course.id}`, 'DELETE', undefined, first.cookie));
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'cleanup', first.userId, second.userId);
  console.log('PASS Phase 2 PostgreSQL migration roundtrip/metadata, local HTTP protocol chat/stream/Schema, keyless/encrypted keys, two-user isolation, model switch and content-free audits');
}
