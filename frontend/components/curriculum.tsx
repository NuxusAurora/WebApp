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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelId, setModelId] = useState('');
  const [text, setText] = useState('');
  const [textDirty, setTextDirty] = useState(false);
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
  const callbacks = useRef({ onDirtyChange, onSessionExpired });
  callbacks.current = { onDirtyChange, onSessionExpired };
  const path = 'courses/' + courseId + '/curriculum';

  useEffect(() => {
    callbacks.current.onDirtyChange(dirty || textDirty || Boolean(busy));
  }, [dirty, textDirty, busy]);
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
  async function load(signal: AbortSignal) {
    const [current, images, connections] = await Promise.all([
      api<Curriculum>(path, { signal }), api<Photo[]>(path + '/images', { signal }),
      api<Provider[]>('ai/providers', { signal }),
    ]);
    if (!alive.current || signal.aborted) return;
    setData(current); setPhotos(images); setProviders(connections);
    setModelId(value => value || connections.filter(p => p.enabled).flatMap(p => p.models).find(m => m.enabled)?.id || '');
  }
  async function refresh() {
    const task = new AbortController(); controller.current = task;
    setLoading(true); setError('');
    try { await load(task.signal); } catch (reason) { if (!task.signal.aborted) failure(reason); }
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
  function canLeave() { return !(dirty || textDirty) || window.confirm('目录修改尚未保存。放弃修改？'); }
  function change(next: Payload) { setPayload(next); setDirty(true); setConfirming(false); }
  const models = providers.filter(p => p.enabled).flatMap(p => p.models.filter(m => m.enabled).map(m => ({ ...m, provider: p })));
  const selectedModel = models.find(model => model.id === modelId);
  async function generate(inputMode: 'images' | 'text') {
    if (busy || !selectedModel) return;
    if ((dirty || inputMode === 'images' && textDirty) && !window.confirm('生成新草稿将替换未保存的目录修改，继续？')) return;
    await run(inputMode === 'images' ? '模型识别中…' : '解析中…', async signal => {
      const next = await api<Version>(path + '/parse', { method: 'POST', signal,
        body: JSON.stringify({ input_mode: inputMode, ocr_text: inputMode === 'text' ? text : '',
          image_ids: photoIds, provider_id: selectedModel.provider.id, model_id: modelId }) });
      if (!signal.aborted) {
        adopt(next); setTextDirty(false); if (inputMode === 'images') setText('');
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
      {!payload ? <div className="section-heading"><h3>已确认目录</h3><span className="count-label">修订 {data.confirmed_revision}</span></div> : null}
      {payload || data.curriculum.chapters.length ? <CurriculumOutline payload={payload ?? data.curriculum}
        disabled={Boolean(busy) || Boolean(payload && (!editable || stale))} selectedId={selectedId} onSelect={setSelectedId}
        onChange={next => { if (!payload) setVersion(null); change(next); }} /> :
        <p className="muted">尚未确认目录。可从图片识别或手动录入。</p>}
      <details className="curriculum-import" open={!data.curriculum.chapters.length}>
        <summary>导入目录</summary>
        <p className="muted">所选图片将发送给模型，生成待核对的目录草稿。</p>
        <label className="curriculum-label">目录图片<input type="file" accept="image/png,image/jpeg" disabled={Boolean(busy)}
          onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (!file) return;
            if (!file.size || file.size > 5 * 1024 * 1024) { setError('请选择 5 MiB 内的 PNG 或 JPEG 图片'); return; }
            void run('上传中…', async signal => {
              const photo = await api<Photo>(path + '/images', { method: 'POST', body: file, signal,
                headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) } });
              if (signal.aborted) return;
              setPhotos(previous => [photo, ...previous]); setPhotoIds(previous => previous.length < 5 ? [...previous, photo.id] : previous);
              setNotice('图片已上传');
            });
          }} /></label>
        <small>PNG / JPEG · 每张最大 5 MiB · 一次最多识别 5 张，按勾选顺序</small>
        {photos.length ? <ul className="curriculum-photos">{photos.map(photo => <li key={photo.id}>
          <label><input type="checkbox" checked={photoIds.includes(photo.id)} disabled={Boolean(busy) || (!photoIds.includes(photo.id) && photoIds.length >= 5)}
            onChange={event => setPhotoIds(previous => event.target.checked ? [...previous, photo.id] : previous.filter(id => id !== photo.id))} />{photo.filename}
            {photoIds.includes(photo.id) ? <small>第 {photoIds.indexOf(photo.id) + 1} 张</small> : null}</label>
          <button className="text-button danger-quiet" disabled={Boolean(busy)} aria-label={'删除目录图片 ' + photo.filename}
            onClick={() => { if (!window.confirm('删除目录图片“' + photo.filename + '”？此操作无法撤销。')) return;
              void run('删除中…', async signal => {
                await api('courses/' + courseId + '/uploads/' + photo.id, { method: 'DELETE', signal });
                if (signal.aborted) return;
                setPhotos(previous => previous.filter(p => p.id !== photo.id)); setPhotoIds(previous => previous.filter(id => id !== photo.id));
              }); }}>删除</button>
        </li>)}</ul> : null}
        <label className="curriculum-label">解析模型<select value={modelId} disabled={Boolean(busy)} onChange={event => setModelId(event.target.value)}>
          <option value="">选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.provider.provider_name} · {model.model_name}{model.capabilities?.vision ? ' · 支持图片' : ''}</option>)}
        </select></label>
        {!models.length ? <p className="muted">请先在模型设置中添加并启用模型，也可手动录入目录。</p> :
          selectedModel && !selectedModel.capabilities?.vision ? <p className="muted">请在模型设置中确认该模型支持图片识别，或使用文字整理。</p> : null}
        <button className="button primary" disabled={Boolean(busy) || !photoIds.length || !selectedModel?.capabilities?.vision}
          onClick={() => void generate('images')}>模型识别目录</button>
        <details className="curriculum-import"><summary>从文字整理（备用）</summary>
        <button className="button" disabled={Boolean(busy) || !photoIds.length} onClick={() => {
          if (textDirty && !window.confirm('识别结果将替换尚未保存的文字，继续？')) return;
          void run('识别中…', async signal => {
            const result = await api<{ ocr_text: string }>(path + '/ocr', { method: 'POST', signal, body: JSON.stringify({ image_ids: photoIds }) });
            if (!signal.aborted) { setText(result.ocr_text); setTextDirty(true); setNotice('请核对识别文字，再生成草稿'); }
          });
        }}>本地 OCR 识别文字</button>
        <label className="curriculum-label">目录文字<textarea rows={7} maxLength={20000} value={text} disabled={Boolean(busy)}
          placeholder="识别图片，或粘贴目录文字" onChange={event => { setText(event.target.value); setTextDirty(true); }} /></label>
        <button className="button" disabled={Boolean(busy) || !modelId || !text.trim()}
          onClick={() => void generate('text')}>从文字生成草稿</button>
        </details>
      </details>
      <div className="curriculum-toolbar"><h3>目录草稿</h3><button className="text-button" disabled={Boolean(busy)} onClick={() => {
        if (!canLeave()) return; setVersion(null); setPayload(null); setDirty(false); setTextDirty(false); void refresh();
      }}>重新加载目录</button><button className="button button-small" disabled={Boolean(busy)} onClick={() => {
        if (!canLeave()) return;
        setVersion(null); setPayload(cleanTitles(structuredClone(data.curriculum.chapters.length ? data.curriculum :
          { chapters: [{ id: temporaryId(), title: '', sections: [] }] }))); setDirty(true); setConfirming(false);
      }}>手动编辑目录</button></div>
      {data.versions.length ? <label className="curriculum-label">历史与草稿<select value={version?.id ?? ''} disabled={Boolean(busy)}
        onChange={event => { if (!canLeave()) return; const next = data.versions.find(v => v.id === event.target.value); if (next) adopt(next); }}>
        <option value="">选择版本</option>{data.versions.map((v, i) => <option key={v.id} value={v.id}>
          {v.status === 'DRAFT' ? '待确认' : v.status === 'CONFIRMED' ? '已确认' : '历史'} · {new Date(v.created_at).toLocaleString()} · {i + 1}
        </option>)}
      </select></label> : null}
      {stale ? <p role="alert" className="notice error">此草稿基线已过期，请从当前正式目录重新编辑。</p> : null}
      {version ? <p className="muted">{version.source.kind === 'ai' ? '模型：' + version.source.model_name : '人工编辑'} · 草稿修订 {version.revision}</p> : null}
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
          <button className="text-button" disabled={Boolean(busy)} onClick={() => { if (!canLeave()) return; setPayload(null); setVersion(null); setDirty(false); setTextDirty(false); setConfirming(false); }}>关闭编辑</button>
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
