'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { CurriculumOutline } from './curriculum-outline';
import { cleanTitles } from '../lib/curriculum-title';
import { temporaryId, validPayload, type Curriculum, type Payload, type Photo, type Provider, type Version } from '../lib/curriculum';

function pageLabel(node: { page_start?: number | null; page_end?: number | null }) {
  return node.page_start != null || node.page_end != null ? `（${node.page_start ?? '?'}–${node.page_end ?? '?'} 页）` : '';
}

export function CurriculumEditor({ courseId, onDirtyChange, onSessionExpired }: {
  courseId: string; onDirtyChange: (dirty: boolean) => void; onSessionExpired?: () => void;
}) {
  const [data, setData] = useState<Curriculum | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [version, setVersion] = useState<Version | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [acceptArchives, setAcceptArchives] = useState(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onDirtyChange, onSessionExpired });
  callbacks.current = { onDirtyChange, onSessionExpired };
  const path = 'courses/' + courseId + '/curriculum';

  useEffect(() => {
    callbacks.current.onDirtyChange(dirty || Boolean(busy));
  }, [dirty, busy]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); callbacks.current.onDirtyChange(false); };
  }, []);

  function failure(reason: unknown) {
    if (!alive.current) return;
    if (reason instanceof ApiError && reason.status === 401) callbacks.current.onSessionExpired?.();
    else { setError(reason instanceof Error ? reason.message : '操作失败，请重试');
      requestAnimationFrame(() => errorRef.current?.focus()); }
  }
  async function load(signal: AbortSignal, restoreDraft = false) {
    const [current, connections] = await Promise.all([
      api<Curriculum>(path, { signal }),
      api<Provider[]>('ai/providers', { signal }),
    ]);
    if (!alive.current || signal.aborted) return;
    setData(current); setProviders(connections);
    if (restoreDraft) {
      const draft = current.versions.find(item => item.status === 'DRAFT');
      if (draft) adopt(draft);
      else { setVersion(null); setPayload(null); setDirty(false); setConfirming(false); }
    }
  }
  async function refresh() {
    const task = new AbortController(); controller.current = task;
    setLoading(true); setError('');
    try { await load(task.signal, true); } catch (reason) { if (!task.signal.aborted) failure(reason); }
    finally { if (alive.current && !task.signal.aborted) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    const task = new AbortController(); controller.current = task;
    setBusy(label); setError(''); setNotice(''); setConfirming(false);
    try { await action(task.signal); }
    catch (reason) { if (!task.signal.aborted) failure(reason); }
    finally { if (alive.current && !task.signal.aborted) setBusy(''); }
  }
  function adopt(next: Version) {
    setVersion(next); setPayload(cleanTitles(structuredClone(next.payload))); setDirty(false);
    setConfirming(false); setAcceptArchives(false);
  }
  function canLeave() { return !dirty || window.confirm('目录修改尚未保存。放弃修改？'); }
  function change(next: Payload) { setPayload(next); setDirty(true); setConfirming(false); }
  const selectedModel = providers.filter(provider => provider.enabled).flatMap(provider =>
    provider.models.filter(model => model.enabled && model.capabilities?.vision).map(model => ({ ...model, provider }))).at(0);
  async function upload(file: File) {
    if (busy) return;
    if (!file.size || file.size > 5 * 1024 * 1024) { setError('请选择 5 MiB 内的 PNG 或 JPEG 图片'); return; }
    if (!selectedModel) { setError('请先在模型设置中启用支持图片的模型。'); return; }
    if (dirty && !window.confirm('上传新图片将替换未保存的目录修改，继续？')) return;
    await run('上传中…', async signal => {
      const photo = await api<Photo>(path + '/images', { method: 'POST', body: file, signal,
        headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) } });
      if (signal.aborted) return;
      setBusy('模型识别中…');
      const next = await api<Version>(path + '/parse', { method: 'POST', signal,
        body: JSON.stringify({ input_mode: 'images', ocr_text: '',
          image_ids: [photo.id], provider_id: selectedModel.provider.id, model_id: selectedModel.id }) });
      if (!signal.aborted) {
        adopt(next);
        await load(signal); setNotice('草稿已生成，请核对后确认');
      }
    });
  }
  const editable = Boolean(payload && (!version || version.status === 'DRAFT'));
  const stale = Boolean(version && data && version.base_course_revision !== data.confirmed_revision && version.status === 'DRAFT');
  return <section className="curriculum" aria-label="教材目录" aria-busy={Boolean(busy)}>
    {error ? <p ref={errorRef} tabIndex={-1} className="notice error" role="alert">{error}</p> : null}
    {notice ? <p role="status" className="curriculum-notice">{notice}</p> : null}
    {loading ? <p role="status">正在加载目录…</p> : !data ? <button className="button" onClick={() => void refresh()}>重新加载目录</button> : <>
      <button className="button curriculum-upload" disabled={Boolean(busy)} onClick={() => uploadInput.current?.click()}>上传</button>
      <input ref={uploadInput} type="file" hidden aria-label="上传目录图片" accept="image/png,image/jpeg" disabled={Boolean(busy)}
        onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void upload(file);
        }} />
      {payload || data.curriculum.chapters.length ? <CurriculumOutline payload={payload ?? data.curriculum}
        disabled={Boolean(busy) || Boolean(payload && (!editable || stale))} selectedId={selectedId} onSelect={setSelectedId}
        onChange={next => { if (!payload) setVersion(null); change(next); }} /> :
        null}
      {stale ? <p role="alert" className="notice error">此草稿基线已过期，请从当前正式目录重新编辑。</p> : null}
      {payload ? <>
        <fieldset className="curriculum-fields" disabled={Boolean(busy) || !editable || stale}>
          <legend className="visually-hidden">章节编辑</legend>
          {payload.uncertain_items?.length ? <div className="curriculum-uncertainties"><h3>待核对项</h3><ul>{payload.uncertain_items.map((item, index) =>
            <li key={index}><span>{item}</span><button className="text-button" onClick={() => change({ ...payload,
              uncertain_items: payload.uncertain_items!.filter((_, i) => i !== index) })}>已核对第 {index + 1} 项</button></li>)}</ul></div> : null}

          <button className="button" disabled={payload.chapters.length >= 50} onClick={() => {
            const id = temporaryId(); setSelectedId(id); change({ ...payload, chapters: [...payload.chapters, { id, title: '', sections: [] }] });
          }}>添加章节</button>
        </fieldset>
        {editable && !validPayload(cleanTitles(payload)) ? <small role="status">至少保留一章，标题必填；页码为 1–100000，结束页不小于起始页。</small> : null}
        <div className="curriculum-save-actions">
          {editable ? <button className="button" disabled={Boolean(busy) || !dirty || !validPayload(cleanTitles(payload)) || stale} onClick={() => void run('保存中…', async signal => {
            const next = await api<Version>(version ? path : path + '/drafts', { method: version ? 'PATCH' : 'POST', signal,
              body: JSON.stringify({ payload: cleanTitles(payload), base_course_revision: version?.base_course_revision ?? data.confirmed_revision,
                ...(version ? { version_id: version.id, revision: version.revision } : {}) }) });
            if (!signal.aborted) { adopt(next); await load(signal); setNotice('草稿已保存，尚未应用到正式目录'); }
          })}>保存草稿</button> : null}
          {version?.status === 'DRAFT' ? <button className="button primary" disabled={Boolean(busy) || dirty || stale || Boolean(payload.uncertain_items?.length)} onClick={() => { setConfirming(true); setAcceptArchives(false); }}>核对并确认</button> : null}
          <button className="text-button" disabled={Boolean(busy)} onClick={() => { if (!canLeave()) return; setPayload(null); setVersion(null); setDirty(false); setConfirming(false); }}>关闭编辑</button>
        </div>
        {version && !dirty ? <div className="curriculum-diff">
          <p>新增 {version.change_summary.added.length} · 修改 {version.change_summary.modified.length} · 归档 {version.change_summary.archived.length}</p>
          {(['added', 'modified', 'archived'] as const).map(kind => version.change_summary[kind].length ? <details key={kind} open={kind === 'archived'}>
            <summary>{kind === 'added' ? '新增项' : kind === 'modified' ? '修改项' : '归档项'}</summary>
            <ul>{version.change_summary[kind].map(item => <li key={item.id}>{item.title}{pageLabel(item)}</li>)}</ul>
          </details> : null)}
        </div> : null}
        {confirming && version ? <div className="curriculum-confirm" role="region" aria-label="确认目录">
          <h3>应用这份目录？</h3><p>确认后成为正式目录。现有章节只通过明确 ID 匹配，移除项归档。</p>
          {version.change_summary.archived.length ? <label><input type="checkbox" checked={acceptArchives}
            onChange={event => setAcceptArchives(event.target.checked)} />我已核对上方全部归档项</label> : null}
          <div className="button-row"><button className="button primary" disabled={Boolean(busy) || (version.change_summary.archived.length > 0 && !acceptArchives)}
            onClick={() => void run('确认中…', async signal => {
              await api(path + '/confirm', { method: 'POST', signal, body: JSON.stringify({ version_id: version.id,
                revision: version.revision, base_course_revision: version.base_course_revision, accept_archives: acceptArchives }) });
              if (!signal.aborted) { setVersion(null); setPayload(null); setDirty(false); await load(signal); setNotice('目录已确认'); }
            })}>确认应用目录</button><button className="button" onClick={() => setConfirming(false)}>取消</button></div>
        </div> : null}
      </> : null}
      {busy ? <p role="status">{busy}</p> : null}
    </>}
  </section>;
}
