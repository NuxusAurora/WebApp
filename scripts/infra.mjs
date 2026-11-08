import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = ['postgres', 'redis', 'storage'];

export function generatedEnv(template, project) {
  const values = {
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    SECRET_KEY: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64url') + '=',
    STORAGE_ACCESS_KEY: randomBytes(12).toString('hex'),
    STORAGE_SECRET_KEY: randomBytes(24).toString('hex'),
  };
  let result = template.replace(/__([A-Z_]+)__/g, (_, key) => {
    assert.ok(values[key], `Unknown template variable ${key}`);
    return values[key];
  });
  if (project) {
    assert.match(project, /^p0c-verify-[a-f0-9-]+$/);
    result = result.replace(/^COMPOSE_PROJECT_NAME=.*$/m, `COMPOSE_PROJECT_NAME=${project}`)
      .replace(/^(STORAGE_PORT|FRONTEND_PORT|BACKEND_PORT)=.*$/gm, '$1=0');
  }
  return result;
}

// Minimal SigV4 for the fixed path-style, no-query S3 smoke requests below.
// This is verification tooling; application storage access belongs to backend/.
export function signedHeaders(method, url, body, access, secret, region, now = new Date()) {
  assert.equal(url.search, '', 'Smoke requests must not contain query strings');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = hash(body);
  const names = 'host;x-amz-content-sha256;x-amz-date';
  const headers = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
  const request = [method, url.pathname, '', headers, names, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key)
    .update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(request)}`).digest('hex');
  return {
    'x-amz-date': date,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
  };
}

export function docker(args) {
  const result = spawnSync('docker', args, {
    cwd: root, encoding: 'utf8', timeout: 240_000, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  // Never forward raw Compose config or daemon diagnostics containing environment values.
  if (result.error || result.status !== 0) {
    throw new Error(`Docker command failed (${args.slice(0, 1).join(' ')}; exit ${result.status ?? 'unavailable'}). Check Docker Desktop, image access and RUNBOOK.md.`);
  }
  return result.stdout.trim();
}

export function context(envFile, project) {
  const args = ['compose', '--env-file', envFile];
  if (project) args.push('--project-name', project);
  const compose = (...tail) => docker([...args, ...tail]);
  return { compose, config: () => JSON.parse(compose('--profile', 'app', 'config', '--format', 'json')) };
}

export function checkConfig(config) {
  for (const name of ['frontend', 'backend', 'worker', ...dependencies]) {
    assert.ok(config.services[name], `Missing service: ${name}`);
  }
  for (const name of ['postgres', 'redis']) {
    assert.equal(config.services[name].ports, undefined, `${name} must not publish host ports`);
    assert.deepEqual(Object.keys(config.services[name].networks), ['data']);
  }
  assert.equal(config.networks.data.internal, true);
  const frontendEnv = config.services.frontend.environment;
  assert.deepEqual(Object.keys(frontendEnv).sort(), ['BACKEND_INTERNAL_URL', 'BACKEND_TIMEOUT_MS']);
  for (const service of Object.values(config.services)) {
    for (const value of Object.values(service.environment ?? {})) {
      assert.ok(!String(value).includes('__'), 'Generate environment secrets before starting');
    }
    for (const port of service.ports ?? []) {
      assert.equal(port.host_ip, '127.0.0.1', 'Development ports must bind to loopback');
    }
  }
  for (const name of dependencies) {
    assert.match(config.services[name].image, /@sha256:[a-f0-9]{64}$/, 'Dependency images must be pinned by digest');
  }
}

export async function smoke({ compose, config }) {
  const settings = config();
  checkConfig(settings);
  const sql = compose('exec', '-T', 'postgres', 'sh', '-ec',
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT 1"');
  assert.equal(sql, '1', 'PostgreSQL authenticated SELECT 1');
  console.log('PASS PostgreSQL authenticated connection');

  const key = `p0c-smoke:${randomUUID()}`;
  try {
    assert.equal(compose('exec', '-T', 'redis', 'redis-cli', 'SET', key, 'p0c', 'EX', '30'), 'OK');
    assert.equal(compose('exec', '-T', 'redis', 'redis-cli', '--raw', 'GET', key), 'p0c');
  } finally {
    compose('exec', '-T', 'redis', 'redis-cli', 'DEL', key);
  }
  assert.equal(compose('exec', '-T', 'redis', 'redis-cli', 'EXISTS', key), '0');
  console.log('PASS Redis write/read/delete');

  const port = compose('port', 'storage', '9000').split('\n')[0].split(':').at(-1);
  assert.match(port, /^\d+$/);
  const credentials = settings.services.backend.environment;
  const bucket = `p0c-smoke-${randomUUID()}`;
  const objectPath = `/${bucket}/probe.txt`;
  const payload = `isolated verification ${randomUUID()}\n`;
  async function request(method, path, body = '') {
    const url = new URL(`http://127.0.0.1:${port}${path}`);
    return fetch(url, {
      method,
      headers: signedHeaders(method, url, body, credentials.STORAGE_ACCESS_KEY,
        credentials.STORAGE_SECRET_KEY, credentials.STORAGE_REGION),
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
  }
  try {
    const created = await request('PUT', `/${bucket}`);
    assert.equal(created.status, 200, 'Create isolated S3 bucket');
    const written = await request('PUT', objectPath, payload);
    assert.equal(written.status, 200, 'Write S3 object');
    const read = await request('GET', objectPath);
    assert.equal(read.status, 200);
    assert.equal(await read.text(), payload, 'S3 roundtrip bytes');
    assert.equal((await request('DELETE', objectPath)).status, 204);
    assert.equal((await request('HEAD', objectPath)).status, 404, 'Deleted object must be absent');
    console.log('PASS S3 create/write/read/delete and absence check');
  } finally {
    // Delete only our UUID paths even when a write timed out after reaching the server.
    assert.ok([204, 404].includes((await request('DELETE', objectPath)).status), 'Clean test object');
    assert.ok([204, 404].includes((await request('DELETE', `/${bucket}`)).status), 'Remove test bucket');
  }
  console.log('PASS test bucket removed');
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  let envFile = resolve(root, '.env');
  let project;
  for (let index = 0; index < flags.length; index += 2) {
    assert.ok(flags[index + 1], 'Each flag needs a value');
    if (flags[index] === '--env-file') envFile = resolve(flags[index + 1]);
    else if (flags[index] === '--project') {
      project = flags[index + 1];
      assert.match(project, /^[a-z0-9][a-z0-9_-]*$/);
    } else throw new Error('Supported flags: --env-file PATH, --project NAME');
  }
  const template = () => readFileSync(resolve(root, '.env.example'), 'utf8');
  if (command === 'init') {
    writeFileSync(envFile, generatedEnv(template()), { flag: 'wx', mode: 0o600 });
    console.log('Created local environment without overwriting existing values.');
    return;
  }
  if (command === 'verify') {
    assert.equal(flags.length, 0, 'verify owns its temporary project and accepts no flags');
    const ownedProject = `p0c-verify-${randomUUID()}`;
    const cache = resolve(root, '.task-cache', 'p0c');
    mkdirSync(cache, { recursive: true });
    const ownedEnv = resolve(cache, `${ownedProject}.env`);
    writeFileSync(ownedEnv, generatedEnv(template(), ownedProject), { flag: 'wx', mode: 0o600 });
    const ctx = context(ownedEnv, ownedProject);
    console.log(`Verification project: ${ownedProject}`);
    try {
      checkConfig(ctx.config());
      console.log('PASS Compose isolation and credential boundaries');
      ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', ...dependencies);
      await smoke(ctx);
      ctx.compose('stop', ...dependencies);
      ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', ...dependencies);
      await smoke(ctx);
      console.log('PASS stop/start recovery');
    } finally {
      // Only the UUID project created by this invocation may lose its volumes.
      // Preserve its env file if cleanup fails so operators can recover it.
      ctx.compose('down', '--volumes', '--remove-orphans');
      unlinkSync(ownedEnv);
      console.log('Removed this verification project, networks and volumes.');
    }
    return;
  }
  assert.ok(existsSync(envFile), 'Run node scripts/infra.mjs init first');
  const ctx = context(envFile, project);
  if (command === 'check') {
    checkConfig(ctx.config());
    console.log('PASS Compose isolation and credential boundaries');
  } else if (command === 'up') {
    checkConfig(ctx.config());
    ctx.compose('up', '-d', '--wait', '--wait-timeout', '120', ...dependencies);
    console.log('Dependencies are healthy.');
  } else if (command === 'smoke') await smoke(ctx);
  else if (command === 'down') {
    ctx.compose('--profile', 'app', 'down');
    console.log('Stopped project; persistent volumes retained.');
  } else throw new Error('Commands: init, check, up, smoke, down, verify');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
