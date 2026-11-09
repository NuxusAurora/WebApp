// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurriculumEditor } from '../components/curriculum';
import type { Curriculum, Version } from '../lib/curriculum';

const courseId = '11111111-1111-1111-1111-111111111111';
const payload = { chapters: [{ id: 'tmp-c1', title: '第一章 函数与极限', sections: [{ id: 'tmp-s1', title: '1.1 映射与函数' }] }] };
const version: Version = { id: 'v1', status: 'DRAFT', revision: 1, base_course_revision: 0,
  applied_course_revision: null, payload, change_summary: { added: [{ id: 'tmp-c1', title: '第一章 函数与极限' }], modified: [], archived: [] },
  source: { kind: 'manual' }, created_at: '2026-11-08T12:00:00Z' };
const empty: Curriculum = { curriculum: { chapters: [] }, confirmed_revision: 0, versions: [] };
const success = (data: unknown) => Promise.resolve(Response.json({ success: true, data }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('reviewed curriculum', () => {
  it('sends selected images directly to a vision model without running local OCR', async () => {
    const provider = { id: 'provider', provider_name: '视觉模型', enabled: true,
      models: [{ id: 'model', model_name: 'vision-model', enabled: true, capabilities: { vision: true } }] };
    const fetcher = vi.fn((url: string) => url.endsWith('ai/providers') ? success([provider]) :
      url.endsWith('/images') ? success([{ id: 'photo', filename: '目录.jpg' }]) : url.endsWith('/parse') ? success(version) : success(empty));
    vi.stubGlobal('fetch', fetcher);
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /目录.jpg/ }));
    fireEvent.click(screen.getByRole('button', { name: '模型识别目录' }));
    await screen.findByText('草稿已生成，请核对后确认');
    const parse = fetcher.mock.calls.find(([url]) => url.endsWith('/parse')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(parse[1].body))).toEqual({ input_mode: 'images', image_ids: ['photo'], ocr_text: '', provider_id: 'provider', model_id: 'model' });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/ocr') || url.endsWith('/confirm'))).toBe(false);
  });

  it('does not send images to a model without confirmed vision capability', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') ? success([{ id: 'p', provider_name: '文字', enabled: true,
      models: [{ id: 'm', model_name: 'text-model', enabled: true }] }]) : url.endsWith('/images') ? success([{ id: 'photo', filename: '目录.jpg' }]) : success(empty)));
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /目录.jpg/ }));
    expect(screen.getByRole('button', { name: '模型识别目录' })).toBeDisabled();
    expect(screen.getByText(/确认该模型支持图片识别/)).toBeInTheDocument();
  });
  it('keeps unknown pages blank and requires reviewing uncertain titles before confirmation', async () => {
    const uncertain = { ...version, payload: { ...payload, uncertain_items: ['核对函数标题'] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, versions: [uncertain] })));
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('历史与草稿'), { target: { value: 'v1' } });
    expect(screen.getByLabelText('第 1 章起始页')).toHaveValue(null);
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '已核对第 1 项' }));
    fireEvent.change(screen.getByLabelText('第 1 章起始页'), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('第 1 章结束页'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('第 1 章结束页'), { target: { value: '50' } });
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
  });
  it('saves a draft without applying formal structure, and requires an explicit confirmation', async () => {
    let stored = false; let applied = false;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/providers') || url.endsWith('/images')) return success([]);
      if (url.endsWith('/drafts')) { stored = true; return success(version); }
      if (url.endsWith('/confirm')) { applied = true; return success({ ...version, status: 'CONFIRMED' }); }
      return success({ ...empty, versions: stored ? [version] : [], ...(applied ? { curriculum: payload, confirmed_revision: 1 } : {}) });
    });
    vi.stubGlobal('fetch', fetcher);
    const dirty = vi.fn();
    render(<CurriculumEditor courseId={courseId} onDirtyChange={dirty} />);
    fireEvent.click(await screen.findByRole('button', { name: '手动编辑目录' }));
    fireEvent.change(screen.getByLabelText('第 1 章标题'), { target: { value: '第一章 函数与极限' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('草稿已保存，尚未应用到正式目录')).toBeTruthy();
    expect(screen.queryByText('已确认目录')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/confirm'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '核对并确认' }));
    fireEvent.click(screen.getByRole('button', { name: '确认应用目录' }));
    expect(await screen.findByText('目录已确认')).toBeTruthy();
    expect(screen.getByText('修订 1')).toBeTruthy();
    expect(fetcher.mock.calls.find(([url]) => url.endsWith('/confirm'))?.[1]?.body).toContain('"revision":1');
  });

  it('saves cross-chapter moves in the draft without confirming automatically', async () => {
    const two = { ...version, payload: { chapters: [...payload.chapters, { id: 'tmp-c2', title: '矩阵', sections: [] }] } };
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      init?.method === 'PATCH' ? success({ ...two, payload: JSON.parse(String(init.body)).payload }) : success({ ...empty, versions: [two] }));
    vi.stubGlobal('fetch', fetcher);
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('历史与草稿'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: /章节 1 第一章/ }));
    fireEvent.click(screen.getByRole('button', { name: /小节 1.1 1.1/ }));
    fireEvent.change(screen.getByLabelText('所属章节'), { target: { value: 'tmp-c2' } });
    expect(screen.getByLabelText('小节 2.1')).toHaveValue('1.1 映射与函数');
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
      return success(empty);
    }));
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '手动编辑目录' }));
    fireEvent.change(screen.getByLabelText('第 1 章标题'), { target: { value: '修正的章节标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(screen.getByLabelText('第 1 章标题')).toHaveValue('修正的章节标题');
  });

  it('requires acknowledgement of all archived items and blocks stale versions', async () => {
    const archived = { ...version, change_summary: { added: [], modified: [], archived: [{ id: 'old', title: '移除的小节' }] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) :
      success({ ...empty, versions: [archived] })));
    render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('历史与草稿'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: '核对并确认' }));
    expect(screen.getByRole('button', { name: '确认应用目录' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('我已核对上方全部归档项'));
    expect(screen.getByRole('button', { name: '确认应用目录' })).toBeEnabled();
    expect(screen.getByText('移除的小节')).toBeTruthy();
  });

  it('loads a saved draft after remount and aborts reads on unmount', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return url.endsWith('ai/providers') || url.endsWith('/images') ? success([]) : success({ ...empty, versions: [version], confirmed_revision: 1 });
    }));
    const { unmount } = render(<CurriculumEditor courseId={courseId} onDirtyChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('历史与草稿'), { target: { value: 'v1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('此草稿基线已过期');
    expect(screen.getByRole('button', { name: '核对并确认' })).toBeDisabled();
    unmount();
    await waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true));
  });
});
