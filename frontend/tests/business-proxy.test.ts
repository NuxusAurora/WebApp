// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { proxyBusiness } from '../lib/business-proxy.server';

const environment = { BACKEND_INTERNAL_URL: 'http://backend:8000' };
describe('authenticated same-origin proxy', () => {
  it('allows only bounded same-origin section knowledge endpoints', async () => {
    const prefix = 'sections/11111111-1111-1111-1111-111111111111/knowledge-points';
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: {} }));
    const request = (body: string, headers = { 'X-Requested-With': 'structured-learning' }) => new Request('http://localhost/api/v1/' + prefix + '/generate', { method: 'POST', body, headers });
    expect((await proxyBusiness(request('{}'), (prefix + '/generate').split('/'), upstream, environment)).status).toBe(200);
    expect((await proxyBusiness(request('a'.repeat(512 * 1024 + 1)), prefix.split('/'), upstream, environment)).status).toBe(413);
    expect((await proxyBusiness(request('{}', { 'X-Requested-With': '' }), prefix.split('/'), upstream, environment)).status).toBe(403);
    expect((await proxyBusiness(new Request('http://localhost'), (prefix + '/internal').split('/'), upstream, environment)).status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('proxies the authenticated activation command only at the provider path', async () => {
    const path = 'ai/providers/11111111-1111-1111-1111-111111111111/activate';
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: {} }));
    const headers = { 'X-Requested-With': 'structured-learning' };
    const response = await proxyBusiness(new Request('http://localhost/api/v1/' + path, { method: 'POST', headers }), path.split('/'), upstream, environment);
    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][0].pathname).toBe('/api/v1/' + path);
    expect(upstream.mock.calls[0][1].method).toBe('POST');
    expect((await proxyBusiness(new Request('http://localhost/api/v1/' + path, { method: 'POST' }), path.split('/'), upstream, environment)).status).toBe(403);
    expect((await proxyBusiness(new Request('http://localhost'), (path + '/private').split('/'), upstream, environment)).status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('proxies only the fixed discovery route for a provider', async () => {
    const path = 'ai/providers/11111111-1111-1111-1111-111111111111/discovery';
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: [] }));
    const response = await proxyBusiness(new Request('http://localhost/api/v1/' + path), path.split('/'), upstream, environment);
    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0][0].pathname).toBe('/api/v1/' + path);
    expect((await proxyBusiness(new Request('http://localhost'), (path + '/private').split('/'), upstream, environment)).status).toBe(404);
  });
  it('proxies bounded curriculum images and rejects unrelated course routes', async () => {
    const prefix = 'courses/11111111-1111-1111-1111-111111111111/curriculum';
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: {} }));
    const request = (body: Uint8Array) => new Request('http://localhost/api/v1/' + prefix + '/images', {
      method: 'POST', headers: { 'X-Requested-With': 'structured-learning', 'Content-Type': 'image/png' }, body: body as BodyInit,
    });
    expect((await proxyBusiness(request(new Uint8Array(2 * 1024 * 1024)), (prefix + '/images').split('/'), upstream, environment)).status).toBe(200);
    expect((await proxyBusiness(request(new Uint8Array(5 * 1024 * 1024 + 1)), (prefix + '/images').split('/'), upstream, environment)).status).toBe(413);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await proxyBusiness(new Request('http://localhost'), (prefix + '/internal').split('/'), upstream, environment)).status).toBe(404);
  });
  it('passes local model streams through without buffering and forwards log pagination', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('data: {"done":true}\n\n', {
      headers: { 'Content-Type': 'text/event-stream', 'Authorization': 'private' },
    }));
    const request = new Request('http://localhost/api/v1/ai/calls/stream', {
      method: 'POST', body: '{}', headers: { 'X-Requested-With': 'structured-learning' },
    });
    const result = await proxyBusiness(request, ['ai', 'calls', 'stream'], upstream, environment);
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');
    expect(result.headers.has('Authorization')).toBe(false);
    expect(await result.text()).toContain('"done":true');
    const logs = vi.fn().mockResolvedValue(Response.json({ success: true, data: [] }));
    await proxyBusiness(new Request('http://localhost/api/v1/ai/calls?offset=100'), ['ai', 'calls'], logs, environment);
    expect(logs.mock.calls[0][0].searchParams.get('offset')).toBe('100');
  });
  it('forwards only the session cookie and preserves HttpOnly session responses', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: {}, error: null },
      { headers: { 'Set-Cookie': 'learning_session=opaque; HttpOnly; SameSite=Strict; Path=/' } }));
    const request = new Request('http://localhost/api/v1/auth/login', { method: 'POST', body: '{}', headers: {
      'X-Requested-With': 'structured-learning', Origin: 'http://localhost', Cookie: 'other=private; learning_session=existing',
      Authorization: 'private-value', 'Content-Type': 'application/json',
    } });
    const result = await proxyBusiness(request, ['auth', 'login'], upstream, environment);
    expect(result.status).toBe(200);
    const options = upstream.mock.calls[0][1];
    expect(options.headers.get('Cookie')).toBe('learning_session=existing');
    expect(options.headers.has('Authorization')).toBe(false);
    expect(options.headers.has('Origin')).toBe(false);
    expect(result.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects arbitrary paths, cross-origin mutations, missing custom headers and oversized bodies', async () => {
    const upstream = vi.fn();
    expect((await proxyBusiness(new Request('http://localhost'), ['admin'], upstream, environment)).status).toBe(404);
    const attempts: Record<string, string>[] = [{ Origin: 'https://evil.example', 'X-Requested-With': 'structured-learning' }, {}];
    for (const headers of attempts) {
      expect((await proxyBusiness(new Request('http://localhost', { method: 'POST', headers }), ['courses'], upstream, environment)).status).toBe(403);
    }
    const large = new Request('http://localhost', { method: 'POST', body: 'a'.repeat(32769), headers: { 'X-Requested-With': 'structured-learning' } });
    expect((await proxyBusiness(large, ['courses'], upstream, environment)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('redacts transport exceptions', async () => {
    const result = await proxyBusiness(new Request('http://localhost'), ['users', 'me'],
      vi.fn().mockRejectedValue(new Error('SECRET upstream database url')), environment);
    expect(result.status).toBe(502); expect(await result.text()).not.toContain('SECRET');
  });
  it('accepts browser origin matching Host when Next constructs an internal container URL', async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ success: true, data: null, error: null }));
    const request = new Request('http://0.0.0.0:3000/api/v1/auth/register', { method: 'POST',
      body: '{}', headers: { Host: '127.0.0.1:32805', Origin: 'http://127.0.0.1:32805',
        'X-Requested-With': 'structured-learning' } });
    expect((await proxyBusiness(request, ['auth', 'register'], upstream, environment)).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
});
