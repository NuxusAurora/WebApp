// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurriculumEditor } from '../components/curriculum';
import type { Curriculum, Version } from '../lib/curriculum';
import { WorkspaceOperations } from '../lib/workspace-operations';

const courseId = '11111111-1111-1111-1111-111111111111';
const payload = { chapters: [{ id: 'tmp-c1', title: '第一章 函数与极限', sections: [{ id: 'tmp-s1', title: '1.1 映射与函数' }] }] };
const version: Version = { id: 'v1', status: 'DRAFT', revision: 1, base_course_revision: 0,
  applied_course_revision: null, payload, change_summary: { added: [{ id: 'tmp-c1', title: '第一章 函数与极限' }], modified: [], archived: [] },
  source: { kind: 'manual' }, created_at: '2026-11-08T12:00:00Z' };
const empty: Curriculum = { curriculum: { chapters: [] }, confirmed_revision: 0, versions: [] };
const visionProvider = { id: 'provider', provider_name: '视觉模型', enabled: true,
  models: [{ id: 'model', model_name: 'vision-model', enabled: true, capabilities: { vision: true } }] };
function renameChapter() {
  fireEvent.contextMenu(screen.getByRole('button', { name: /^章节 1 / }));
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
}
const success = (data: unknown) => Promise.resolve(Response.json({ success: true, data }));
function renderCurriculum(onDirtyChange = vi.fn()) {
  return render(<CurriculumEditor courseId={courseId} onDirtyChange={onDirtyChange} />, { wrapper: WorkspaceOperations });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('reviewed curriculum', () => {
  it('shows only an upload button for an empty curriculum', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    expect(screen.getByText('拍摄你的教材目录，然后上传')).toBeVisible();
    expect(screen.queryByRole('button', { name: '生成具体知识点' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['上传']);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/已确认目录|尚未确认目录|导入目录|解析模型|PNG \/ JPEG/)).not.toBeInTheDocument();
  });

  it('uploads through the existing image endpoint and reports failures without losing retry access', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => init?.method === 'POST' ?
      Promise.resolve(Response.json({ success: false, error: { message: '上传失败，请重试' } }, { status: 503 })) :
      url.endsWith('ai/providers') ? success([visionProvider]) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    const file = new File(['image'], '目录.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('上传目录图片'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('上传失败，请重试');
    expect(screen.getByRole('button', { name: '上传' })).toBeEnabled();
    const request = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(request[0]).toBe('/api/v1/courses/' + courseId + '/curriculum/images');
    expect(request[1]?.body).toBe(file);
    expect(request[1]?.headers).toMatchObject({ 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('目录.png') });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/parse') || url.endsWith('/confirm'))).toBe(false);
  });

  it('automatically resumes the latest draft and omits historical selection and metadata', async () => {
    const latest = { ...version, id: 'latest', payload: { chapters: [{ id: 'tmp-new', title: '当前草稿', sections: [] }] },
      source: { kind: 'ai', model_name: 'private-model-name' } };
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, versions: [{ ...version, status: 'CONFIRMED' }, latest, version] })));
    const { unmount } = renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 当前草稿' });
    expect(screen.queryByLabelText('历史与草稿')).not.toBeInTheDocument();
    expect(screen.queryByText(/草稿修订|private-model-name/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '章节 1 函数与极限' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑' }));
    expect(screen.queryByRole('button', { name: '章节 1 当前草稿' })).not.toBeInTheDocument();
    unmount();
    renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 当前草稿' });
  });
  it('keeps inline rename alive when a confirmed outline first becomes a draft', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, curriculum: payload })));
    renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    renameChapter();
    const input = screen.getByRole('textbox', { name: '章节 1标题' });
    fireEvent.change(input, { target: { value: '重命名章节' } });
    expect(screen.getByRole('textbox', { name: '章节 1标题' })).toHaveValue('重命名章节');
    expect(screen.queryByLabelText('选中标题编辑')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '章节 1 重命名章节' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  });
  it('uploads and automatically uses the first enabled vision model without local OCR or automatic confirmation', async () => {
    const files = ['目录第2页.jpg', '目录第1页.png', '目录第3页.png', '目录第4页.png', '目录第5页.png']
      .map(name => new File(['image'], name, { type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }));
    const photoIds = ['z', 'a', 'e', 'b', 'c'];
    let saved = false;
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/providers') ? success([
      { ...visionProvider, id: 'disabled', enabled: false },
      { ...visionProvider, id: 'text', models: [{ id: 'text-model', enabled: true, capabilities: {} }] }, visionProvider,
    ]) : url.endsWith('/images') ? success({ id: photoIds[files.indexOf(init?.body as File)] }) :
      url.endsWith('/parse') ? (saved = true, success(version)) : success({ ...empty, versions: saved ? [version] : [] }));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    const picker = screen.getByLabelText('上传目录图片');
    expect(picker).toHaveAttribute('multiple');
    fireEvent.change(picker, { target: { files } });
    await screen.findByText('草稿已生成，请核对后确认');
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([url]) => url.split('/').at(-1))).toEqual(['images', 'images', 'images', 'images', 'images', 'parse']);
    expect(posts.slice(0, -1).map(([, init]) => init?.body)).toEqual(files);
    expect(JSON.parse(String(posts.at(-1)?.[1]?.body))).toEqual({
      input_mode: 'images', image_ids: photoIds, ocr_text: '', provider_id: 'provider', model_id: 'model',
    });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/ocr') || url.endsWith('/confirm'))).toBe(false);
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('validates the entire batch before uploading any image', async () => {
    const fetcher = vi.fn((url: string, _init?: RequestInit) =>
      url.endsWith('ai/providers') ? success([visionProvider]) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    const picker = screen.getByLabelText('上传目录图片');
    const pages = Array.from({ length: 6 }, (_, index) => new File(['image'], `目录${index}.png`));
    fireEvent.change(picker, { target: { files: pages } });
    expect(await screen.findByRole('alert')).toHaveTextContent('一次最多选择 5 张图片');
    fireEvent.change(picker, { target: { files: [pages[0], new File([], '空文件.png')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('第 2 张图片须为 1 字节至 50 MiB');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('stops a batch when one page fails and keeps the previous draft available', async () => {
    let uploads = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('/images')) {
        uploads++;
        if (uploads === 2) return Promise.resolve(Response.json(
          { success: false, error: { message: '图片格式无效' } }, { status: 400 },
        ));
        return success({ id: 'photo' });
      }
      return url.endsWith('ai/providers') ? success([visionProvider]) : success({ ...empty, versions: [version] });
    });
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    fireEvent.change(screen.getByLabelText('上传目录图片'), {
      target: { files: ['1.png', '2.png', '3.png'].map(name => new File(['image'], name)) },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('第 2 张图片上传失败。图片格式无效');
    expect(uploads).toBe(2);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/parse'))).toBe(false);
    expect(screen.getByRole('button', { name: '章节 1 函数与极限' })).toBeVisible();
    expect(screen.getByRole('button', { name: '上传' })).toBeEnabled();
  });

  it.each([
    ['目录.jpg', 'image/jpeg'], ['目录.JPG', ''],
    ['目录.webp', 'image/webp'], ['目录.bmp', 'image/bmp'], ['目录.gif', 'image/gif'],
    ['目录.tiff', 'image/tiff'], ['目录.avif', 'image/avif'], ['目录.TIF', ''],
  ])('uploads %s and uses the existing image parsing flow', async (name, type) => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/providers') ? success([visionProvider]) :
      url.endsWith('/images') ? success({ id: 'photo', filename: name }) :
      url.endsWith('/parse') ? success(version) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    const input = screen.getByLabelText('上传目录图片');
    expect(input.getAttribute('accept')?.split(',')).toContain('.' + name.split('.').at(-1)!.toLowerCase());
    const file = new File(['image'], name, { type });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText('草稿已生成，请核对后确认');
    const request = fetcher.mock.calls.find(([url]) => url.endsWith('/images'))!;
    expect(request[1]?.body).toBe(file);
    expect(request[1]?.headers).toMatchObject({ 'Content-Type': type || 'application/octet-stream' });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
  });

  it('does not send images to a model without confirmed vision capability', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/providers') ? success([{ id: 'p', provider_name: '文字', enabled: true,
      models: [{ id: 'm', model_name: 'text-model', enabled: true }] }]) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    fireEvent.change(screen.getByLabelText('上传目录图片'), { target: { files: [new File(['image'], '目录.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('请先在模型设置中启用支持图片的模型。');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/images') || url.endsWith('/parse'))).toBe(false);
  });

  it('accepts exactly 50 MiB and rejects a larger image before uploading', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/providers') ? success([visionProvider]) :
      url.endsWith('/images') ? success({ id: 'photo', filename: '目录.png' }) :
      url.endsWith('/parse') ? success(version) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '上传' });
    const file = new File(['image'], '目录.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1, configurable: true });
    fireEvent.change(screen.getByLabelText('上传目录图片'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('50 MiB');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/images') || url.endsWith('/parse'))).toBe(false);
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('上传目录图片'), { target: { files: [file] } });
    await screen.findByText('草稿已生成，请核对后确认');
  });

  it('keeps the previous draft and allows another upload when model parsing fails', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/providers') ? success([visionProvider]) :
      url.endsWith('/images') ? success({ id: 'photo', filename: '目录.png' }) : url.endsWith('/parse') ?
        Promise.resolve(Response.json({ success: false, error: { message: '模型暂时不可用' } }, { status: 503 })) :
        success({ ...empty, versions: [version] }));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    fireEvent.change(screen.getByLabelText('上传目录图片'), { target: { files: [new File(['image'], '目录.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('模型暂时不可用');
    expect(screen.getByRole('button', { name: '章节 1 函数与极限' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上传' })).toBeEnabled();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
  });

  it('continues from upload to recognition while the directory is closed and restores the saved draft', async () => {
    let finishUpload!: (value: Response) => void;
    let finishRecognition!: () => void;
    let signal: AbortSignal | undefined;
    let uploads = 0;
    let saved = false;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/images')) {
        uploads++;
        if (uploads === 2) return success({ id: 'second' });
        signal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { finishUpload = resolve; });
      }
      if (url.endsWith('/parse')) return new Promise<Response>(resolve => {
        finishRecognition = () => { saved = true; resolve(Response.json({ success: true, data: version })); };
      });
      return url.endsWith('ai/providers') ? success([visionProvider]) : success({ ...empty, versions: saved ? [version] : [] });
    });
    vi.stubGlobal('fetch', fetcher);
    const onDirtyChange = vi.fn();
    const editor = <CurriculumEditor courseId={courseId} onDirtyChange={onDirtyChange} />;
    const { rerender } = render(editor, { wrapper: WorkspaceOperations });
    await screen.findByRole('button', { name: '上传' });
    fireEvent.change(screen.getByLabelText('上传目录图片'), {
      target: { files: ['目录1.png', '目录2.png'].map(name => new File(['image'], name, { type: 'image/png' })) },
    });
    expect(screen.getByRole('button', { name: '上传' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在上传图片 1/2…');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    rerender(<div>课程概览</div>);
    expect(signal?.aborted).toBe(false);
    finishUpload(Response.json({ success: true, data: { id: 'photo', filename: '目录.png' } }));
    await waitFor(() => expect(finishRecognition).toBeDefined());
    expect(uploads).toBe(2);
    const parse = fetcher.mock.calls.find(([url]) => url.endsWith('/parse'));
    expect(JSON.parse(String(parse?.[1]?.body)).image_ids).toEqual(['photo', 'second']);
    finishRecognition();
    rerender(editor);
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeEnabled();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/parse'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
  });
  it('requires reviewing uncertain directory titles before confirmation', async () => {
    const uncertain = { ...version, payload: { ...payload, uncertain_items: ['核对函数标题'] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, versions: [uncertain] })));
    renderCurriculum();
    await screen.findByRole('button', { name: '核对并确认' });
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '已核对第 1 项' }));
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
  });

  it('places a missing page between its neighbours and fills it with only the newly selected photo', async () => {
    const before = { id: 'tmp-left', title: '映射' };
    const after = { id: 'tmp-right', title: '连续性' };
    const gap = { id: 'a'.repeat(32), chapter_id: 'tmp-c1', after_id: before.id, reason: '缺少 1.2 小节' };
    const saved: Version = { ...version, payload: {
      chapters: [{ ...payload.chapters[0], sections: [before, after] }], gaps: [gap],
    } };
    let current = saved;
    const supplement = Promise.withResolvers<Response>();
    const fetcher = vi.fn((url: string, _init?: RequestInit) => {
      if (url.endsWith('/images')) return success({ id: 'new-photo' });
      if (url.endsWith('/supplement')) return supplement.promise;
      return url.endsWith('ai/providers') ? success([visionProvider]) : success({ ...empty, versions: [current] });
    });
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    const slot = await screen.findByRole('button', { name: '补拍缺页' });
    const row = slot.closest('li')!;
    expect(row.previousElementSibling).toHaveTextContent('映射');
    expect(row.nextElementSibling).toHaveTextContent('连续性');
    expect(screen.getByRole('button', { name: '小节 1.3 连续性' })).toBeVisible();
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
    const photo = new File(['new image'], '补拍.png', { type: 'image/png' });
    fireEvent.click(slot);
    const picker = screen.getByLabelText('补拍目录照片');
    expect(picker).toHaveAttribute('capture', 'environment');
    fireEvent.change(picker, { target: { files: [photo] } });
    await screen.findByText('正在识别补拍内容…');
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([url]) => url.split('/').at(-1))).toEqual(['images', 'supplement']);
    expect(posts[0][1]?.body).toBe(photo);
    expect(JSON.parse(String(posts[1][1]?.body))).toMatchObject({
      version_id: saved.id, revision: saved.revision, gap_id: gap.id, image_ids: ['new-photo'],
    });
    current = { ...saved, revision: 2, payload: {
      chapters: [{ ...payload.chapters[0], sections: [before, { id: 'tmp-insert', title: '极限' }, after] }],
    } };
    supplement.resolve(Response.json({ success: true, data: current }));
    expect(await screen.findByRole('button', { name: '小节 1.2 极限' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '补拍缺页' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeEnabled();
  });
  it('saves a draft without applying formal structure, and requires an explicit confirmation', async () => {
    let stored = false; let applied = false;
    const savedVersion = { ...version, base_course_revision: 1 };
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/providers') || url.endsWith('/images')) return success([]);
      if (url.endsWith('/drafts')) { stored = true; return success(savedVersion); }
      if (url.endsWith('/confirm')) { applied = true; return success({ ...savedVersion, status: 'CONFIRMED' }); }
      return success({ ...empty, curriculum: payload, confirmed_revision: applied ? 2 : 1, versions: stored && !applied ? [savedVersion] : [] });
    });
    vi.stubGlobal('fetch', fetcher);
    const dirty = vi.fn();
    renderCurriculum(dirty);
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    renameChapter();
    fireEvent.change(screen.getByLabelText('章节 1标题'), { target: { value: '第一章 函数与极限' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('草稿已保存，尚未应用到正式目录')).toBeTruthy();
    expect(screen.queryByText('已确认目录')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '核对并确认' }));
    fireEvent.click(screen.getByRole('button', { name: '确认应用目录' }));
    expect(await screen.findByText('目录已确认')).toBeTruthy();
    expect(screen.getByRole('button', { name: '章节 1 函数与极限' })).toBeInTheDocument();
    expect(fetcher.mock.calls.find(([url]) => url.endsWith('/confirm'))?.[1]?.body).toContain('"revision":1');
  });

  it('saves cross-chapter moves in the draft without confirming automatically', async () => {
    const two = { ...version, payload: { chapters: [...payload.chapters, { id: 'tmp-c2', title: '矩阵', sections: [] }] } };
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      init?.method === 'PATCH' ? success({ ...two, payload: JSON.parse(String(init.body)).payload }) : success({ ...empty, versions: [two] }));
    vi.stubGlobal('fetch', fetcher);
    renderCurriculum();
    await screen.findByRole('button', { name: '核对并确认' });
    fireEvent.click(screen.getByRole('button', { name: /章节 1 函数/ }));
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动小节 1.1' }), { dataTransfer });
    fireEvent.drop(screen.getByRole('button', { name: '章节 2 矩阵' }).parentElement!, { dataTransfer });
    expect(screen.getByRole('button', { name: '小节 2.1 映射与函数' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存，尚未应用到正式目录');
    const saved = (fetcher.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(String(saved[1].body));
    expect(body.payload.chapters[0].sections).toEqual([]);
    expect(body.payload.chapters[1].sections[0].id).toBe('tmp-s1');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
  });

  it('retains typed corrections on a save failure', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('ai/providers') || url.endsWith('/images')) return success([]);
      if (url.endsWith('/drafts')) return Promise.resolve(Response.json({ success: false, error: { message: '保存失败，请重试' } }, { status: 503 }));
      return success({ ...empty, curriculum: payload, confirmed_revision: 1 });
    }));
    renderCurriculum();
    await screen.findByRole('button', { name: '章节 1 函数与极限' });
    renameChapter();
    fireEvent.change(screen.getByLabelText('章节 1标题'), { target: { value: '修正的章节标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(screen.getByRole('button', { name: '章节 1 修正的章节标题' })).toBeInTheDocument();
  });

  it('requires acknowledgement of all archived items and blocks stale versions', async () => {
    const archived = { ...version, change_summary: { added: [], modified: [], archived: [{ id: 'old', title: '移除的小节' }] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, versions: [archived] })));
    renderCurriculum();
    await screen.findByRole('button', { name: '核对并确认' });
    fireEvent.click(screen.getByRole('button', { name: '核对并确认' }));
    expect(screen.getByRole('button', { name: '确认应用目录' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我已核对上方全部归档项及受影响知识点'));
    expect(screen.getByRole('button', { name: '确认应用目录' })).toBeEnabled();
    expect(screen.getByText('移除的小节')).toBeTruthy();
  });

  it('loads a saved draft after remount and aborts reads on unmount', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) : success({ ...empty, versions: [version], confirmed_revision: 1 });
    }));
    const { unmount } = renderCurriculum();
    await screen.findByRole('button', { name: '核对并确认' });
    expect(screen.getByRole('alert')).toHaveTextContent('此草稿基线已过期');
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
    unmount();
    await waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true));
  });
});
