import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AISettings } from '../components/ai-settings';

const caps = { vision: false, streaming: false, structured_output: false, tool_calling: false, max_context_tokens: 4096 };
const provider = { id: '11111111-1111-1111-1111-111111111111', provider_name: '本地连接', base_url: 'http://localhost:1234/v1', enabled: true, has_api_key: true, models: [] as object[] };
const success = (data: unknown) => Promise.resolve(Response.json({ success: true, data, error: null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local model settings', () => {
  it('clears saved credentials and never receives a key from configuration reads', async () => {
    let saved = false;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: ['http://localhost:1234'] });
      if (init?.method === 'POST') { saved = true; return success(provider); }
      return success(saved ? [provider] : []);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('连接名称'), { target: { value: '本地连接' } });
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: provider.base_url } });
    fireEvent.change(screen.getByLabelText('API Key（可选）'), { target: { value: 'private-local-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(screen.getByLabelText('API Key（可选）')).toHaveValue(''));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(mutation?.[1]?.body)).api_key).toBe('private-local-key');
    expect(localStorage.getItem('api_key')).toBeNull();
  });

  it('keeps edits on save failure and guards leaving a dirty form', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (init?.method === 'POST') return Promise.resolve(Response.json({ success: false, error: { message: '地址未获允许' } }, { status: 400 }));
      return success([]);
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('连接名称'), { target: { value: '未保存连接' } });
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: provider.base_url } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('地址未获允许');
    expect(screen.getByLabelText('连接名称')).toHaveValue('未保存连接');
    fireEvent.click(screen.getByRole('button', { name: '模型与测试' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('连接名称')).toHaveValue('未保存连接');
  });

  it('selects a newly saved model so repeat saves update it, and separates test results', async () => {
    let models: object[] = [];
    const model = { id: '22222222-2222-2222-2222-222222222222', provider_id: provider.id, model_name: 'local-model', enabled: true, capabilities: caps, capability_source: 'user_confirmed', tested_capabilities: {} };
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (init?.method === 'POST' && url.endsWith('/models')) { models = [model]; return success(model); }
      if (init?.method === 'PUT') return success(model);
      return success([{ ...provider, models }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    fireEvent.change(screen.getByLabelText('本地连接'), { target: { value: provider.id } });
    fireEvent.click(screen.getByRole('button', { name: '模型与测试' }));
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: model.model_name } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(screen.getByLabelText('选择模型')).toHaveValue(model.id));
    expect(screen.getByRole('button', { name: '测试普通回复' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('aborts configuration reads on unmount and handles expired sessions', async () => {
    const expired = vi.fn();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve(Response.json({ success: false }, { status: 401 }));
    }));
    const view = render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={expired} />);
    await waitFor(() => expect(expired).toHaveBeenCalled());
    view.unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
