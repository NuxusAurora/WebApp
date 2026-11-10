import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AISettings as Settings } from '../components/ai-settings';
import { useCallback, useState, type ComponentProps } from 'react';
import { AppSidebar } from '../components/app-sidebar';
import { type WorkspaceView } from '../lib/workspace-navigation';
import { sidebarDOM } from './sidebar-test-dom';

function AISettings(props: ComponentProps<typeof Settings>) {
  const [view, setView] = useState<WorkspaceView>('ai');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => { setDirty(value); props.onDirtyChange(value); }, [props.onDirtyChange]);
  const navigate = (next: WorkspaceView) => {
    if (next === view) return true;
    if (busy || (dirty && !window.confirm('修改尚未保存。放弃修改并离开？'))) return false;
    setView(next); return true;
  };
  return <><AppSidebar user={null} view={view} busy={busy} navigate={navigate} logout={async () => {}} />
    <Settings {...props} onDirtyChange={onDirtyChange} onBusyChange={setBusy} tab={view === 'ai-models' ? 'models' : view === 'ai-logs' ? 'logs' : 'connection'} onTabChange={() => navigate('ai')} /></>;
}


const caps = { vision: false, streaming: false, structured_output: false, tool_calling: false, max_context_tokens: 4096 };
const provider = { id: '11111111-1111-1111-1111-111111111111', provider_name: '本地连接', base_url: 'http://localhost:1234/v1', enabled: true, has_api_key: true, models: [] as object[] };
const success = (data: unknown) => Promise.resolve(Response.json({ success: true, data, error: null }));
beforeEach(() => sidebarDOM());

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local model settings', () => {
  it('stores only the default connection ID per account and restores it on return', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : success([provider]));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<AISettings userId="account-one" onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    expect(screen.getByLabelText('接口地址')).toHaveValue('https://api.nuxusaurora.com/v1');
    fireEvent.change(screen.getByLabelText('本地连接'), { target: { value: provider.id } });
    fireEvent.click(screen.getByRole('button', { name: '设为默认连接' }));
    expect(localStorage.getItem('learning.default-provider:account-one')).toBe(provider.id);
    expect(screen.getByRole('button', { name: '当前默认连接' })).toBeDisabled();
    view.unmount();
    render(<AISettings userId="account-one" onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByRole('button', { name: '当前默认连接' });
    expect(screen.getByLabelText('本地连接')).toHaveValue(provider.id);
  });

  it('does not reuse another account default or a disabled connection', async () => {
    localStorage.setItem('learning.default-provider:account-one', provider.id);
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : success([provider])));
    const view = render(<AISettings userId="account-two" onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    expect(screen.getByLabelText('本地连接')).toHaveValue('');
    view.unmount();
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : success([{ ...provider, enabled: false }])));
    render(<AISettings userId="account-one" onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    expect(screen.getByLabelText('本地连接')).toHaveValue('');
  });

  it('reports a preference storage failure without changing the connection', async () => {
    const fetcher = vi.fn((url: string) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : success([provider]));
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings userId="account-one" onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    fireEvent.change(screen.getByLabelText('本地连接'), { target: { value: provider.id } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    fireEvent.click(screen.getByRole('button', { name: '设为默认连接' }));
    expect(screen.getByRole('alert')).toHaveTextContent('无法保存默认连接');
    expect(screen.getByRole('button', { name: '设为默认连接' })).toBeEnabled();
    expect(fetcher.mock.calls.every(([, init]: [string, RequestInit?]) => !init?.method)).toBe(true);
  });
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
    await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled());
    expect(screen.getByLabelText('连接名称')).toHaveValue('未保存连接');
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('连接名称')).toHaveValue('未保存连接');
  });

  it('selects a newly saved model so repeat saves update it, and separates test results', async () => {
    let models: object[] = [];
    const model = { id: '22222222-2222-2222-2222-222222222222', provider_id: provider.id, model_name: 'local-model', enabled: true, capabilities: caps, capability_source: 'user_confirmed', tested_capabilities: {} };
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([]);
      if (init?.method === 'POST' && url.endsWith('/models')) { models = [model]; return success(model); }
      if (init?.method === 'PUT') return success(model);
      return success([{ ...provider, models }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    fireEvent.change(screen.getByLabelText('本地连接'), { target: { value: provider.id } });
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
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

describe('provider model discovery', () => {
  async function openModels(fetcher: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('连接名称');
    fireEvent.change(screen.getByLabelText('本地连接'), { target: { value: provider.id } });
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    await screen.findByLabelText('服务模型');
  }

  it('reads automatically and prefills explicit metadata without saving or probing', async () => {
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: 'server-model', capabilities: { max_context_tokens: 32768, streaming: true } }]);
      return success([provider]);
    });
    await openModels(fetcher);
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'server-model' } });
    expect(screen.getByLabelText('模型名称')).toHaveValue('server-model');
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(32768);
    expect(screen.getByLabelText('支持流式输出')).toBeChecked();
    expect(screen.getByLabelText('支持原生 JSON Schema')).not.toBeChecked();
    expect(fetcher.mock.calls.every(([, init]: [string, RequestInit?]) => !init?.method)).toBe(true);
  });

  it('keeps unknown metadata conservative and refresh never overwrites manual edits', async () => {
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: 'vision-128k', capabilities: {} }]);
      return success([provider]);
    });
    await openModels(fetcher);
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'vision-128k' } });
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(4096);
    fireEvent.change(screen.getByLabelText('上下文长度（Token）'), { target: { value: '8192' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新模型列表' })).toBeEnabled());
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(8192);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/discovery'))).toHaveLength(2);
  });

  it('uses an existing saved model when the discovered model matches', async () => {
    const model = { id: '22222222-2222-2222-2222-222222222222', provider_id: provider.id, model_name: 'same-model', enabled: true, capabilities: caps, tested_capabilities: {} };
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: 'same-model', capabilities: { max_context_tokens: 16384 } }]);
      if (init?.method === 'PUT') return success({ ...model, capabilities: { ...caps, max_context_tokens: 16384 } });
      return success([{ ...provider, models: [model] }]);
    });
    await openModels(fetcher);
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'same-model' } });
    expect(screen.getByLabelText('选择模型')).toHaveValue(model.id);
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(16384);
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(mutation[1]?.body)).capabilities.max_context_tokens).toBe(16384);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('falls back to manual input when listing fails and lets the user retry', async () => {
    let fail = true;
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return fail ? Promise.resolve(Response.json({ success: false, error: { message: '服务未提供模型列表' } }, { status: 502 })) : success([]);
      return success([provider]);
    });
    await openModels(fetcher);
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'manual-model' } });
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));
    await screen.findByText('服务暂无可用模型，可手动填写。');
    expect(screen.getByLabelText('模型名称')).toHaveValue('manual-model');
  });

  it('protects a modified draft when choosing a discovered model', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: 'remote', capabilities: {} }]);
      return success([provider]);
    });
    await openModels(fetcher);
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'my-draft' } });
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'remote' } });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('模型名称')).toHaveValue('my-draft');
  });
});
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
