'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Toast, useToast } from './toast';

type Capabilities = { vision: boolean; streaming: boolean; structured_output: boolean; tool_calling: boolean; max_context_tokens: number };
type Model = { id: string; provider_id: string; model_name: string; enabled: boolean; capabilities: Capabilities;
  capability_source: string; tested_capabilities: Record<string, boolean> };
type Provider = { id: string; provider_name: string; base_url: string; has_api_key: boolean; enabled: boolean; models: Model[] };
type DiscoveredModel = { model_name: string; capabilities: Partial<Capabilities> };
type CallLog = { id: string; model_id: string; model_name: string; provider_name: string; task_type: string; status: string; duration_ms: number;
  attempts: number; input_tokens: number | null; output_tokens: number | null; error_code: string | null; created_at: string };
const defaults: Capabilities = { vision: false, streaming: false, structured_output: false, tool_calling: false, max_context_tokens: 4096 };
const states: Record<string, string> = { SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消', RUNNING: '进行中' };
const defaultApiBase = 'https://api.nuxusaurora.com/v1';

export function AISettings({ onDirtyChange, onSessionExpired, tab = 'connection', onTabChange, onBusyChange }: {
  onDirtyChange: (dirty: boolean) => void; onSessionExpired: () => void;
  tab?: 'connection' | 'models' | 'logs'; onTabChange?: (tab: 'connection') => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [configurationConflict, setConfigurationConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [origins, setOrigins] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const { notification, notify, dismiss } = useToast();
  const provider = providers[0];
  const markDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange(value); }, [onDirtyChange]);

  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { markDirty(false); setError(''); }, [tab, markDirty]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); onDirtyChange(false); };
  }, [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => {
    const abort = new AbortController();
    let current = true;
    setLoading(true); setError('');
    Promise.all([api<Provider[]>('ai/providers', { signal: abort.signal }),
      api<{ allowed_origins: string[] }>('ai/options', { signal: abort.signal })])
      .then(([items, options]) => {
        if (!current) return;
        if (items.length > 1 || items.some(item => item.models.length > 1)) {
          setConfigurationConflict(true); throw new Error('存在多条旧配置，请先整理为一个连接和模型。');
        }
        setConfigurationConflict(false); setProviders(items); setOrigins(options.allowed_origins);
      })
      .catch(reason => { if (current) handleError(reason); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; abort.abort(); };
    // Session callbacks are supplied by Workspace; refetch only on explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  function handleError(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
    else setError(reason instanceof Error ? reason.message : '操作失败，请重试');
  }
  function leave() { return !dirty || window.confirm('模型配置尚未保存。放弃修改？'); }
  async function run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try { return await operation(abort.signal); }
    catch (reason) { if (active.current && !abort.signal.aborted) handleError(reason); }
    finally { if (active.current) setBusy(false); }
  }
  async function refresh(signal: AbortSignal) {
    const items = await api<Provider[]>('ai/providers', { signal });
    if (active.current && !signal.aborted) setProviders(items);
  }

  return <section className="ai-page" aria-labelledby="ai-title">
    <div className="page-heading"><h1 id="ai-title">模型设置</h1></div>
    <Toast notification={notification} onDismiss={dismiss} />
    {error ? <p className="notice error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => { if (leave()) { markDirty(false); setRevision(value => value + 1); } }}>重新读取</button></p> : null}
    {loading ? <p role="status">正在读取模型配置…</p> : tab === 'logs' ? <CallHistory key={revision} onError={handleError} /> : configurationConflict ? null :
      tab === 'connection' ? <ConnectionForm key={(provider?.id ?? '') + ':' + revision} provider={provider} origins={origins} busy={busy}
        onDirty={markDirty} onSave={(data) => run(async signal => {
          await api<Provider>(provider ? `ai/providers/${provider.id}` : 'ai/providers', {
            method: provider ? 'PATCH' : 'POST', body: JSON.stringify(data), signal,
          });
          if (!active.current) return;
          markDirty(false); setRevision(value => value + 1); notify('连接已保存');
        })} onDeleteKey={() => run(async signal => {
          if (!provider || !window.confirm('删除已存密钥？后续请求将不携带密钥。')) return;
          await api(`ai/providers/${provider.id}/key`, { method: 'DELETE', signal });
          if (!active.current) return;
          markDirty(false); setRevision(value => value + 1); notify('密钥已删除');
        })} onDelete={() => run(async signal => {
          if (!provider || !window.confirm(`删除连接“${provider.provider_name}”及其模型？调用记录仍会保留。`)) return;
          await api(`ai/providers/${provider.id}`, { method: 'DELETE', signal });
          if (!active.current) return;
          markDirty(false); setRevision(value => value + 1); notify('连接已删除');
        })} /> : !provider ? <div className="ai-content ai-empty"><h2>先保存一个本地连接</h2><p className="muted">随后添加模型并测试连接。</p>
          <button className="button" onClick={() => onTabChange?.('connection')}>填写连接</button></div> :
        <ModelForm key={provider.id} provider={provider} busy={busy} onDirty={markDirty} onSessionExpired={onSessionExpired}
          onSave={(model, data) => run(async signal => {
            const saved = await api<Model>(model ? `ai/models/${model.id}` : `ai/providers/${provider.id}/models`, {
              method: model ? 'PUT' : 'POST', body: JSON.stringify(data), signal,
            });
            if (!active.current) return;
            markDirty(false); await refresh(signal); notify('模型已保存');
            return saved;
          })} onDelete={model => run(async signal => {
            if (!window.confirm(`删除模型“${model.model_name}”？调用记录仍会保留。`)) return;
            await api(`ai/models/${model.id}`, { method: 'DELETE', signal });
            if (!active.current) return;
            markDirty(false); await refresh(signal); notify('模型已删除');
          })} onTest={(model, kind) => run(async signal => {
            await api(`ai/models/${model.id}/test`, { method: 'POST', body: JSON.stringify({ kind }), signal });
            if (!active.current) return;
            await refresh(signal); notify('测试通过');
          })} />}
  </section>;
}

function ConnectionForm({ provider, origins, busy, onDirty, onSave, onDeleteKey, onDelete }: {
  provider?: Provider; origins: string[]; busy: boolean; onDirty: (value: boolean) => void;
  onSave: (data: object) => Promise<void>; onDeleteKey: () => Promise<void>; onDelete: () => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const key = String(values.get('api_key') ?? '');
    await onSave({ provider_name: values.get('provider_name'), base_url: values.get('base_url'),
      enabled: values.get('enabled') === 'on', ...(!provider || key ? { api_key: key } : {}) });
  }
  return <form ref={form} className="ai-content" onSubmit={submit} onChange={() => onDirty(true)}>
    <div className="ai-fields form-stack">
      <div><h2>{provider ? '连接与密钥' : '添加本地连接'}</h2><p className="muted">使用 OpenAI 兼容接口。密钥加密保存，可留空。</p></div>
      <label>连接名称<input name="provider_name" defaultValue={provider?.provider_name ?? ''} maxLength={80} required placeholder="例如：本机模型" disabled={busy} /></label>
      <label>接口地址<input name="base_url" type="url" defaultValue={provider?.base_url ?? defaultApiBase} maxLength={500} required
        placeholder="http://host.docker.internal:1234/v1" aria-describedby="ai-address-note" disabled={busy} /></label>
      <p id="ai-address-note" className="field-hint">地址需包含 /v1。应用在 Docker 中运行时，用 host.docker.internal 连接宿主机。</p>
      <details className="ai-origins"><summary>允许的服务地址</summary><ul>{origins.map(origin => <li key={origin}>{origin}</li>)}</ul></details>
      <label>API Key（可选）<input name="api_key" type="password" maxLength={4096} autoComplete="new-password" disabled={busy}
        placeholder={provider?.has_api_key ? '已保存；留空保留原密钥' : '本地服务无需密钥时留空'} /></label>
      <p className="field-hint">{provider?.has_api_key ? '密钥已保存。更换接口地址时需重新输入，或先删除密钥。' : '未保存密钥，仅适用于无需验证的本地服务。'}</p>
      <label className="ai-check"><input name="enabled" type="checkbox" defaultChecked={provider?.enabled ?? true} disabled={busy} />启用连接</label>
      {provider ? <div className="ai-secondary-actions">
        <button type="button" className="button" disabled={busy || !provider.has_api_key} onClick={onDeleteKey}>删除密钥</button>
        <button type="button" className="text-button danger-text" disabled={busy} onClick={onDelete}>删除连接</button>
      </div> : null}
    </div>
    <div className="ai-actions"><button className="button primary" disabled={busy}>{busy ? '处理中…' : '保存连接'}</button></div>
  </form>;
}

function ModelForm({ provider, busy, onDirty, onSave, onDelete, onTest, onSessionExpired }: {
  provider: Provider; busy: boolean; onDirty: (value: boolean) => void;
  onSave: (model: Model | undefined, data: object) => Promise<Model | undefined>;
  onDelete: (model: Model) => Promise<void>; onTest: (model: Model, kind: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [catalog, setCatalog] = useState<DiscoveredModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalogSelection, setCatalogSelection] = useState('');
  const [draft, setDraft] = useState({ model_name: '', capabilities: { ...defaults } });
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  const model = provider.models[0];
  useEffect(() => {
    if (catalogSelection) return;
    setDraft({ model_name: model?.model_name ?? '', capabilities: { ...defaults, ...model?.capabilities } });
  }, [model, catalogSelection]);
  useEffect(() => {
    if (!provider.enabled) { setCatalogLoading(false); setCatalogError('请先启用连接'); return; }
    const abort = new AbortController();
    let current = true;
    setCatalogLoading(true); setCatalogError('');
    api<DiscoveredModel[]>(`ai/providers/${provider.id}/discovery`, { signal: abort.signal })
      .then(items => { if (current) setCatalog(items); })
      .catch(reason => {
        if (!current) return;
        if (reason instanceof ApiError && reason.status === 401) expired.current();
        else setCatalogError(reason instanceof Error ? reason.message : '模型列表读取失败');
      })
      .finally(() => { if (current) setCatalogLoading(false); });
    return () => { current = false; abort.abort(); };
  }, [provider.id, provider.enabled, catalogRevision]);
  function applyDiscovered(name: string) {
    const item = catalog.find(item => item.model_name === name);
    if (!item || dirty && !window.confirm('替换当前模型填写内容？未保存的修改将被覆盖。')) return;
    const existing = model?.model_name === name ? model : undefined;
    setCatalogSelection(name);
    setDraft({ model_name: name, capabilities: { ...defaults, ...existing?.capabilities, ...item.capabilities } });
    setDirty(true); onDirty(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const saved = await onSave(model, { model_name: values.get('model_name'), enabled: values.get('enabled') === 'on',
      capabilities: { ...draft.capabilities, vision: values.get('vision') === 'on', streaming: values.get('streaming') === 'on', structured_output: values.get('structured_output') === 'on',
        max_context_tokens: Number(values.get('context')) }, capabilities_confirmed: true });
    if (saved) { setCatalogSelection(''); setDirty(false); }
  }
  useEffect(() => { setDirty(false); }, [provider]);
  return <form key={JSON.stringify(model)} className="ai-content" onSubmit={submit} onChange={event => {
    if (['服务模型'].includes((event.target as HTMLElement).getAttribute('aria-label') ?? '')) return;
    setDirty(true); onDirty(true);
  }}>
    <div className="ai-fields form-stack">
      <div><h2>模型与能力</h2><p className="muted">仅保存一个模型，可从服务列表选择替换。</p></div>
      <label>服务模型<select aria-label="服务模型" value={catalogSelection} disabled={busy || catalogLoading || Boolean(catalogError) || !catalog.length}
        onChange={event => applyDiscovered(event.target.value)}>
        <option value="">{catalogLoading ? '正在读取…' : '选择服务返回的模型'}</option>
        {catalog.map(item => <option key={item.model_name} value={item.model_name}>{item.model_name}</option>)}
      </select></label>
      <div className="ai-secondary-actions"><button className="button" type="button" disabled={busy || catalogLoading || !provider.enabled}
        onClick={() => setCatalogRevision(value => value + 1)}>刷新模型列表</button>
        {catalogLoading ? <span className="field-hint" role="status">正在读取模型列表…</span> : null}</div>
      {catalogError ? <p className="notice error" role="alert">{catalogError}，可手动填写。</p> :
        !catalogLoading && !catalog.length ? <p className="field-hint" role="status">服务暂无可用模型，可手动填写。</p> : null}
      <label>模型名称<input name="model_name" value={draft.model_name} onChange={event => setDraft(value => ({ ...value, model_name: event.target.value }))} maxLength={160} required
        pattern="[a-zA-Z0-9][a-zA-Z0-9._:/\-]*" placeholder="本地服务返回的模型 ID" disabled={busy} /></label>
      <label>上下文长度（Token）<input name="context" type="number" min={256} max={2000000} value={Number.isFinite(draft.capabilities.max_context_tokens) ? draft.capabilities.max_context_tokens : ''}
        onChange={event => setDraft(value => ({ ...value, capabilities: { ...value.capabilities, max_context_tokens: event.target.valueAsNumber } }))} required disabled={busy} /></label>
      <p className="field-hint">服务未返回的字段可手动填写；上下文默认 4096，能力可在保存后测试确认。</p>
      <fieldset className="ai-capabilities" disabled={busy}><legend>模型能力</legend>
        <label className="ai-check"><input name="vision" type="checkbox" checked={draft.capabilities.vision}
          onChange={event => setDraft(value => ({ ...value, capabilities: { ...value.capabilities, vision: event.target.checked } }))} />支持图片识别</label>
        <label className="ai-check"><input name="streaming" type="checkbox" checked={draft.capabilities.streaming}
          onChange={event => setDraft(value => ({ ...value, capabilities: { ...value.capabilities, streaming: event.target.checked } }))} />支持流式输出</label>
        <label className="ai-check"><input name="structured_output" type="checkbox" checked={draft.capabilities.structured_output}
          onChange={event => setDraft(value => ({ ...value, capabilities: { ...value.capabilities, structured_output: event.target.checked } }))} />支持原生 JSON Schema</label>
      </fieldset>
      <p className="field-hint">不支持原生 JSON Schema 时，使用文本生成与结构校验；失败后最多修复两次。</p>
      <label className="ai-check"><input name="enabled" type="checkbox" defaultChecked={model?.enabled ?? true} disabled={busy} />启用模型</label>
      {model ? <section className="ai-probes" aria-label="能力测试"><h3>能力测试</h3>
        <p className="field-hint">仅发送固定测试文本，不包含课程资料。测试会使用本地模型算力。</p>
        <div className="ai-test-buttons">{([['chat', '普通回复'], ['stream', '流式输出'], ['structured', '原生结构化']] as const).map(([kind, label]) =>
          <button key={kind} className="button" type="button" disabled={busy || dirty || !model.enabled || !provider.enabled} onClick={() => onTest(model, kind)}>
            测试{label}{model.tested_capabilities[kind] ? ' · 已通过' : ''}</button>)}</div>
        <button type="button" className="text-button danger-text" disabled={busy} onClick={() => onDelete(model)}>删除模型</button>
      </section> : null}
    </div>
    <div className="ai-actions"><button className="button primary" disabled={busy}>{busy ? '处理中…' : '保存模型'}</button></div>
  </form>;
}

function CallHistory({ onError }: { onError: (reason: unknown) => void }) {
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    setLoading(true); setFailed(false);
    api<CallLog[]>(`ai/calls?offset=${offset}`, { signal: abort.signal }).then(value => { if (active) setLogs(value); })
      .catch(reason => { if (active) { setFailed(true); onError(reason); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; abort.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, revision]);
  return <div className="ai-content"><div className="ai-fields"><div className="panel-heading"><h2>调用记录</h2>
    <button className="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新</button></div>
    <p className="field-hint">仅记录状态、耗时和可用的 Token 用量，不保存问题、回复或密钥。</p>
    {loading ? <p role="status">正在读取调用记录…</p> : failed ? <p>读取失败，请刷新重试。</p> : !logs.length ? <p className="muted">暂无调用记录</p> :
      <ul className="ai-log-list">{logs.map(item => <li key={item.id}><div><strong>{item.provider_name} / {item.model_name}</strong>
        <span className={item.status === 'FAILED' ? 'danger-text' : 'muted'}>{states[item.status] ?? item.status}</span></div>
        <p className="muted">{new Date(item.created_at + (item.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()} · {item.duration_ms} ms · {item.attempts} 次请求</p>
        <p className="muted">输入 {item.input_tokens ?? '—'} / 输出 {item.output_tokens ?? '—'} Token{item.error_code ? ` · ${item.error_code}` : ''}</p></li>)}</ul>}
    </div><div className="ai-actions"><button className="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button>
      <button className="button" disabled={loading || logs.length < 100} onClick={() => setOffset(value => value + 100)}>下一页</button></div></div>;
}
