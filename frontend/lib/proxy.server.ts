type Probe = 'health' | 'ready';
type Environment = Record<string, string | undefined>;
const headers = { 'Cache-Control': 'no-store' };

function failure(code: string, status = 502) {
  return Response.json({ success: false, data: null,
    error: { code, message: '暂时无法连接服务，请稍后重试', details: {} } }, { status, headers });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function proxyProbe(probe: Probe, fetcher: typeof fetch = fetch,
  environment: Environment = process.env): Promise<Response> {
  let base: URL;
  const timeout = Number(environment.BACKEND_TIMEOUT_MS ?? '3000');
  try {
    base = new URL(environment.BACKEND_INTERNAL_URL ?? '');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || base.pathname !== '/' || !Number.isInteger(timeout) ||
      timeout < 50 || timeout > 10000) throw new Error('Invalid server configuration');
  } catch { return failure('CONFIGURATION_ERROR', 503); }

  try {
    const upstream = await fetcher(new URL(`/api/v1/${probe}`, base), {
      cache: 'no-store', signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    const body: unknown = await upstream.json();
    if (!object(body)) return failure('UPSTREAM_INVALID_RESPONSE');
    if (upstream.status === 200 && body.success === true && body.error === null && object(body.data)) {
      if (probe === 'health' && body.data.status === 'ok') {
        return Response.json({ success: true, data: { status: 'ok' }, error: null }, { headers });
      }
      if (probe === 'ready' && body.data.status === 'ready' && body.data.database === 'ok' && body.data.redis === 'ok') {
        return Response.json({ success: true, data: { status: 'ready', database: 'ok', redis: 'ok' }, error: null }, { headers });
      }
    }
    if (probe === 'ready' && upstream.status === 503 && body.success === false && body.data === null &&
      object(body.error) && body.error.code === 'DEPENDENCY_UNAVAILABLE' && object(body.error.details)) {
      const { database, redis } = body.error.details;
      const states = ['ok', 'timeout', 'unavailable'];
      if (states.includes(String(database)) && states.includes(String(redis))) {
        return Response.json({ success: false, data: null, error: {
          code: 'DEPENDENCY_UNAVAILABLE', message: '依赖服务暂不可用', details: { database, redis },
        } }, { status: 503, headers });
      }
    }
    return failure('UPSTREAM_INVALID_RESPONSE');
  } catch { return failure('UPSTREAM_UNAVAILABLE'); }
}
