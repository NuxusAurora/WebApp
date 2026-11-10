// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeEditor } from '../components/knowledge';
import { ApiError } from '../lib/api';
import type { KnowledgeVersion } from '../lib/knowledge';

const curriculum = { confirmed_revision: 1, versions: [], curriculum: { chapters: [{ id: 'c', title: '函数与极限', sections: [{ id: 's1', title: '函数' }, { id: 's2', title: '极限' }] }] } };
const providers = [{ id: 'p', enabled: true, provider_name: '默认接口', models: [{ id: 'm', enabled: true, model_name: 'fixture' }] }];
const payload = { knowledge_points: [{ temp_id: 'kp1', existing_knowledge_point_id: null, title: '函数定义', description: '集合间的唯一对应', learning_objectives: ['解释定义'], importance: 'HIGH' as const, mastery_criteria: ['判断函数'] }], uncertain_items: [] };
const version: KnowledgeVersion = { id: 'v', revision: 1, status: 'DRAFT', base_course_revision: 1, payload,
  source: { kind: 'ai', model_name: 'fixture' }, change_summary: { added: [{ id: 'kp1', title: '函数定义' }], modified: [], archived: [] } };
const initial = { confirmed_revision: 1, knowledge_points: [], draft: null as KnowledgeVersion | null };
function response(data: unknown) { return Promise.resolve(Response.json({ success: true, data })); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mock(current = initial) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('/curriculum') ? response(curriculum) : url.endsWith('ai/providers') ? response(providers) :
    init?.method === 'POST' || init?.method === 'PATCH' ? response(version) : response(current));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function renderEditor(onDirtyChange = vi.fn()) { return render(<KnowledgeEditor courseId="course" onDirtyChange={onDirtyChange} />); }

