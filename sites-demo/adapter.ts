export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const STORAGE_KEY = 'learning-workbench-public:v1';
type Course = { id: string; title: string; subject: string; textbook: string; learning_goal: string; status: string; created_at: string; updated_at: string };
type Material = { id: string; courseId: string; filename: string; text: string; size: number };
type State = { version: 1; signedIn: boolean; name: string; courses: Course[]; files: Material[] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const missing = () => new ApiError(404, '内容不存在');
const seed = (): State => ({ version: 1, signedIn: false, name: '学习体验者', courses: [
  { id: '215cc089-54f0-48b2-90f4-70ae0aae0011', title: '高等数学', subject: '数学', textbook: '微积分学习笔记', learning_goal: '多学一点', status: 'active', created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z' },
  { id: '215cc089-54f0-48b2-90f4-70ae0aae0012', title: 'Python 编程入门', subject: '计算机科学', textbook: 'Python 基础练习', learning_goal: '及格就好', status: 'active', created_at: '2026-11-02T09:00:00Z', updated_at: '2026-11-02T09:00:00Z' },
  { id: '215cc089-54f0-48b2-90f4-70ae0aae0013', title: '世界近代史', subject: '历史', textbook: '近代史读书札记', learning_goal: '大师之境', status: 'archived', created_at: '2026-10-20T09:00:00Z', updated_at: '2026-10-20T09:00:00Z' },
], files: [{ id: '215cc089-54f0-48b2-90f4-70ae0aae0021', courseId: '215cc089-54f0-48b2-90f4-70ae0aae0011', filename: '学习说明.txt', text: '这是公开体验版的示例资料。\n你可以创建课程、修改学习目标并添加自己的文本笔记。\n所有改动只保存在当前浏览器，不会同步到云端。\n', size: 0 }] });

function validState(value: unknown): value is State {
  if (!value || typeof value !== 'object') return false;
  const state = value as State;
  return state.version === 1 && typeof state.signedIn === 'boolean' && typeof state.name === 'string' &&
    Array.isArray(state.courses) && state.courses.every(c => c && ['id','title','subject','textbook','learning_goal','status','created_at','updated_at'].every(k => typeof c[k as keyof Course] === 'string') && ['active','archived'].includes(c.status)) &&
    Array.isArray(state.files) && state.files.every(f => f && ['id','courseId','filename','text'].every(k => typeof f[k as keyof Material] === 'string') && Number.isSafeInteger(f.size) && f.size >= 0);
}

export function createDemoApi(storage: Storage, downloads = {
  create: (blob: Blob) => URL.createObjectURL(blob),
  release: (url: string) => { setTimeout(() => URL.revokeObjectURL(url), 60_000); },
}) {
  function load(): State {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) { const value = seed(); value.files[0].size = new TextEncoder().encode(value.files[0].text).length; return value; }
      const value: unknown = JSON.parse(raw);
      if (!validState(value)) throw Error('Invalid state');
      return value;
    } catch { throw new ApiError(503, '浏览器数据无法读取，请使用顶部“重置体验”或允许网站存储。'); }
  }
  function save(state: State) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { throw new ApiError(507, '浏览器存储空间不足或已禁用，改动未保存。请删除部分资料后重试。'); }
  }
  const user = (state: State) => ({ id: 'demo-browser-user', email: 'visitor@example.invalid', display_name: state.name, email_verified: true, role: 'user' });
  return async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    init.signal?.throwIfAborted();
    const method = init.method?.toUpperCase() ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    let uploadedText: string | undefined;
    if (init.body instanceof Blob) {
      if (!init.body.size || init.body.size > 1024 * 1024) throw new ApiError(422, '请选择 1 字节至 1 MiB 的 UTF-8 .txt 文件。');
      try { uploadedText = new TextDecoder('utf-8', {fatal: true}).decode(await init.body.arrayBuffer()); }
      catch { throw new ApiError(422, '文件必须为 UTF-8 文本。'); }
    }
    init.signal?.throwIfAborted();
    const state = load();
    if (path === 'auth/test-login' && method === 'POST') { state.signedIn = true; save(state); return user(state) as T; }
    if (path === 'auth/logout' && method === 'POST') { state.signedIn = false; save(state); return null as T; }
    if (path.startsWith('auth/')) throw new ApiError(422, '公开体验版不提供真实注册、邮箱或密码操作。');
    if (!state.signedIn) throw new ApiError(401, '请先点击测试登录。');
    if (path === 'users/me') {
      if (method === 'GET') return user(state) as T;
      if (method === 'PATCH') {
        if (typeof body?.display_name !== 'string' || !body.display_name.trim() || body.display_name.length > 80) throw new ApiError(422, '昵称需为 1–80 个字符。');
        state.name = body.display_name.trim(); save(state); return user(state) as T;
      }
      throw missing();
    }
    const url = new URL(path, 'https://demo.invalid/');
    if (url.origin !== 'https://demo.invalid') throw missing();
    const segments = url.pathname.slice(1).split('/');
    if (segments[0] !== 'courses' || segments.length > 5) throw missing();
    const course = state.courses.find(c => c.id === segments[1]);
    if (segments.length > 1 && !course) throw missing();
    if (segments.length <= 2) {
      if (method === 'GET') {
        if (course) return structuredClone(course) as T;
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(422, '分页参数无效');
        return state.courses.slice(offset, offset + 100) as T;
      }
      if (method === 'DELETE' && course) {
        state.courses = state.courses.filter(c => c.id !== course.id); state.files = state.files.filter(f => f.courseId !== course.id); save(state); return null as T;
      }
      if (method === 'POST' && !course || method === 'PATCH' && course) {
        const next = { ...course, ...body };
        for (const key of ['title','subject','textbook','learning_goal']) {
          if (typeof next[key] !== 'string' || next[key].length > (key === 'learning_goal' ? 4000 : 200)) throw new ApiError(422, '课程字段内容无效。');
        }
        if (!next.title.trim() || !['active','archived'].includes(next.status ?? 'active')) throw new ApiError(422, '请填写课程名称并选择有效状态。');
        const saved: Course = { id: course?.id ?? crypto.randomUUID(), title: next.title.trim(), subject: next.subject, textbook: next.textbook, learning_goal: next.learning_goal, status: next.status ?? 'active', created_at: course?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
        state.courses = course ? state.courses.map(c => c.id === course.id ? saved : c) : [saved, ...state.courses];
        save(state); return saved as T;
      }
      throw missing();
    }
    if (segments[2] !== 'uploads') throw missing();
    const metadata = (f: Material) => ({id: f.id, filename: f.filename, size: f.size});
    if (segments.length === 3) {
      if (method === 'GET') return state.files.filter(f => f.courseId === course!.id).map(metadata) as T;
      if (method === 'POST' && uploadedText !== undefined) {
        let filename: string;
        try { filename = decodeURIComponent(new Headers(init.headers).get('X-Filename') ?? ''); } catch { throw new ApiError(422, '文件名无效'); }
        if (!/\.txt$/i.test(filename) || filename.length > 200 || /[\\/\x00-\x1f]/.test(filename)) throw new ApiError(422, '请选择有效的 .txt 文件。');
        const file = {id: crypto.randomUUID(), courseId: course!.id, filename, text: uploadedText, size: new TextEncoder().encode(uploadedText).length};
        state.files.unshift(file); save(state); return metadata(file) as T;
      }
      throw missing();
    }
    const file = state.files.find(f => f.id === segments[3] && f.courseId === course!.id);
    if (!file) throw missing();
    if (segments.length === 4 && method === 'DELETE') { state.files = state.files.filter(f => f.id !== file.id); save(state); return null as T; }
    if (segments.length === 5 && segments[4] === 'download' && method === 'GET') {
      const url = downloads.create(new Blob([file.text], {type: 'text/plain;charset=utf-8'})); downloads.release(url); return {url} as T;
    }
    throw missing();
  };
}

const browserStorage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
export const api = createDemoApi(browserStorage);
