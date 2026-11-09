import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './infra.mjs';

export async function phase3Acceptance(ctx, backend, frontend) {
  assert.match(ctx.config().name, /^p0c-verify-/);
  ctx.compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'downgrade', '0003_ai_gateway');
  for (let i = 0; i < 2; i++) ctx.compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head');
  assert.equal(ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'metadata'), 'metadata-ok');
  const marker = randomUUID();
  const request = async (base, path, method = 'GET', body, cookie, binary = false) => {
    const result = await fetch(`${base}/api/v1/${path}`, { method,
      headers: { 'X-Requested-With': 'structured-learning', 'Content-Type': binary ? 'image/png' : 'application/json',
        ...(binary ? { 'X-Filename': 'synthetic-calculus.png' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(base === frontend ? { Origin: frontend } : {}) },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(185000) });
    return { status: result.status, headers: result.headers, body: await result.json() };
  };
  const data = result => { assert.ok(result.body.success, `Phase 3: ${result.body.error?.code}`); return result.body.data; };
  const account = async suffix => {
    const email = `phase3-${suffix}-${marker}@example.com`; const password = `phase3-${marker}`;
    data(await request(frontend, 'auth/register', 'POST', { email, password, display_name: '目录验收' }));
    const token = ctx.compose('exec', '-T', 'backend', 'python', '-c',
      'import json,pathlib; print(next(json.loads(p.read_text())["token"] for p in pathlib.Path("/tmp/learning-outbox").glob("*.json") if json.loads(p.read_text())["to"]=="' + email + '"))');
    data(await request(frontend, 'auth/verify-email', 'POST', { token }));
    const result = await request(frontend, 'auth/login', 'POST', { email, password });
    return { cookie: result.headers.get('set-cookie').split(';')[0], id: data(result).id };
  };
  const one = await account('one'); const two = await account('two');
  const course = data(await request(frontend, 'courses', 'POST', { title: '高数 OCR 合成样例' }, one.cookie));
  const path = `courses/${course.id}/curriculum`;
  const image = data(await request(frontend, path + '/images', 'POST', readFileSync(resolve(root, 'scripts/fixtures/calculus-toc.png')), one.cookie, true));
  const ocr = data(await request(frontend, path + '/ocr', 'POST', { image_ids: [image.id] }, one.cookie));
  assert.match(ocr.ocr_text.replaceAll(' ', ''), /函数与极限/);
  assert.match(ocr.ocr_text.replaceAll(' ', ''), /导数/);
  const provider = data(await request(frontend, 'ai/providers', 'POST', {
    provider_name: '目录协议 fixture', base_url: 'http://127.0.0.1:1234/v1',
  }, one.cookie));
  const model = data(await request(frontend, `ai/providers/${provider.id}/models`, 'POST', { model_name: 'curriculum-fixture' }, one.cookie));
  const parsed = data(await request(frontend, path + '/parse', 'POST', {
    provider_id: provider.id, model_id: model.id, ocr_text: ocr.ocr_text, image_ids: [image.id],
  }, one.cookie));
  const read = () => request(frontend, path, 'GET', undefined, one.cookie).then(data);
  assert.deepEqual((await read()).curriculum.chapters, []);
  const changed = structuredClone(parsed.payload); changed.chapters[0].sections[0].title = '1.1 映射与函数（人工核对）';
  const patch = { version_id: parsed.id, revision: parsed.revision, base_course_revision: 0, payload: changed };
  const edited = data(await request(frontend, path, 'PATCH', patch, one.cookie));
  assert.equal((await request(frontend, path, 'PATCH', patch, one.cookie)).status, 409);
  for (const base of [backend, frontend]) {
    assert.equal((await request(base, path, 'GET', undefined, two.cookie)).status, 404);
    assert.equal((await request(base, path + '/ocr', 'POST', { image_ids: [image.id] }, two.cookie)).status, 404);
  }
  const confirm = { version_id: edited.id, revision: edited.revision, base_course_revision: 0 };
  // Exercise real PostgreSQL course locks and idempotency with simultaneous requests.
  const results = await Promise.all([request(frontend, path + '/confirm', 'POST', confirm, one.cookie), request(frontend, path + '/confirm', 'POST', confirm, one.cookie)]);
  assert.deepEqual(data(results[0]).id_mapping, data(results[1]).id_mapping);
  const current = await read();
  assert.equal(current.confirmed_revision, 1);
  assert.equal(current.curriculum.chapters.length, 1);
  assert.equal(current.curriculum.chapters[0].sections.length, 2);
  const before = JSON.stringify(current.curriculum);
  ctx.compose('restart', 'backend');
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if (JSON.stringify((await read()).curriculum) === before) break; } catch { /* restart */ }
    if (attempt === 29) throw new Error('Phase 3 persistence failed');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  data(await request(frontend, `courses/${course.id}`, 'DELETE', undefined, one.cookie));
  data(await request(frontend, `ai/providers/${provider.id}`, 'DELETE', undefined, one.cookie));
  ctx.compose('exec', '-T', 'backend', 'python', '/tmp/phase2-check.py', 'cleanup', one.id, two.id);
  console.log('PASS Phase 3 actual Chinese OCR on synthetic calculus TOC, HTTP protocol parse, draft-only edits, revision conflict, concurrent idempotent confirmation, tenant isolation, PostgreSQL restart persistence and cascade cleanup');
}
