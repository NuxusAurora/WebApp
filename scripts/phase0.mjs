import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkConfig, context, docker, generatedEnv, root, smoke } from './infra.mjs';

const [command, ...flags] = process.argv.slice(2);
const owned = command === 'verify';
const keep = flags.includes('--keep');
let envFile = resolve(root, '.env');
if (owned) assert.ok(flags.length === 0 || (flags.length === 1 && keep), 'verify accepts only --keep');
else if (flags.length) {
  assert.equal(flags[0], '--env-file');
  assert.equal(flags.length, 2);
  envFile = resolve(flags[1]);
}

async function json(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  assert.equal(response.status, expected, `HTTP status for ${new URL(url).pathname}`);
  const body = await response.json();
  assert.equal(body.success, expected === 200);
  return body;
}

async function waitReady(url) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await json(`${url}/api/v1/ready`, 200); return; } catch { await delay(500); }
  }
  throw new Error('Readiness did not recover within 10 seconds');
}

async function start(ctx, build = true) {
  checkConfig(ctx.config());
  if (build) {
    console.log('Building backend and frontend production images…');
    ctx.compose('--profile', 'app', 'build', 'backend', 'frontend');
  }
  ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'storage');
  for (let run = 0; run < 2; run++) ctx.compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head');
  ctx.compose('--profile', 'app', 'up', '-d', '--wait', '--wait-timeout', '120');
  console.log('PASS migrations twice and all six services healthy');
}

function workerProbe(ctx) {
  const result = ctx.compose('exec', '-T', 'backend', 'python', '-c',
    'from app.tasks import celery_app; r=celery_app.send_task("phase0.smoke"); assert r.get(timeout=15)=={"status":"ok"}; r.forget(); celery_app.close(); print("task-ok")');
  assert.equal(result, 'task-ok');
}

async function acceptance(ctx) {
  await smoke(ctx);
  const address = (service, port) => `http://127.0.0.1:${ctx.compose('port', service, String(port)).split(':').at(-1)}`;
  let backend = address('backend', 8000);
  let frontend = address('frontend', 3000);
  await json(`${backend}/api/v1/health`, 200);
  await json(`${backend}/api/v1/ready`, 200);
  await json(`${frontend}/api/v1/health`, 200);
  await json(`${frontend}/api/v1/ready`, 200);
  const page = await (await fetch(frontend)).text();
  assert.ok(page.includes('连接状态'));
  assert.ok(!page.includes('http://backend:8000'));
  const revision = () => ctx.compose('exec', '-T', 'postgres', 'sh', '-ec',
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT version_num FROM alembic_version"');
  assert.equal(revision(), '0001_baseline');
  const tables = ctx.compose('exec', '-T', 'postgres', 'sh', '-ec',
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT tablename FROM pg_tables WHERE schemaname=\x27public\x27"');
  assert.equal(tables, 'alembic_version', 'Phase 0 must not create business tables');
  workerProbe(ctx);
  console.log('PASS direct and proxied API, migration chain and Redis/Worker result roundtrip');

  for (const [service, key] of [['redis', 'redis'], ['postgres', 'database']]) {
    ctx.compose('stop', service);
    await json(`${backend}/api/v1/health`, 200);
    const result = await json(`${backend}/api/v1/ready`, 503);
    assert.equal(result.error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.notEqual(result.error.details[key], 'ok');
    await json(`${frontend}/api/v1/ready`, 503);
    ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', service);
    await waitReady(backend);
    await waitReady(frontend);
    if (service === 'redis') workerProbe(ctx);
    console.log(`PASS ${service} failure and recovery; health stays independent`);
  }
  ctx.compose('stop', 'backend');
  const unavailable = await json(`${frontend}/api/v1/health`, 502);
  assert.equal(unavailable.error.code, 'UPSTREAM_UNAVAILABLE');
  ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', 'backend');
  await waitReady(frontend);
  console.log('PASS upstream outage produces 502 and recovers');
  ctx.compose('--profile', 'app', 'stop');
  ctx.compose('--profile', 'app', 'up', '-d', '--wait', '--wait-timeout', '120');
  // Docker reassigns host port 0 when stopped containers restart; rediscover both URLs.
  backend = address('backend', 8000);
  frontend = address('frontend', 3000);
  await waitReady(frontend);
  assert.equal(revision(), '0001_baseline');
  workerProbe(ctx);
  const logs = ctx.compose('logs', '--no-color', 'backend', 'frontend', 'worker');
  const configured = ctx.config().services.backend.environment;
  for (const key of ['SECRET_KEY', 'ENCRYPTION_KEY', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']) {
    assert.ok(!logs.includes(configured[key]) && !page.includes(configured[key]), `${key} must not leak`);
  }
  console.log('PASS full stop/start, persisted revision and secret-free application logs');
  console.log(`Frontend: ${frontend}\nBackend: ${backend}`);
}

async function main() {
  if (!owned) {
    const ctx = context(envFile);
    if (command === 'up') { await start(ctx); console.log('Use docker compose port frontend 3000 to locate the page.'); }
    else if (command === 'smoke') { await smoke(ctx); workerProbe(ctx); console.log('PASS Worker task result and cleanup'); }
    else if (command === 'down') ctx.compose('--profile', 'app', 'down');
    else throw new Error('Commands: up, smoke, down, verify [--keep]');
    return;
  }
  const project = `p0c-verify-${randomUUID()}`;
  const cache = resolve(root, '.task-cache', 'p0c');
  mkdirSync(cache, { recursive: true });
  envFile = resolve(cache, `${project}.env`);
  writeFileSync(envFile, generatedEnv(readFileSync(resolve(root, '.env.example'), 'utf8'), project), { flag: 'wx', mode: 0o600 });
  const ctx = context(envFile, project);
  let passed = false;
  console.log(`Phase 0 project: ${project}`);
  try {
    checkConfig(ctx.config());
    console.log('Building and checking frontend and backend in CI-equivalent containers…');
    ctx.compose('--profile', 'test', 'build', 'backend-test', 'frontend-test');
    for (const service of ['backend-test', 'frontend-test']) {
      ctx.compose('run', '--rm', '--no-deps', service);
      console.log(`PASS ${service} checks`);
    }
    await start(ctx);
    await acceptance(ctx);
    passed = true;
  } finally {
    if (passed && keep) console.log(`Retained only for browser QA. Environment file: ${envFile}`);
    else {
      ctx.compose('--profile', 'app', '--profile', 'test', 'down', '--volumes', '--remove-orphans');
      unlinkSync(envFile);
      console.log('Removed the owned test containers, networks, volumes and temporary environment.');
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
