import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { generatedEnv, signedHeaders } from './infra.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(resolve(root, '.env.example'), 'utf8');
const value = (env, key) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))[1];

test('local secrets are unique, database credentials agree, encryption key is 32 bytes', () => {
  const env = generatedEnv(template);
  const next = generatedEnv(template);
  assert.ok(!env.includes('__POSTGRES_PASSWORD__'));
  assert.ok(value(env, 'DATABASE_URL').includes(`:${value(env, 'POSTGRES_PASSWORD')}@`));
  assert.equal(Buffer.from(value(env, 'ENCRYPTION_KEY'), 'base64url').length, 32);
  for (const key of ['POSTGRES_PASSWORD', 'SECRET_KEY', 'ENCRYPTION_KEY', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']) {
    assert.notEqual(value(env, key), value(next, key));
  }
});

test('verification isolates names and asks Docker for ephemeral ports', () => {
  const project = `p0c-verify-${randomUUID()}`;
  const env = generatedEnv(template, project);
  assert.equal(value(env, 'COMPOSE_PROJECT_NAME'), project);
  for (const key of ['STORAGE_PORT', 'FRONTEND_PORT', 'BACKEND_PORT']) assert.equal(value(env, key), '0');
  assert.throws(() => generatedEnv(template, 'structured-learning'));
});

test('init refuses to overwrite credentials and never prints generated secrets', () => {
  const cache = resolve(root, '.task-cache', 'p0c');
  mkdirSync(cache, { recursive: true });
  const path = resolve(cache, `test-${randomUUID()}.env`);
  const run = () => spawnSync(process.execPath,
    ['--', resolve(root, 'scripts/infra.mjs'), 'init', '--env-file', path], { encoding: 'utf8', windowsHide: true });
  try {
    const first = run();
    assert.equal(first.status, 0);
    const before = readFileSync(path, 'utf8');
    const second = run();
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(path, 'utf8'), before);
    for (const key of ['POSTGRES_PASSWORD', 'SECRET_KEY', 'STORAGE_SECRET_KEY']) {
      assert.ok(!(first.stdout + first.stderr + second.stdout + second.stderr).includes(value(before, key)));
    }
  } finally { if (existsSync(path)) unlinkSync(path); }
});

test('S3 signatures bind request bytes, host port and credential scope', () => {
  const date = new Date('2026-11-08T10:00:00Z');
  const url = new URL('http://127.0.0.1:19000/test/probe.txt');
  const sign = (body, endpoint = url) => signedHeaders('PUT', endpoint, body, 'access', 'secret', 'us-east-1', date);
  const first = sign('first');
  assert.equal(first['x-amz-date'], '20261108T100000Z');
  assert.match(first.Authorization, /Credential=access\/20261108\/us-east-1\/s3\/aws4_request/);
  assert.notEqual(first.Authorization, sign('second').Authorization);
  assert.notEqual(first.Authorization, sign('first', new URL('http://127.0.0.1:29000/test/probe.txt')).Authorization);
  assert.throws(() => sign('', new URL('http://localhost/test?x=1')));
});

test('storage has a host-facing network while databases remain internal', () => {
  const cache = resolve(root, '.task-cache', 'p0c');
  mkdirSync(cache, { recursive: true });
  const path = resolve(cache, `network-${randomUUID()}.env`);
  const init = spawnSync(process.execPath,
    ['--', resolve(root, 'scripts/infra.mjs'), 'init', '--env-file', path], { encoding: 'utf8', windowsHide: true });
  try {
    assert.equal(init.status, 0);
    const result = spawnSync('docker', ['compose', '--env-file', path, '--profile', 'app', 'config', '--format', 'json'],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0);
    const config = JSON.parse(result.stdout);
    const hostFacing = Object.keys(config.services.storage.networks).some(name => !config.networks[name].internal);
    assert.ok(hostFacing, 'Docker needs a non-internal network for the published S3 port');
    for (const name of ['postgres', 'redis']) {
      assert.ok(!config.services[name].ports);
      assert.ok(Object.keys(config.services[name].networks).every(network => config.networks[network].internal));
    }
  } finally { if (existsSync(path)) unlinkSync(path); }
});
