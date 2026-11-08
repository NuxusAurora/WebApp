export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init, cache: 'no-store', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'structured-learning', ...init.headers },
  });
  let body;
  try { body = await response.json(); } catch { throw new ApiError(response.status, '服务暂不可用，请重试'); }
  if (!response.ok || !body.success) throw new ApiError(response.status, body.error?.message ?? '操作失败，请重试');
  return body.data as T;
}
