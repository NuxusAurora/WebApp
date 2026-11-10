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
  it('edits the only connection automatically without a selector or browser default', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : init?.method === 'PATCH' ? success(provider) : success([provider]));
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    expect(await screen.findByLabelText('接口地址')).toHaveValue(provider.base_url);
    expect(screen.queryByLabelText('连接名称')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('启用连接')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除密钥' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除连接' })).not.toBeInTheDocument();
    expect(screen.queryByText(/地址需包含 \/v1/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('本地连接')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /默认连接/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).not.toHaveProperty('provider_name');
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).not.toHaveProperty('api_key');
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).toHaveProperty('enabled', true);
    expect(localStorage.getItem('learning.default-provider:')).toBeNull();
  });

  it('does not silently choose one of multiple legacy connections', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('ai/options') ? success({ allowed_origins: [] }) : success([provider, { ...provider, id: 'other' }])));
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('存在多条旧配置');
    expect(screen.queryByLabelText('接口地址')).not.toBeInTheDocument();
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
    await screen.findByLabelText('接口地址');
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: provider.base_url } });
    fireEvent.change(screen.getByLabelText('API Key（可选）'), { target: { value: 'private-local-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(screen.getByLabelText('API Key（可选）')).toHaveValue(''));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(mutation?.[1]?.body))).toMatchObject({ provider_name: '默认连接', enabled: true, api_key: 'private-local-key' });
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
    await screen.findByLabelText('接口地址');
    fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: provider.base_url } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('地址未获允许');
    await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled());
    expect(screen.getByLabelText('接口地址')).toHaveValue(provider.base_url);
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('接口地址')).toHaveValue(provider.base_url);
  });

  it('selects a newly saved model so repeat saves update it, and separates test results', async () => {
    let models: object[] = [];
    const model = { id: '22222222-2222-2222-2222-222222222222', provider_id: provider.id, model_name: 'local-model', enabled: true, capabilities: caps, capability_source: 'user_confirmed', tested_capabilities: {} };
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: model.model_name, capabilities: {} }]);
      if (init?.method === 'POST' && url.endsWith('/models')) { models = [model]; return success(model); }
      if (init?.method === 'PUT') return success(model);
      return success([{ ...provider, models }]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<AISettings onDirtyChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByLabelText('接口地址');
    fireEvent.click(screen.getByRole('link', { name: '模型与测试' }));
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: model.model_name } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '测试普通回复' })).toBeEnabled());
    expect(screen.queryByLabelText('选择模型')).not.toBeInTheDocument();
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
    await screen.findByLabelText('接口地址');
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
    expect(screen.getByLabelText('服务模型')).toHaveValue('server-model');
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
    expect(screen.getByLabelText('服务模型')).toHaveValue(model.model_name);
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(16384);
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(mutation[1]?.body)).capabilities.max_context_tokens).toBe(16384);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('blocks an empty model when listing fails and lets the user retry', async () => {
    let fail = true;
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith('/discovery')) return fail ? Promise.resolve(Response.json({ success: false, error: { message: '服务未提供模型列表' } }, { status: 502 })) : success([]);
      return success([provider]);
    });
    await openModels(fetcher);
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存模型' })).toBeDisabled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '刷新模型列表' }));
    await screen.findByText('服务暂无可用模型，请刷新重试。');
    expect(screen.getByRole('button', { name: '保存模型' })).toBeDisabled();
    expect(fetcher.mock.calls.some(([, init]: [string, RequestInit?]) => init?.method)).toBe(false);
  });

  it('keeps the saved model selected when the service list omits it', async () => {
    const model = { id: 'saved', provider_id: provider.id, model_name: 'saved-model', enabled: true, capabilities: caps, tested_capabilities: {} };
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.endsWith('/discovery') ? success([]) : init?.method === 'PUT' ? success(model) : success([{ ...provider, models: [model] }]));
    await openModels(fetcher);
    await screen.findByText('服务暂无可用模型，请刷新重试。');
    expect(screen.getByLabelText('服务模型')).toHaveValue('saved-model');
    fireEvent.change(screen.getByLabelText('上下文长度（Token）'), { target: { value: '8192' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(mutation[1]?.body))).toMatchObject({ model_name: 'saved-model', capabilities: { max_context_tokens: 8192 } });
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
    fireEvent.change(screen.getByLabelText('上下文长度（Token）'), { target: { value: '8192' } });
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'remote' } });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(8192);
    expect(screen.getByLabelText('服务模型')).toHaveValue('');
  });
  it('replaces the sole saved model with a discovered model using PUT', async () => {
    const model = { id: 'saved-model', provider_id: provider.id, model_name: 'old-model', enabled: true, capabilities: caps, tested_capabilities: {} };
    let stored = model;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('ai/options')) return success({ allowed_origins: [] });
      if (url.endsWith('/discovery')) return success([{ model_name: 'replacement', capabilities: {} }]);
      if (init?.method === 'PUT') { stored = { ...model, ...JSON.parse(String(init.body)) }; return success(stored); }
      return success([{ ...provider, models: [stored] }]);
    });
    await openModels(fetcher);
    await waitFor(() => expect(screen.getByLabelText('服务模型')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('服务模型'), { target: { value: 'replacement' } });
    expect(screen.getByLabelText('服务模型')).toHaveValue('replacement');
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/models/saved-model') && init?.method === 'PUT')).toBe(true));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('locks the default service to Aurora-Zyron and preserves its 500000-token context', async () => {
    const model = { id: 'saved-model', provider_id: provider.id, model_name: 'Aurora-Zyron', enabled: true, capabilities: { ...caps, max_context_tokens: 500000 }, tested_capabilities: {} };
    const fixed = { ...provider, base_url: 'https://api.nuxusaurora.com/v1', required_model_name: 'Aurora-Zyron', models: [model] };
    const fetcher = vi.fn((url: string, init?: RequestInit) => init?.method === 'PUT' ? success(model) : success([fixed]));
    await openModels(fetcher);
    expect(screen.getByLabelText('服务模型')).toHaveValue('Aurora-Zyron');
    expect(screen.getByLabelText('服务模型')).toBeDisabled();
    expect(Array.from((screen.getByLabelText('服务模型') as HTMLSelectElement).options).map(item => item.value)).toEqual(['Aurora-Zyron']);
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
    expect(screen.getByLabelText('上下文长度（Token）')).toHaveValue(500000);
    expect(screen.queryByRole('button', { name: '刷新模型列表' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/discovery'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(mutation[1]?.body))).toMatchObject({ model_name: 'Aurora-Zyron', capabilities: { max_context_tokens: 500000 } });
  });

});
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
