// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { proxyBusiness } from '../lib/business-proxy.server';

const environment = { BACKEND_INTERNAL_URL: 'http://backend:8000' };
describe('authenticated same-origin proxy', () => {
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
