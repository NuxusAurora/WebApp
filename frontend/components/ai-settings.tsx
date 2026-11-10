'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Toast, useToast } from './toast';

type ProbeKind = 'vision' | 'stream' | 'structured';
const capabilityProbes = [['vision', '图片识别'], ['stream', '流式输出'], ['structured', '原生 JSON Schema']] as const;

type Capabilities = { vision: boolean; streaming: boolean; structured_output: boolean; tool_calling: boolean; max_context_tokens: number };
type Model = { id: string; provider_id: string; model_name: string; enabled: boolean; capabilities: Capabilities;
  capability_source: string; tested_capabilities: Record<string, boolean> };
type ConnectionKind = 'default' | 'custom';
type Provider = { provider_kind?: ConnectionKind; id: string; provider_name: string; base_url: string; has_api_key: boolean; enabled: boolean; models: Model[]; required_model_name?: string | null };
type DiscoveredModel = { model_name: string; capabilities: Partial<Capabilities> };
type CallLog = { id: string; model_id: string; model_name: string; provider_name: string; task_type: string; status: string; duration_ms: number;
  attempts: number; input_tokens: number | null; output_tokens: number | null; error_code: string | null; created_at: string };
const defaults: Capabilities = { vision: false, streaming: false, structured_output: false, tool_calling: false, max_context_tokens: 4096 };
const states: Record<string, string> = { SUCCEEDED: '成功', FAILED: '失败', CANCELLED: '已取消', RUNNING: '进行中' };
const defaultApiBase = 'https://api.nuxusaurora.com/v1';
const connectionKind = (provider: Provider): ConnectionKind => provider.provider_kind ?? (provider.required_model_name ? 'default' : 'custom');

