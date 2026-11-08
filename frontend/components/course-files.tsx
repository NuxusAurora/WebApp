'use client';

import { useState, type FormEvent } from 'react';
import type { CourseFile } from '../lib/course-types';
import { fileSize } from '../lib/course-types';
import { Icon } from './icon';

export function CourseFiles({ files, busy, loading, error, onUpload, onDownload, onDelete, onRetry }: {
  files: CourseFile[];
  busy: boolean;
  loading: boolean;
  error: string;
  onUpload: (file: File) => Promise<boolean>;
  onDownload: (file: CourseFile) => void;
  onDelete: (file: CourseFile) => void;
  onRetry: () => void;
}) {
  const [selectedName, setSelectedName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('file');
    if (file instanceof File && await onUpload(file)) { form.reset(); setSelectedName(''); }
  }

  return <section className="course-materials" aria-labelledby="materials-title">
    <div className="section-heading"><h3 id="materials-title">学习资料</h3>
      {!loading && !error ? <span className="count-label">{files.length} 个文件</span> : null}</div>
    {loading ? <div className="file-skeleton" role="status" aria-label="正在加载学习资料">
      <div className="skeleton" /><div className="skeleton" />
      <span className="visually-hidden">正在加载学习资料…</span>
    </div> : error ? <div className="inline-error" role="alert"><p>{error}</p>
      <button className="text-button" disabled={busy} onClick={onRetry}>重试加载资料</button></div> :
      files.length ? <ul className="file-list">{files.map(file => <li key={file.id}>
        <span className="file-symbol"><Icon name="file" size={22} /></span>
        <span className="file-description"><span className="file-name" title={file.filename}>{file.filename}</span>
          <small>{fileSize(file.size)}</small></span>
        <div className="file-actions"><button className="text-button" disabled={busy}
          onClick={() => onDownload(file)} aria-label={'下载 ' + file.filename}>
          <Icon name="download" size={16} /><span>下载</span></button>
          <button className="icon-button danger-quiet" disabled={busy} title="删除文件"
            aria-label={'删除 ' + file.filename} onClick={() => onDelete(file)}><Icon name="trash" size={17} /></button></div>
      </li>)}</ul> : <div className="files-empty"><Icon name="file" size={24} />
        <p>还没有学习资料</p><small>添加这门课程的笔记或其他文本资料。</small></div>}
    <form className="upload-form" onSubmit={submit}>
      <span className="upload-label">添加学习资料</span>
      <div className="file-picker-row"><label className={'button file-picker' + (busy || loading ? ' is-disabled' : '')}>
        <Icon name="plus" size={15} />选择文件
        <input id="course-file" className="file-input" type="file" name="file" accept=".txt,text/plain" required disabled={busy || loading}
          aria-label="选择学习资料文件" aria-describedby="upload-constraint" onChange={event => setSelectedName(event.target.files?.[0]?.name ?? '')} />
      </label><span className="selected-file-name" title={selectedName} aria-live="polite">{selectedName || '未选择文件'}</span></div>
      <div className="upload-bottom"><small id="upload-constraint">UTF-8 .txt · 最大 1 MiB</small>
        <button className="button button-small" disabled={busy || loading}><Icon name="upload" size={16} />
          {busy ? '处理中…' : '上传文件'}</button></div>
    </form>
  </section>;
}
