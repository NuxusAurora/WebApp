'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Curriculum, Provider } from '../lib/curriculum';
import { pointPayload, validKnowledge, type KnowledgeData, type KnowledgePayload, type KnowledgeVersion, type PointInput } from '../lib/knowledge';

type Props = { onDirtyChange: (dirty: boolean) => void; onSessionExpired?: () => void };
type SectionChoice = { id: string; title: string; chapter: string };
const importance = { HIGH: '重点', MEDIUM: '常规', LOW: '拓展' };
const statuses = { NOT_STARTED: '尚未学习', LEARNING: '正在学习', PRACTICING: '正在练习', NEEDS_REVIEW: '需要复习', MASTERED: '已掌握' };

export function KnowledgeEditor({ courseId, onDirtyChange, onSessionExpired }: Props & { courseId: string }) {
  const [sections, setSections] = useState<SectionChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const dirty = useRef(false);
  const callbacks = useRef({ onDirtyChange, onSessionExpired });
  callbacks.current = { onDirtyChange, onSessionExpired };
  useEffect(() => {
    const task = new AbortController();
    setLoading(true); setError('');
    void api<Curriculum>('courses/' + courseId + '/curriculum', { signal: task.signal }).then(data => {
      if (task.signal.aborted) return;
      const choices = data.curriculum.chapters.flatMap(chapter => chapter.sections.map(section => ({ ...section, chapter: chapter.title })));
      setSections(choices); setSelected(previous => choices.some(s => s.id === previous) ? previous : choices[0]?.id ?? '');
    }).catch(reason => {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) callbacks.current.onSessionExpired?.();
      else setError(reason instanceof Error ? reason.message : '小节读取失败，请重试');
    }).finally(() => { if (!task.signal.aborted) setLoading(false); });
    return () => task.abort();
  }, [courseId, reload]);
  const reportDirty = (value: boolean) => { dirty.current = value; callbacks.current.onDirtyChange(value); };
  return <section className="knowledge" aria-label="知识点">
    {loading ? <p role="status">正在加载小节…</p> : error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setReload(v => v + 1)}>重新加载小节</button></div> :
      !sections.length ? <p className="muted">先在教材目录中确认小节，再生成知识点。</p> : <>
        <label className="knowledge-section">小节<select value={selected} onChange={event => {
          if (dirty.current && !window.confirm('当前修改尚未保存或生成尚未完成。离开此小节？')) return;
          reportDirty(false); setSelected(event.target.value);
        }}>{sections.map(s => <option key={s.id} value={s.id}>{s.chapter} / {s.title}</option>)}</select></label>
        <SectionKnowledge key={selected} sectionId={selected} onDirtyChange={reportDirty} onSessionExpired={onSessionExpired} />
      </>}
  </section>;
}