describe('section knowledge draft workflow', () => {
  it('restores the save action after another change and warns without sending a confirmation for pending reviews', async () => {
    const fetcher = mock({ ...initial, draft: { ...version, payload: { ...payload, uncertain_items: ['待核对的原文'] } } });
    renderEditor(); await screen.findByDisplayValue('函数定义');
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('知识点 1定义'), { target: { value: '修改后的定义' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.queryByText('草稿已保存')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    expect(await screen.findByText('请回到开始处，还有未核对的事项')).toBeVisible();
    expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/confirm') || init?.method === 'PATCH')).toBe(false);
  });
  it('keeps full review opinions through disclosure and saves only the explicitly reviewed item as resolved', async () => {
    const opinions = ['请逐字核对教材符号。\n' + '保留完整的模型审核原文及说明。'.repeat(40), '第二项独立意见，不应被一并核对。'];
    const fetcher = mock({ ...initial, draft: { ...version, payload: { ...payload, uncertain_items: opinions } } });
    renderEditor();
    const review = await screen.findByRole('region', { name: 'AI 审核与核对' });
    expect(within(review).getByText('2 项待核对')).toBeInTheDocument();
    const text = review.querySelector('.knowledge-review-text')!;
    const disclosure = within(review).getByRole('button', { name: '展开核对项 1完整意见' });
    expect(text.textContent).toBe(opinions[0]);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(text);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(review).queryByRole('button', { name: '批准' })).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(text.textContent).toBe(opinions[0]);
    expect(fetcher.mock.calls.some(([, init]) => init?.method)).toBe(false);
    expect(within(review).queryByText('收起完整意见')).not.toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: '批准' }));
    expect(within(review).getByText('1 项待核对')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存');
    const saved = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(saved[1]?.body)).payload).toEqual({ ...payload, uncertain_items: [opinions[1]] });
  });
  it('preserves every field while folding points, and does not mark disclosure as an edit', async () => {
    const second = { ...payload.knowledge_points[0], temp_id: 'kp2', title: '第二个知识点', importance: 'LOW' as const };
    const fetcher = mock({ ...initial, draft: { ...version, payload: { ...payload, knowledge_points: [...payload.knowledge_points, second] } } });
    const { container } = renderEditor();
    await screen.findByDisplayValue('第二个知识点');
    const cards = container.querySelectorAll('.knowledge-point-editor');
    expect(cards[0]).toHaveAttribute('open');
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
  it('keeps review context while removing the bottom change summary and model provenance', async () => {
    const generated: KnowledgeVersion = { ...version, source: { kind: 'ai', model_name: 'fixture', knowledge_basis: 'model_knowledge', prompt_version: 'knowledge-extract-v2' } };
    const fetcher = mock({ ...initial, draft: generated }); renderEditor();
    await screen.findByDisplayValue('函数定义');
    expect(screen.queryByText('生成依据：模型自身知识 · fixture')).not.toBeInTheDocument();
    expect(screen.queryByText('新增项')).not.toBeInTheDocument();
    expect(screen.queryByText(/新增 1 · 修改/)).not.toBeInTheDocument();
    expect(screen.getByText('基于模型自身知识生成，请核对教材特有内容。')).toBeInTheDocument();
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
  it('requires a confirmed section and never calls a model for an empty directory', async () => {
    const fetcher = vi.fn(() => response({ ...curriculum, curriculum: { chapters: [] } })); vi.stubGlobal('fetch', fetcher);
    renderEditor(); await screen.findByText('先在教材目录中确认小节，再生成知识点。');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('generates using the first enabled model and never confirms automatically', async () => {
    const fetcher = mock(); renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: '生成知识点' }));
    await screen.findByDisplayValue('函数定义');
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ provider_id: 'p', model_id: 'm', base_course_revision: 1 });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    expect(screen.getByRole('button', { name: '确认无误' })).toBeEnabled();
  });
  it('restores, edits and saves a draft, then applies only after review', async () => {
    let current: typeof initial = { ...initial, draft: version }; const fetcher = mock(current); renderEditor();
    fireEvent.change(await screen.findByLabelText('知识点 1名称'), { target: { value: '函数定义（核对）' } });
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    await screen.findByText('请先保存草稿');
    expect(screen.queryByRole('button', { name: '确认应用知识点' })).not.toBeInTheDocument();
    fetcher.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/curriculum')) return response(curriculum);
      if (url.endsWith('ai/providers')) return response(providers);
      if (init?.method === 'PATCH') {
        current = { ...current, draft: { ...version, payload: JSON.parse(String(init.body)).payload, revision: 2 } };
        return response(current.draft);
      }
      if (url.endsWith('/confirm')) { current = { ...initial, confirmed_revision: 2 }; return response({}); }
      return response(current);
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存');
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({ expected_revision: 1, base_course_revision: 1, version_id: 'v', payload: { knowledge_points: [{ title: '函数定义（核对）' }] } });
    expect(screen.getByRole('button', { name: '草稿已保存' })).toBeDisabled();
    expect(screen.getAllByText('草稿已保存')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '确认无误' })).toHaveClass('is-clear');
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    fireEvent.click(screen.getByRole('button', { name: '确认应用知识点' }));
    await screen.findByText('知识点已确认');
    const confirmation = fetcher.mock.calls.find(([url]) => url.endsWith('/confirm'))!;
    expect(JSON.parse(String(confirmation[1]?.body))).toMatchObject({ expected_revision: 2, version_id: 'v' });
  });
  it('requires clearing uncertainties and acknowledging archives', async () => {
    mock({ ...initial, draft: { ...version, payload: { ...payload, uncertain_items: ['请查阅教材'] }, change_summary: { ...version.change_summary, archived: [{ id: 'old', title: '旧知识点' }] } } });
    renderEditor(); await screen.findByText('请查阅教材');
    expect(screen.getByRole('button', { name: '确认无误' })).toHaveClass('is-pending');
    fireEvent.click(screen.getByRole('button', { name: '确认无误' }));
    await screen.findByText('请回到开始处，还有未核对的事项');
    expect(screen.queryByRole('button', { name: '确认应用知识点' })).not.toBeInTheDocument();
    cleanup(); mock({ ...initial, draft: { ...version, change_summary: { ...version.change_summary, archived: [{ id: 'old', title: '旧知识点' }] } } });
    renderEditor(); fireEvent.click(await screen.findByRole('button', { name: '确认无误' }));
    expect(screen.getByText('旧知识点')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认应用知识点' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我已核对全部归档知识点'));
    expect(screen.getByRole('button', { name: '确认应用知识点' })).toBeEnabled();
  });
  it('keeps typed changes on failure and guards section changes', async () => {
    const fetcher = mock({ ...initial, draft: version }); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const dirty = vi.fn(); renderEditor(dirty);
    fireEvent.change(await screen.findByLabelText('知识点 1名称'), { target: { value: '我的修正' } });
    fetcher.mockImplementation((url: string, init?: RequestInit) => init?.method === 'PATCH' ? Promise.resolve(Response.json({ success: false, error: { message: '保存失败' } }, { status: 502 })) : response(initial));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByRole('alert'); expect(screen.getByDisplayValue('我的修正')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('小节'), { target: { value: 's2' } });
    expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText('小节')).toHaveValue('s1');
    expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('preserves a previous draft if regeneration fails', async () => {
    const fetcher = mock({ ...initial, draft: version }); vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditor(); await screen.findByDisplayValue('函数定义');
    fetcher.mockImplementation(() => Promise.resolve(Response.json({ success: false, error: { message: '模型不可用' } }, { status: 502 })));
    fireEvent.click(screen.getByRole('button', { name: '重新生成知识点' }));
    await screen.findByText('模型不可用'); expect(screen.getByDisplayValue('函数定义')).toBeInTheDocument();
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ replace_version_id: 'v', replace_revision: 1 });
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
  it('aborts generation and prevents late results after switching sections', async () => {
    const fetcher = mock(); const dirty = vi.fn(); const { unmount } = renderEditor(dirty);
    await screen.findByRole('button', { name: '生成知识点' });
    let release!: (result: Response) => void;
    fetcher.mockImplementation((url: string) => url.endsWith('/generate') ? new Promise(resolve => { release = resolve; }) : response(initial));
    fireEvent.click(screen.getByRole('button', { name: '生成知识点' }));
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/generate'))!;
    unmount(); expect(call[1]?.signal?.aborted).toBe(true);
    release(Response.json({ success: true, data: version }));
    await Promise.resolve(); expect(dirty).toHaveBeenLastCalledWith(false);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/confirm'))).toHaveLength(0);
  });
  it('allows retry after a load failure and handles expired sessions', async () => {
    const fetcher = mock(); let fail = true;
    fetcher.mockImplementation((url: string) => url.endsWith('/curriculum') ? response(curriculum) : url.endsWith('ai/providers') ? response(providers) :
      fail ? Promise.resolve(Response.json({ success: false, error: { message: '读取失败' } }, { status: 502 })) : response(initial));
    renderEditor(); await screen.findByText('读取失败'); fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新加载知识点' })); await screen.findByRole('button', { name: '生成知识点' });
    cleanup(); const expired = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new ApiError(401, '登录已过期'))));
    render(<KnowledgeEditor courseId="course" onDirtyChange={vi.fn()} onSessionExpired={expired} />);
    await waitFor(() => expect(expired).toHaveBeenCalled());
  });
});
