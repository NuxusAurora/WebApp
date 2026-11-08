import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function phase1Acceptance(ctx, backend, frontend) {
  const marker = randomUUID();
  const password = `test-${randomUUID()}`;
  const secrets = [password];
  const request = async (base, path, method = 'GET', body, cookie, extra = {}) => {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'structured-learning',
        ...(base === frontend ? { Origin: new URL(frontend).origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...extra },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    return { response, status: response.status, body: await response.json() };
  };
  const expect = (result, status) => {
    assert.equal(result.status, status, `Unexpected API status: ${result.body.error?.code ?? 'success'}`);
    return result.body.data;
  };
  const mailToken = email => {
    const content = ctx.compose('exec', '-T', 'backend', 'python', '-c',
      'import json,pathlib; print(json.dumps([json.loads(p.read_text()) for p in pathlib.Path("/tmp/learning-outbox").glob("*.json")]))');
    return JSON.parse(content).find(row => row.to === email && row.kind === 'verify').token;
  };
  const account = async (email, base) => {
    const registered = await request(base, 'auth/register', 'POST', { email, password, display_name: '验收学生' });
    expect(registered, 201);
    const token = mailToken(email);
    secrets.push(token);
    assert.ok(!JSON.stringify(registered.body).includes(token));
    expect(await request(base, 'auth/login', 'POST', { email, password }), 403);
    const verification = await Promise.all([1, 2].map(() => request(base, 'auth/verify-email', 'POST', { token })));
    assert.deepEqual(verification.map(result => result.status).sort(), [200, 400], 'Concurrent token use must succeed once');
    expect(await request(base, 'auth/verify-email', 'POST', { token }), 400);
    const login = await request(base, 'auth/login', 'POST', { email, password });
    expect(login, 200);
    assert.match(login.response.headers.get('set-cookie'), /HttpOnly/i);
    secrets.push(login.response.headers.get('set-cookie').split(';')[0].split('=')[1]);
    return login.response.headers.get('set-cookie').split(';')[0];
  };
  const first = await account(`phase1-a-${marker}@example.com`, frontend);
  const second = await account(`phase1-b-${marker}@example.com`, backend);
  console.log('PASS Phase 1 direct and proxied registration, email verification and login');
  const course = expect(await request(frontend, 'courses', 'POST', {
    title: `高等数学 ${marker}`, subject: '数学', learning_goal: '掌握极限与导数',
  }, first), 201);
  const path = `courses/${course.id}`;
  const text = '极限定义\n这是隔离的验收资料。';
  const upload = expect(await request(frontend, `${path}/uploads`, 'POST', text, first,
    { 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent('学习资料.txt') }), 201);
  const filePath = `${path}/uploads/${upload.id}`;
  const download = expect(await request(frontend, `${filePath}/download`, 'GET', undefined, first), 200);
  assert.equal(download.expires_in, 60);
  const fileResponse = await fetch(download.url);
  assert.equal(fileResponse.status, 200, 'S3 signature and public endpoint must work');
  assert.equal(await fileResponse.text(), text);
  const unsigned = new URL(download.url); unsigned.search = '';
  assert.equal((await fetch(unsigned)).status, 403, 'Object must be private');
  expect(await request(frontend, 'courses', 'POST', { title: 'bad', user_id: 'injected' }, first), 422);
  expect(await request(frontend, path, 'PATCH', { title: '高等数学 II' }, first), 200);
  assert.deepEqual(expect(await request(frontend, 'courses', 'GET', undefined, second), 200), []);
  for (const base of [backend, frontend]) {
    for (const [method, suffix, body] of [['GET', '', undefined], ['PATCH', '', { title: 'stolen' }],
      ['DELETE', '', undefined], ['GET', '/uploads', undefined],
      ['GET', `/uploads/${upload.id}/download`, undefined], ['DELETE', `/uploads/${upload.id}`, undefined],
      ['POST', '/uploads', 'stolen']]) {
      expect(await request(base, path + suffix, method, body, second), 404);
    }
  }
  expect(await request(frontend, `${path}/uploads`, 'POST', '<script>unsafe</script>', first,
    { 'X-Filename': 'unsafe.txt' }), 400);
  const csrf = await request(frontend, 'auth/logout', 'POST', undefined, first, { Origin: 'https://evil.example' });
  expect(csrf, 403);
  ctx.compose('restart', 'backend');
  for (let n = 0; n < 30; n++) {
    try {
      const health = await fetch(`${frontend}/api/v1/ready`, { signal: AbortSignal.timeout(2000) });
      if (health.ok) break;
    } catch { /* start-up window */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const persisted = expect(await request(frontend, path, 'GET', undefined, first), 200);
  assert.equal(persisted.title, '高等数学 II');
  const afterRestart = expect(await request(frontend, `${filePath}/download`, 'GET', undefined, first), 200);
  assert.equal(await (await fetch(afterRestart.url)).text(), text);
  expect(await request(frontend, path, 'DELETE', undefined, first), 200);
  assert.equal((await fetch(download.url)).status, 404, 'Deleting a course removes its S3 objects');
  expect(await request(frontend, path, 'GET', undefined, first), 404);
  expect(await request(frontend, 'auth/logout', 'POST', undefined, first), 200);
  expect(await request(frontend, 'users/me', 'GET', undefined, first), 401);
  const logs = ctx.compose('logs', '--no-color', 'backend', 'frontend', 'worker');
  for (const secret of secrets) assert.ok(!logs.includes(secret), 'Auth secrets must not enter application logs');
  console.log('PASS Phase 1 registration/verification/replay, sessions/CSRF, two-user isolation, PostgreSQL persistence, private S3 signed download and object deletion');
}