function SectionKnowledge({ sectionId, onDirtyChange, onSessionExpired }: Props & { sectionId: string }) {
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [version, setVersion] = useState<KnowledgeVersion | null>(null);
  const [payload, setPayload] = useState<KnowledgePayload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [acceptArchives, setAcceptArchives] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const callbacks = useRef({ onDirtyChange, onSessionExpired });
  callbacks.current = { onDirtyChange, onSessionExpired };
  const path = 'sections/' + sectionId + '/knowledge-points';
  useEffect(() => { callbacks.current.onDirtyChange(dirty || Boolean(busy)); }, [dirty, busy]);
  useEffect(() => () => { controller.current?.abort(); callbacks.current.onDirtyChange(false); }, []);

  function fail(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) callbacks.current.onSessionExpired?.();
    else { setError(reason instanceof Error ? reason.message : '操作失败，请重试'); requestAnimationFrame(() => errorRef.current?.focus()); }
  }
  function adopt(next: KnowledgeVersion | null) {
    setVersion(next); setPayload(next ? structuredClone(next.payload) : null); setDirty(false); setConfirming(false); setAcceptArchives(false);
  }
  async function load(signal: AbortSignal, restore = false) {
    const [current, connections] = await Promise.all([api<KnowledgeData>(path, { signal }), api<Provider[]>('ai/providers', { signal })]);
    if (signal.aborted) return;
    setData(current); setProviders(connections); if (restore) adopt(current.draft);
  }
  async function refresh() {
    const task = new AbortController(); controller.current?.abort(); controller.current = task;
    setLoading(true); setError('');
    try { await load(task.signal, true); } catch (reason) { if (!task.signal.aborted) fail(reason); }
    finally { if (!task.signal.aborted) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [sectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const task = new AbortController(); controller.current = task;
    setBusy(label); setError(''); setNotice(''); setConfirming(false);
    try { await action(task.signal); } catch (reason) { if (!task.signal.aborted) fail(reason); }
    finally { if (!task.signal.aborted) setBusy(''); }
  }
  function change(next: KnowledgePayload) { setPayload(next); setDirty(true); setConfirming(false); }
  function editPoint(index: number, patch: Partial<PointInput>) {
    if (payload) change({ ...payload, knowledge_points: payload.knowledge_points.map((point, i) => i === index ? { ...point, ...patch } : point) });
  }
  const model = providers.filter(p => p.enabled).flatMap(provider => provider.models.filter(m => m.enabled).map(m => ({ ...m, provider }))).at(0);
  const stale = Boolean(version && data && version.base_course_revision !== data.confirmed_revision);
  const disabled = Boolean(busy) || stale;
  async function generate() {
    if (!data || !model) { setError('请先在模型设置中启用模型。'); return; }
    if ((payload || version) && !window.confirm('重新生成将替换当前知识草稿，正式知识点保持到确认时更新。继续？')) return;
    await run('正在生成知识点…', async signal => {
      const next = await api<KnowledgeVersion>(path + '/generate', { method: 'POST', signal, body: JSON.stringify({
        provider_id: model.provider.id, model_id: model.id, base_course_revision: data.confirmed_revision,
        ...(data.draft ? { replace_version_id: data.draft.id, replace_revision: data.draft.revision } : {}),
      }) });
      if (signal.aborted) return;
      adopt(next); await load(signal); if (!signal.aborted) setNotice('知识草稿已生成，请核对');
    });
  }
  return <div className="knowledge-content" aria-busy={Boolean(busy)}>
    {error ? <p ref={errorRef} tabIndex={-1} className="notice error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {loading ? <p role="status">正在加载知识点…</p> : !data ? <button className="button" onClick={() => void refresh()}>重新加载知识点</button> : <>
      <div className="knowledge-toolbar">
        <button className="button primary" disabled={Boolean(busy) || confirming} onClick={() => void generate()}>{data.knowledge_points.length || version ? '重新生成知识点' : '生成知识点'}</button>
        {!payload ? <button className="button" disabled={Boolean(busy)} onClick={() => {
          if (data.draft) adopt(data.draft);
          else { setVersion(null); setPayload(pointPayload(data.knowledge_points)); setDirty(true); }
        }}>{data.draft ? '继续编辑知识草稿' : '编辑知识点'}</button> : null}
        <button className="text-button" disabled={Boolean(busy)} onClick={() => { if (!dirty || window.confirm('放弃未保存的知识点修改并重新加载？')) void refresh(); }}>重新加载</button>
      </div>
      {!payload ? (data.knowledge_points.length ? <ol className="knowledge-list">{data.knowledge_points.map(point => <li key={point.id}>
        <div className="knowledge-point-heading"><h3>{point.title}</h3><span className="muted">{importance[point.importance]} · {statuses[point.status]}</span></div>
        <p>{point.description}</p><details><summary>学习目标与掌握标准</summary>
          <h4>学习目标</h4><ul>{point.learning_objectives.map((text, i) => <li key={i}>{text}</li>)}</ul>
          <h4>掌握标准</h4><ul>{point.mastery_criteria.map((text, i) => <li key={i}>{text}</li>)}</ul>
        </details></li>)}</ol> : <p className="muted">此小节还没有知识点。</p>) : <>
        <p className="muted">知识草稿 · 确认后应用到课程</p>
        {stale ? <p role="alert" className="notice error">课程结构已变化。请重新加载后，从正式知识点编辑或重新生成；旧草稿仍保留。</p> : null}
        <fieldset disabled={disabled} className="knowledge-fields"><legend className="visually-hidden">知识草稿</legend>
          {payload.uncertain_items.length ? <div className="knowledge-uncertainties"><h3>待核对项</h3><ul>{payload.uncertain_items.map((item, index) => <li key={index}>
            <span>{item}</span><button className="text-button" onClick={() => change({ ...payload, uncertain_items: payload.uncertain_items.filter((_, i) => i !== index) })}>已核对第 {index + 1} 项</button>
          </li>)}</ul></div> : null}
          <ol className="knowledge-list">{payload.knowledge_points.map((point, index) => <li key={point.temp_id}>
            <div className="knowledge-point-heading"><h3>知识点 {index + 1}</h3><button className="text-button" onClick={() => {
              if (window.confirm('从草稿移除“' + (point.title || '未命名知识点') + '”？正式节点将在确认后归档。')) change({ ...payload, knowledge_points: payload.knowledge_points.filter((_, i) => i !== index) });
            }}>移除知识点 {index + 1}</button></div>
            <label>名称<input aria-label={'知识点 ' + (index + 1) + '名称'} value={point.title} maxLength={200} required onChange={e => editPoint(index, { title: e.target.value })} /></label>
            <label>定义<textarea aria-label={'知识点 ' + (index + 1) + '定义'} value={point.description} maxLength={4000} required rows={3} onChange={e => editPoint(index, { description: e.target.value })} /></label>
            <div className="knowledge-goals"><label>学习目标（每行一项）<textarea aria-label={'知识点 ' + (index + 1) + '学习目标'} value={point.learning_objectives.join('\n')} required rows={3} onChange={e => editPoint(index, { learning_objectives: e.target.value.split('\n') })} /></label>
              <label>掌握标准（每行一项）<textarea aria-label={'知识点 ' + (index + 1) + '掌握标准'} value={point.mastery_criteria.join('\n')} required rows={3} onChange={e => editPoint(index, { mastery_criteria: e.target.value.split('\n') })} /></label></div>
            <label className="knowledge-importance">重要程度<select aria-label={'知识点 ' + (index + 1) + '重要程度'} value={point.importance} onChange={e => editPoint(index, { importance: e.target.value as PointInput['importance'] })}>
              {Object.entries(importance).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
            </select></label>
            {(!point.title.trim() || !point.description.trim()) ? <small role="status">名称和定义必填。</small> : null}
          </li>)}</ol>
          <button className="button" disabled={payload.knowledge_points.length >= 50} onClick={() => change({ ...payload, knowledge_points: [...payload.knowledge_points, {
            temp_id: 'kp_' + crypto.randomUUID(), existing_knowledge_point_id: null, title: '', description: '', learning_objectives: [''], importance: 'MEDIUM', mastery_criteria: [''],
          }] })}>添加知识点</button>
        </fieldset>
        {!validKnowledge(payload) ? <small role="status">名称、定义、学习目标和掌握标准必填；目标及标准各限 20 项，每项 500 字。</small> : null}
        <div className="knowledge-actions">
          <button className="button" disabled={disabled || !dirty || !validKnowledge(payload)} onClick={() => void run('正在保存草稿…', async signal => {
            const replacement = !version && data.draft ? { replace_version_id: data.draft.id, replace_revision: data.draft.revision } : {};
            const next = await api<KnowledgeVersion>(version ? path : path + '/drafts', { method: version ? 'PATCH' : 'POST', signal,
              body: JSON.stringify({ payload, base_course_revision: version?.base_course_revision ?? data.confirmed_revision, ...replacement,
                ...(version ? { version_id: version.id, expected_revision: version.revision } : {}) }) });
            if (signal.aborted) return;
            adopt(next); await load(signal); if (!signal.aborted) setNotice('知识草稿已保存');
          })}>保存知识草稿</button>
          {version ? <button className="button" disabled={disabled || dirty || Boolean(payload.uncertain_items.length) || confirming} onClick={() => { setConfirming(true); setAcceptArchives(false); }}>核对并确认知识点</button> : null}
          <button className="text-button" disabled={Boolean(busy)} onClick={() => {
            if (dirty && !window.confirm('放弃未保存的知识点修改？')) return;
            setPayload(null); setDirty(false); setConfirming(false);
          }}>关闭编辑</button>
          {stale ? <button className="button" disabled={Boolean(busy)} onClick={() => {
            if (!window.confirm('用正式知识点重新编辑，保存后替换过期草稿？')) return;
            setPayload(pointPayload(data.knowledge_points)); setVersion(null); setDirty(true); setConfirming(false);
          }}>从正式知识点重新编辑</button> : null}
        </div>
        {version && !dirty ? <div className="knowledge-diff"><p>新增 {version.change_summary.added.length} · 修改 {version.change_summary.modified.length} · 归档 {version.change_summary.archived.length}</p>
          {(['added', 'modified', 'archived'] as const).map(kind => version.change_summary[kind].length ? <details key={kind} open={kind === 'archived'}>
            <summary>{kind === 'added' ? '新增项' : kind === 'modified' ? '修改项' : '归档项'}</summary><ul>{version.change_summary[kind].map(item => <li key={item.id}>{item.title}{item.review_mastery ? ' · 内容已变化，请复核原掌握状态' : ''}</li>)}</ul>
          </details> : null)}
          {version.source.model_name ? <small>生成模型：{version.source.model_name}</small> : null}
        </div> : null}
        {confirming && version ? <div className="knowledge-confirm" role="region" aria-label="确认知识点"><h3>应用这份知识草稿？</h3><p>确认内容不会改变已有学习状态，移除的知识点将归档。</p>
          {version.change_summary.archived.length ? <label className="knowledge-archive"><input type="checkbox" checked={acceptArchives} onChange={e => setAcceptArchives(e.target.checked)} />我已核对全部归档知识点</label> : null}
          <div className="button-row"><button className="button primary" disabled={Boolean(busy) || Boolean(version.change_summary.archived.length && !acceptArchives)} onClick={() => void run('正在确认知识点…', async signal => {
            await api(path + '/confirm', { method: 'POST', signal, body: JSON.stringify({ version_id: version.id, expected_revision: version.revision, base_course_revision: version.base_course_revision, accept_archives: acceptArchives }) });
            if (signal.aborted) return;
            adopt(null); await load(signal); if (!signal.aborted) setNotice('知识点已确认');
          })}>确认应用知识点</button><button className="button" disabled={Boolean(busy)} onClick={() => setConfirming(false)}>取消</button></div>
        </div> : null}
      </>}
      {busy ? <p role="status">{busy}</p> : null}
    </>}
  </div>;
}
