import { MAX_IMAGE_BYTES } from './image-limits';

const allowed = /^(auth\/(register|login|test-login|logout|verify-email|resend-verification|forgot-password|reset-password|change-password)|users\/me|ai\/(options|providers(?:\/[0-9a-f-]{36}(?:\/(key|models|discovery|activate))?)?|models\/[0-9a-f-]{36}(?:\/test)?|calls(?:\/stream)?)|courses(?:\/[0-9a-f-]{36}(?:\/uploads(?:\/[0-9a-f-]{36}(?:\/download)?)?)?)?)$/;
const curriculumAllowed = /^courses\/[0-9a-f-]{36}\/curriculum(?:\/(images|ocr|parse|drafts|confirm))?$/;
const learningAllowed = /^learning\/projects(?:\/[0-9a-f-]{36}\/open)?$/;
const teachingAllowed = /^learning\/conversations\/[0-9a-f-]{36}\/(?:turns|lesson)$/;
const textbookAllowed = /^learning\/projects\/textbooks(?:\/[0-9a-f-]{36})?$/;
const textbookPath = 'learning/projects/textbooks';
const knowledgeAllowed = /^sections\/[0-9a-f-]{36}\/knowledge-points(?:\/(generate|drafts|confirm))?$/;

export async function proxyBusiness(request: Request, segments: string[], fetcher: typeof fetch = fetch,
  environment: Record<string, string | undefined> = process.env) {
  const fail = (status: number, message: string) => Response.json({ success: false, data: null,
    error: { code: 'REQUEST_FAILED', message, details: {} } }, { status, headers: { 'Cache-Control': 'no-store' } });
  const path = segments.join('/');
  const teaching = teachingAllowed.test(path);
  const mutation = !['GET', 'HEAD'].includes(request.method);
  if (textbookAllowed.test(path)) {
    if (mutation && (path === textbookPath || !['PUT', 'DELETE'].includes(request.method))) return fail(405, '此教材路径不支持该操作');
  } else if (!allowed.test(path) && !curriculumAllowed.test(path) && !knowledgeAllowed.test(path) && !learningAllowed.test(path) && !teaching) return fail(404, '页面不存在');
  const origin = request.headers.get('Origin');
  let sameOrigin = !origin;
  if (origin) {
    try {
      const source = new URL(origin);
      // Next's standalone Request URL can use its container hostname/port. Host retains
      // the browser-facing authority. Never accept arbitrary X-Forwarded-Host values.
      sameOrigin = ['http:', 'https:'].includes(source.protocol) && !source.username &&
        !source.password && source.host === (request.headers.get('Host') ?? new URL(request.url).host);
    } catch { sameOrigin = false; }
  }
  if (mutation && (request.headers.get('X-Requested-With') !== 'structured-learning' ||
    !sameOrigin)) {
    return fail(403, '请求来源无效');
  }
  let base: URL;
  try {
    base = new URL(environment.BACKEND_INTERNAL_URL ?? '');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) throw new Error('configuration');
  } catch { return fail(503, '服务尚未配置'); }
  const headers = new Headers({ 'X-Requested-With': 'structured-learning' });
  for (const name of ['Content-Type', 'X-Filename']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = request.headers.get('Cookie')?.split(';').map(x => x.trim())
    .find(x => x.startsWith('learning_session='));
  if (cookie) headers.set('Cookie', cookie);
  try {
    let body: Uint8Array | undefined;
    if (mutation && request.body) {
      const limit = path.endsWith('/curriculum/images') ? MAX_IMAGE_BYTES : path.includes('/curriculum') || knowledgeAllowed.test(path) ? 512 * 1024 : path.endsWith('/uploads') ? 1024 * 1024 : 32768;
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) { await reader.cancel(); return fail(413, '请求内容过大'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    }
    const url = new URL(`/api/v1/${path}`, base);
    const query = new URL(request.url).searchParams;
    const offset = query.get('offset');
    if (['courses', 'ai/calls'].includes(path) && offset) url.searchParams.set('offset', offset);
    const before = query.get('before');
    if ((path.endsWith('/turns') || ['learning/projects', 'learning/projects/textbooks'].includes(path)) && before) url.searchParams.set('before', before);
    const response = await fetcher(url, { method: request.method, headers, body: body as BodyInit,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(teaching || path.startsWith('ai/') || path.includes('/curriculum') || knowledgeAllowed.test(path) ? 185000 : 15000)]) });
    if (path === 'ai/calls/stream' && response.ok && response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      return new Response(response.body, { status: 200, headers: { 'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    }
    const payload = await response.json();
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    for (const cookie of response.headers.getSetCookie()) {
      if (cookie.startsWith('learning_session=')) outgoing.append('Set-Cookie', cookie);
    }
    return Response.json(payload, { status: response.status, headers: outgoing });
  } catch { return fail(502, '暂时无法连接服务，请重试'); }
}
