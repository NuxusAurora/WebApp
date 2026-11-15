// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionKnowledge } from '../components/knowledge';
import { ApiError } from '../lib/api';
import type { KnowledgeData, KnowledgeVersion } from '../lib/knowledge';
import { WorkspaceOperations } from '../lib/workspace-operations';

const providers = [{ id: 'p', enabled: true, provider_name: '默认接口', models: [{ id: 'm', enabled: true, model_name: 'fixture' }] }];
const payload = { knowledge_points: [{ temp_id: 'kp1', existing_knowledge_point_id: null, title: '函数定义', description: '集合间的唯一对应', learning_objectives: ['解释定义'], importance: 'HIGH' as const, mastery_criteria: ['判断函数'] }] };
const legacyPayload = { ...payload, uncertain_items: ['待核对的原文'] };
const version: KnowledgeVersion = { id: 'v', revision: 1, status: 'DRAFT', base_course_revision: 1, payload,
  source: { kind: 'ai', model_name: 'fixture' }, change_summary: { added: [{ id: 'kp1', title: '函数定义' }], modified: [], archived: [] } };
const initial: KnowledgeData = { confirmed_revision: 1, knowledge_points: [], draft: null };
function response(data: unknown) { return Promise.resolve(Response.json({ success: true, data })); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mock(current = initial) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/providers') ? response(providers) :
    init?.method === 'POST' || init?.method === 'PATCH' ? response(version) : response(current));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function renderEditor(onDirtyChange = vi.fn()) {
  return render(<SectionKnowledge sectionId="s1" onDirtyChange={onDirtyChange} />, { wrapper: WorkspaceOperations });
}