export function AISettings({ onDirtyChange, onSessionExpired, tab = 'connection', onTabChange, onBusyChange }: {
  onDirtyChange: (dirty: boolean) => void; onSessionExpired: () => void;
  tab?: 'connection' | 'models' | 'logs'; onTabChange?: (tab: 'connection') => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [configurationConflict, setConfigurationConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState<ProbeKind | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const { notification, notify, dismiss } = useToast();
  const provider = providers.find(item => item.enabled);
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
    api<Provider[]>('ai/providers', { signal: abort.signal })
      .then(items => {
        if (!current) return;
        if (items.length > 2 || new Set(items.map(connectionKind)).size !== items.length || items.filter(item => item.enabled).length > 1 || items.some(item => item.models.length > 1)) {
          setConfigurationConflict(true); throw new Error('存在重复连接配置，请先整理为默认和自定义各一套。');
        }
        setConfigurationConflict(false); setProviders(items);
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

  return <section className="ai-page" aria-label={tab === 'models' ? '模型与测试' : tab === 'logs' ? '调用记录' : '连接与密钥'}>
    <Toast notification={notification} onDismiss={dismiss} />
    {error ? <p className="notice error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => { if (leave()) { markDirty(false); setRevision(value => value + 1); } }}>重新读取</button></p> : null}
    {loading ? <p role="status">正在读取模型配置…</p> : tab === 'logs' ? <CallHistory key={revision} onError={handleError} /> : configurationConflict ? null :
      tab === 'connection' ? <ConnectionSettings key={revision} providers={providers} busy={busy}
        onDirty={markDirty} onSave={(connection, data) => run(async signal => {
          const saved = await api<Provider>(connection ? `ai/providers/${connection.id}` : 'ai/providers', {
            method: connection ? 'PATCH' : 'POST', body: JSON.stringify(data), signal,
          });
          if (!active.current) return;
          await refresh(signal); notify('连接已保存'); return saved;
        })} onSelect={(kind, connection) => {
          if (!leave()) return Promise.resolve();
          return run(async signal => {
          await api(connection ? `ai/providers/${connection.id}/activate` : 'ai/providers', { method: 'POST', signal,
            ...(!connection ? { body: JSON.stringify({ provider_name: kind === 'default' ? '默认连接' : '自定义连接', provider_kind: kind, base_url: kind === 'default' ? defaultApiBase : '', enabled: true }) } : {}) });
          if (!active.current) return;
          markDirty(false); setRevision(value => value + 1); notify('已切换连接');
        }); }} /> : !provider ? <div className="ai-content ai-empty"><h2>先选择并保存一个连接</h2><p className="muted">随后添加模型并测试连接。</p>
          <button className="button" onClick={() => onTabChange?.('connection')}>填写连接</button></div> :
        !provider.base_url ? <div className="ai-content ai-empty"><h2>先填写自定义连接</h2><p className="muted">保存接口地址和密钥后再配置模型。</p><button className="button" onClick={() => onTabChange?.('connection')}>填写连接</button></div> :
        <ModelForm key={provider.id} provider={provider} busy={busy} probing={probing} onDirty={markDirty} onSessionExpired={onSessionExpired}
          onSave={(model, data) => run(async signal => {
            const saved = await api<Model>(model ? `ai/models/${model.id}` : `ai/providers/${provider.id}/models`, {
              method: model ? 'PUT' : 'POST', body: JSON.stringify(data), signal,
            });
            if (!active.current) return;
            markDirty(false); await refresh(signal);
            let failed = false;
            try {
              for (const [kind] of capabilityProbes) {
                if (!active.current || signal.aborted) return;
                setProbing(kind);
                try { await api(`ai/models/${saved.id}/test`, { method: 'POST', body: JSON.stringify({ kind }), signal }); }
                catch (reason) {
                  if (signal.aborted || !active.current) return;
                  if (reason instanceof ApiError && [401, 409].includes(reason.status)) throw reason;
                  failed = true;
                }
                if (!active.current || signal.aborted) return;
                await refresh(signal);
              }
              if (failed) setError('模型已保存，部分能力测试未通过。请检查接口后重新保存。');
              else notify('模型已保存，能力测试已完成');
              return saved;
            } finally { if (active.current) setProbing(null); }
          })} />}
  </section>;
}

function ConnectionSettings({ providers, busy, onDirty, onSave, onSelect }: {
  providers: Provider[]; busy: boolean; onDirty: (value: boolean) => void;
  onSave: (provider: Provider | undefined, data: object) => Promise<Provider | undefined>;
  onSelect: (kind: ConnectionKind, provider: Provider | undefined) => Promise<void>;
}) {
  const defaultProvider = providers.find(item => connectionKind(item) === 'default');
  const customProvider = providers.find(item => connectionKind(item) === 'custom');
  return <div className="ai-content"><div className="ai-fields form-stack">
    <h2>连接与密钥</h2>
    <section className="ai-connection-form form-stack" aria-label="默认连接">
      <div className="panel-heading"><h3>默认连接</h3><button className="button ai-connection-choice" type="button" aria-label={defaultProvider?.enabled ? '默认连接已启用' : '选择默认连接'} disabled={busy || defaultProvider?.enabled} onClick={() => onSelect('default', defaultProvider)}>{defaultProvider?.enabled ? '已启用' : '选择'}</button></div>
      <p className="muted">Aurora-Zyron</p>
    </section>
    <ConnectionForm provider={customProvider} busy={busy} onDirty={onDirty} onSave={async (provider, data) => {
      const saved = await onSave(provider, data);
      if (saved) onDirty(false);
      return saved;
    }} onSelect={onSelect} />
  </div></div>;
}

function ConnectionForm({ provider, busy, onDirty, onSave, onSelect }: {
  provider?: Provider; busy: boolean; onDirty: (value: boolean) => void;
  onSave: (provider: Provider | undefined, data: object) => Promise<Provider | undefined>;
  onSelect: (kind: ConnectionKind, provider: Provider | undefined) => Promise<void>;
}) {
  const fieldsId = useId();
  const showFields = Boolean(provider?.enabled);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const key = String(values.get('api_key') ?? '');
    const element = event.currentTarget;
    const saved = await onSave(provider, { ...(!provider ? { provider_name: '自定义连接', provider_kind: 'custom' } : {}),
      base_url: values.get('base_url'), enabled: true, ...(!provider || key ? { api_key: key } : {}) });
    if (saved) element.reset();
  }
  return <form className="ai-connection-form form-stack" aria-label="自定义连接" onSubmit={submit} onChange={() => onDirty(true)}>
    <div className="ai-connection-heading"><h3>自定义连接</h3><button className="button ai-connection-choice" type="button" aria-label={provider?.enabled ? '自定义连接已启用' : '选择自定义连接'} aria-expanded={showFields} aria-controls={fieldsId} disabled={busy || provider?.enabled} onClick={() => onSelect('custom', provider)}>{provider?.enabled ? '已启用' : '选择'}</button></div>
    <div className="ai-custom-fields motion-disclosure" id={fieldsId} hidden={!showFields} inert={!showFields} aria-hidden={!showFields}>
    <label>接口地址<input name="base_url" type="url" defaultValue={provider?.base_url ?? ''} maxLength={500} required
      placeholder="https://example.com/v1" disabled={busy} /></label>
    <label>API Key（可选）<input name="api_key" type="password" maxLength={4096} autoComplete="new-password" disabled={busy}
      placeholder={provider?.has_api_key ? '已保存；留空保留原密钥' : '无需密钥时留空'} /></label>
    <p className="field-hint">{provider?.has_api_key ? '密钥已保存。更换接口地址时需重新输入密钥。' : '未保存密钥。'}</p>
    <div className="ai-connection-actions">
      <button className="button primary" disabled={busy}>{busy ? '处理中…' : '保存'}</button>
    </div>
    </div>
  </form>;
}

function ModelForm({ provider, busy, probing, onDirty, onSave, onSessionExpired }: {
  provider: Provider; busy: boolean; probing: ProbeKind | null; onDirty: (value: boolean) => void;
  onSave: (model: Model | undefined, data: object) => Promise<Model | undefined>;
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
  const requiredModel = provider.required_model_name;
  const modelNames = Array.from(new Set([...catalog.map(item => item.model_name),
    ...(model ? [model.model_name] : []), ...(draft.model_name ? [draft.model_name] : [])]));
  useEffect(() => {
    if (catalogSelection) return;
    setDraft({ model_name: requiredModel ?? model?.model_name ?? '', capabilities: { ...defaults, ...model?.capabilities } });
  }, [model, catalogSelection, requiredModel]);
  useEffect(() => {
    if (requiredModel) { setCatalogLoading(false); setCatalogError(''); return; }
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
  }, [provider.id, provider.enabled, catalogRevision, requiredModel]);
  function applyDiscovered(name: string) {
    if (requiredModel) return;
    const item = catalog.find(item => item.model_name === name);
    const existing = model?.model_name === name ? model : undefined;
    if ((!item && !existing) || dirty && !window.confirm('替换当前模型填写内容？未保存的修改将被覆盖。')) return;
    setCatalogSelection(name);
    setDraft({ model_name: name, capabilities: { ...defaults, ...existing?.capabilities, ...item?.capabilities } });
    setDirty(true); onDirty(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!draft.model_name) return;
    const saved = await onSave(model, { model_name: draft.model_name, enabled: true,
      capabilities: { ...draft.capabilities, vision: false, streaming: false, structured_output: false,
        max_context_tokens: Number(values.get('context')) }, capabilities_confirmed: true });
    if (saved) { setCatalogSelection(''); setDirty(false); }
  }
  useEffect(() => { setDirty(false); }, [provider]);
  return <form key={JSON.stringify(model)} className="ai-content" onSubmit={submit} onChange={event => {
    if (['选择模型'].includes((event.target as HTMLElement).getAttribute('aria-label') ?? '')) return;
    setDirty(true); onDirty(true);
  }}>
    <div className="ai-fields form-stack">
      <label>选择模型<select aria-label="选择模型" value={requiredModel ?? draft.model_name} required disabled={Boolean(requiredModel) || busy || catalogLoading || Boolean(catalogError) || !modelNames.length}
        onChange={event => applyDiscovered(event.target.value)}>
        {requiredModel ? <option value={requiredModel}>{requiredModel}</option> : <><option value="" disabled>{catalogLoading ? '正在读取…' : '选择服务返回的模型'}</option>
          {modelNames.map(name => <option key={name} value={name}>{name}</option>)}</>}
      </select></label>
      {!requiredModel ? <div className="ai-secondary-actions"><button className="button" type="button" disabled={busy || catalogLoading || !provider.enabled}
        onClick={() => setCatalogRevision(value => value + 1)}>刷新模型列表</button>
        {catalogLoading ? <span className="field-hint" role="status">正在读取模型列表…</span> : null}</div> : null}
      {!requiredModel && (catalogError ? <p className="notice error" role="alert">{catalogError}，请重试。</p> :
        !catalogLoading && !catalog.length ? <p className="field-hint" role="status">服务暂无可用模型，请刷新重试。</p> : null)}
      <label>上下文长度（Token）<input name="context" type="number" min={256} max={2000000} value={Number.isFinite(draft.capabilities.max_context_tokens) ? draft.capabilities.max_context_tokens : ''}
        onChange={event => setDraft(value => ({ ...value, capabilities: { ...value.capabilities, max_context_tokens: event.target.valueAsNumber } }))} required disabled={busy} /></label>
      <fieldset className="ai-capabilities"><legend>模型能力</legend>
        {capabilityProbes.map(([kind, label]) => {
          const result = model?.tested_capabilities[kind];
          const state = probing === kind ? '测试中…' : dirty || result === undefined ? '待测试' : result ? '已通过' : '未通过';
          return <div key={kind} className="ai-capability-row"><span>{label}</span><span role="status" aria-label={label + '：' + state}>{state}</span></div>;
        })}
      </fieldset>
    </div>
    <div className="ai-actions"><button className="button primary" disabled={busy || !draft.model_name}>{probing ? '自动测试中…' : busy ? '处理中…' : '保存'}</button></div>
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
