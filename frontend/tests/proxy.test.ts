import { describe, expect, it, vi } from 'vitest';
import { proxyProbe } from '../lib/proxy.server';
const environment = { BACKEND_INTERNAL_URL: 'http://private-backend:8000', BACKEND_TIMEOUT_MS: '50' };
const success = { success: true, data: { status: 'ready', database: 'ok', redis: 'ok' }, error: null };

describe('same-origin proxy', () => {
  it('forwards without caching and strips unexpected upstream data', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...success, secret: 'private-token' }));
    const response = await proxyProbe('ready', fetcher, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(success);
    expect(fetcher.mock.calls[0][0].href).toBe('http://private-backend:8000/api/v1/ready');
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
  });
  it('preserves dependency 503 and sanitizes messages and details', async () => {
    const response = await proxyProbe('ready', vi.fn().mockResolvedValue(Response.json({
      success: false, data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'private-token',
        details: { database: 'unavailable', redis: 'ok', connection: 'private-token' } },
    }, { status: 503 })), environment);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.details).toEqual({ database: 'unavailable', redis: 'ok' });
    expect(JSON.stringify(body)).not.toContain('private-token');
  });
  it('returns sanitized 502 for connection errors', async () => {
    const response = await proxyProbe('health', vi.fn().mockRejectedValue(new Error('private-token')), environment);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
  it('aborts a slow upstream with a finite timeout', async () => {
    const fetcher = vi.fn((_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const response = await proxyProbe('health', fetcher as typeof fetch, environment);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
  it('rejects malformed upstream data and invalid configuration', async () => {
    const response = await proxyProbe('ready', vi.fn().mockResolvedValue(Response.json({ success: true, data: {} })), environment);
    expect(response.status).toBe(502);
    const fetcher = vi.fn();
    expect((await proxyProbe('health', fetcher, { BACKEND_INTERNAL_URL: 'http://secret:password@backend' })).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