describe('section knowledge draft workflow', () => {
  it('allows applying a legacy draft directly without a review card or a save', async () => {
    const fetcher = mock({ ...initial, draft: { ...version, payload: legacyPayload } });
    renderEditor();
    await screen.findByDisplayValue('函数定义');
    expect(screen.queryByRole('region', { name: 'AI 审核与核对' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    fireEvent.click(screen.getByRole('button', { name: '确认应用知识点' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(true));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    await screen.findByRole('button', { name: '生成具体知识点' });
  });
  it('preserves every field while folding points, and does not mark disclosure as an edit', async () => {
    const second = { ...payload.knowledge_points[0], temp_id: 'kp2', title: '第二个知识点', importance: 'LOW' as const };
    const fetcher = mock({ ...initial, draft: { ...version, payload: { ...payload, knowledge_points: [...payload.knowledge_points, second] } } });
    const { container } = renderEditor();
    await screen.findByDisplayValue('第二个知识点');
    const cards = container.querySelectorAll('.knowledge-point-editor');
    expect(cards[0]).not.toHaveAttribute('open');
    expect(cards[1]).not.toHaveAttribute('open');
    fireEvent.click(cards[1].querySelector('summary')!);
    expect(screen.getByLabelText('知识点 2名称')).toBeVisible();
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('知识点 2定义'), { target: { value: '只修改这一条定义' } });
    fireEvent.click(cards[1].querySelector('summary')!);
    expect(cards[1]).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存');
    const saved = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(saved[1]?.body)).payload.knowledge_points).toEqual([payload.knowledge_points[0], { ...second, description: '只修改这一条定义' }]);
  });
  it('omits the review card, change summary and model provenance', async () => {
    const generated: KnowledgeVersion = { ...version, source: { kind: 'ai', model_name: 'fixture', knowledge_basis: 'model_knowledge', prompt_version: 'knowledge-extract-v2' } };
    const fetcher = mock({ ...initial, draft: generated }); renderEditor();
    await screen.findByDisplayValue('函数定义');
    expect(screen.queryByText('生成依据：模型自身知识 · fixture')).not.toBeInTheDocument();
    expect(screen.queryByText('新增项')).not.toBeInTheDocument();
    expect(screen.queryByText(/新增 1 · 修改/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI 审核与核对' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([url]) => !/research|search/i.test(url))).toBe(true);
  });
  it('restores the saved draft and provides no reload or close editor action', async () => {
    const fetcher = mock({ ...initial, draft: version }); const view = renderEditor();
    await screen.findByDisplayValue('函数定义');
    expect(screen.queryByRole('button', { name: '关闭编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
    view.unmount(); renderEditor();
    await screen.findByDisplayValue('函数定义');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST' || init?.method === 'PATCH')).toBe(false);
  });
  it('generates using the first enabled model and never confirms automatically', async () => {
    const fetcher = mock(); renderEditor();
    const generate = await screen.findByRole('button', { name: '生成具体知识点' });
    let saved = false;
    fetcher.mockImplementation(url => {
      if (url.endsWith('/generate')) { saved = true; return response(version); }
      return response(url.endsWith('ai/providers') ? providers : { ...initial, draft: saved ? version : null });
    });
    fireEvent.click(generate);
    await screen.findByDisplayValue('函数定义');
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ provider_id: 'p', model_id: 'm', base_course_revision: 1 });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    expect(screen.getByRole('button', { name: '确认无误' })).toBeEnabled();
  });
  it('edits and saves a legacy draft, then applies only after explicit confirmation', async () => {
    let current: typeof initial = { ...initial, draft: { ...version, payload: legacyPayload } }; const fetcher = mock(current); renderEditor();
    fireEvent.change(await screen.findByLabelText('知识点 1名称'), { target: { value: '函数定义（核对）' } });
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    await screen.findByText('请先保存草稿');
    expect(screen.queryByRole('button', { name: '确认应用知识点' })).not.toBeInTheDocument();
    fetcher.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/providers')) return response(providers);
      if (init?.method === 'PATCH') {
        current = { ...current, draft: { ...version, payload: JSON.parse(String(init.body)).payload, revision: 2 } };
        return response(current.draft);
      }
      if (url.endsWith('/confirm')) {
        current = {
          ...initial,
          confirmed_revision: 2,
          knowledge_points: [{
            ...payload.knowledge_points[0],
            id: 'point', section_id: 's1', status: 'NOT_STARTED', title: '函数定义（核对）',
            source: { kind: 'ai', knowledge_basis: 'model_knowledge', model_name: 'Aurora-Zyron' },
          }],
        };
        return response({});
      }
      return response(current);
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存');
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ expected_revision: 1, base_course_revision: 1, version_id: 'v', payload: { knowledge_points: [{ title: '函数定义（核对）' }] } });
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled();
    expect(screen.getAllByText('草稿已保存')).toHaveLength(1);
    expect(JSON.parse(String(patch[1]?.body)).payload).not.toHaveProperty('uncertain_items');
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    fireEvent.click(screen.getByRole('button', { name: '确认应用知识点' }));
    const applied = await screen.findByRole('heading', { name: '函数定义（核对）', level: 3 });
    expect(applied.closest('li')?.textContent).toBe('函数定义（核对）');
    expect(screen.queryByText('知识点已确认')).not.toBeInTheDocument();
    expect(screen.queryByText('已确认的知识点')).not.toBeInTheDocument();
    expect(screen.queryByText(/生成依据：模型自身知识/)).not.toBeInTheDocument();
    const confirmation = fetcher.mock.calls.find(([url]) => url.endsWith('/confirm'))!;
    expect(JSON.parse(String(confirmation[1]?.body))).toMatchObject({ expected_revision: 2, version_id: 'v' });
  });
  it('requires acknowledging archives when applying a legacy draft', async () => {
    mock({ ...initial, draft: { ...version, payload: legacyPayload, change_summary: { ...version.change_summary, archived: [{ id: 'old', title: '旧知识点' }] } } });
    renderEditor(); fireEvent.click(await screen.findByRole('button', { name: '确认无误' }));
    expect(screen.getByText('旧知识点')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认应用知识点' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我已核对全部归档知识点'));
    expect(screen.getByRole('button', { name: '确认应用知识点' })).toBeEnabled();
  });
  it('keeps typed changes and the dirty state when saving fails', async () => {
    const fetcher = mock({ ...initial, draft: version });
    const dirty = vi.fn(); renderEditor(dirty);
    fireEvent.change(await screen.findByLabelText('知识点 1名称'), { target: { value: '我的修正' } });
    fetcher.mockImplementation((url: string, init?: RequestInit) => init?.method === 'PATCH' ? Promise.resolve(Response.json({ success: false, error: { message: '保存失败' } }, { status: 502 })) : response(initial));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByRole('alert'); expect(screen.getByDisplayValue('我的修正')).toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('preserves a previous draft if regeneration fails', async () => {
    const fetcher = mock({ ...initial, draft: version }); vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDirtyChange = vi.fn();
    const editor = renderEditor(onDirtyChange);
    await screen.findByDisplayValue('函数定义');
    fetcher.mockImplementation(() => Promise.resolve(Response.json({ success: false, error: { message: '模型不可用' } }, { status: 502 })));
    editor.rerender(<SectionKnowledge sectionId="s1" onDirtyChange={onDirtyChange} action="generate" />);
    await screen.findByText('模型不可用'); expect(screen.getByDisplayValue('函数定义')).toBeInTheDocument();
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ replace_version_id: 'v', replace_revision: 1 });
  });
  it('shows a background failure only in its original section and keeps the retry available', async () => {
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/generate')) return pending.promise;
      return response(url.endsWith('ai/providers') ? providers : initial);
    }));
    const onDirtyChange = vi.fn();
    const section = (id: string) => <SectionKnowledge key={id} sectionId={id} onDirtyChange={onDirtyChange} />;
    const { rerender } = render(section('s1'), { wrapper: WorkspaceOperations });
    fireEvent.click(await screen.findByRole('button', { name: '生成具体知识点' }));
    rerender(section('s2'));
    pending.resolve(Response.json({ success: false, error: { message: '生成超时，请重试' } }, { status: 502 }));
    expect(await screen.findByRole('button', { name: '生成具体知识点' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(section('s1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('生成超时，请重试');
    expect(await screen.findByRole('button', { name: '生成具体知识点' })).toBeEnabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('blocks a stale draft and explicitly replaces it when editing from formal points', async () => {
    const fetcher = mock({ ...initial, confirmed_revision: 2, draft: version }); vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditor(); await screen.findByDisplayValue('函数定义');
    expect(screen.getByRole('button', { name: '确认无误' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '从正式知识点重新编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/drafts'))).toBe(true));
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/drafts'))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ base_course_revision: 2, replace_version_id: 'v', replace_revision: 1 });
  });
  it('aborts generation and ignores late results when the signed-in workspace closes', async () => {
    const fetcher = mock(); const dirty = vi.fn(); const { unmount } = renderEditor(dirty);
    await screen.findByRole('button', { name: '生成具体知识点' });
    let release!: (result: Response) => void;
    fetcher.mockImplementation((url: string) => url.endsWith('/generate') ? new Promise(resolve => { release = resolve; }) : response(initial));
    fireEvent.click(screen.getByRole('button', { name: '生成具体知识点' }));
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    unmount(); expect(call[1]?.signal?.aborted).toBe(true);
    release(Response.json({ success: true, data: version }));
    await Promise.resolve(); expect(dirty).toHaveBeenLastCalledWith(false);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(0);
  });
  it('allows retry after a load failure and handles expired sessions', async () => {
    const fetcher = mock(); let fail = true;
    fetcher.mockImplementation((url: string) => url.endsWith('ai/providers') ? response(providers) :
      fail ? Promise.resolve(Response.json({ success: false, error: { message: '读取失败' } }, { status: 502 })) : response(initial));
    renderEditor(); await screen.findByText('读取失败'); fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新加载知识点' })); await screen.findByRole('button', { name: '生成具体知识点' });
    cleanup(); const expired = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new ApiError(401, '登录已过期'))));
    render(<SectionKnowledge sectionId="s1" onDirtyChange={vi.fn()} onSessionExpired={expired} />, { wrapper: WorkspaceOperations });
    await waitFor(() => expect(expired).toHaveBeenCalled());
  });
});
