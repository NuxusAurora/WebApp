'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

type Course = { id: string; title: string; subject: string; textbook: string; learning_goal: string; status: string };
type Upload = { id: string; filename: string; size: number };

function CourseEditor({ course, busy, onSave, onCancel }: { course: Course | null; busy: boolean;
  onSave: (data: Record<string, FormDataEntryValue>) => void; onCancel: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); onSave(Object.fromEntries(new FormData(event.currentTarget)));
  }
  return <section className="editor"><h2>{course ? '编辑课程' : '新建课程'}</h2>
    <form className="stack" onSubmit={submit}>
      <label>课程名称<input name="title" defaultValue={course?.title} required maxLength={200} /></label>
      <div className="field-row"><label>学科<input name="subject" defaultValue={course?.subject} maxLength={200} /></label>
        <label>教材<input name="textbook" defaultValue={course?.textbook} maxLength={300} /></label></div>
      <label>学习目标<textarea name="learning_goal" defaultValue={course?.learning_goal} rows={3} maxLength={10000} /></label>
      {course ? <label>状态<select name="status" defaultValue={course.status}><option value="active">学习中</option><option value="archived">已归档</option></select></label> : null}
      <div className="actions"><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存课程'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>取消</button></div>
    </form></section>;
}

export function CourseSpace() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Course | null>(null);
  const [editing, setEditing] = useState(false);
  const [files, setFiles] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  async function refresh(page = offset) { setCourses(await api<Course[]>(`courses?offset=${page}`)); }
  useEffect(() => { let active = true;
    api<Course[]>('courses').then(data => { if (active) setCourses(data); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { let active = true; setFiles([]);
    if (selected) api<Upload[]>(`courses/${selected.id}/uploads`)
      .then(data => { if (active) setFiles(data); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [selected]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function save(data: Record<string, FormDataEntryValue>) {
    await run(async () => {
      const course = await api<Course>(selected ? `courses/${selected.id}` : 'courses', {
        method: selected ? 'PATCH' : 'POST', body: JSON.stringify(data),
      });
      await refresh(); setSelected(course); setEditing(false); setMessage('课程已保存');
    });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    const file = new FormData(form).get('file') as File;
    if (!selected || !file?.size) return;
    if (file.size > 1024 * 1024) { setError('文件不能超过 1 MiB'); return; }
    await run(async () => {
      const result = await api<Upload>(`courses/${selected.id}/uploads`, { method: 'POST', body: file,
        headers: { 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent(file.name) } });
      setFiles(previous => [result, ...previous]); setMessage('文件已上传'); form.reset();
    });
  }
  return <>
    <div className="page-heading"><div><div className="section-label">学习空间</div><h1>我的课程</h1></div>
      <button className="primary" disabled={busy} onClick={() => { setSelected(null); setEditing(true); setDeleteTarget(null); }}>新建课程</button></div>
    {error ? <p role="alert" className="error">{error} <button onClick={() => void run(() => refresh())} disabled={busy}>重试</button></p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="workspace-grid"><section aria-label="课程列表" className="course-list" aria-busy={loading}>
      {loading ? <p role="status">正在加载课程…</p> : courses.length === 0 ? <p className="empty">还没有课程。新建课程，写下你的学习目标。</p> :
        courses.map(course => <button className="course-row" key={course.id} disabled={busy} aria-pressed={selected?.id === course.id}
          onClick={() => { setSelected(course); setEditing(false); setDeleteTarget(null); }}>
          <span><strong>{course.title}</strong><small>{course.subject || '未设置学科'}</small></span><span>{course.status === 'active' ? '学习中' : '已归档'}</span></button>)}
      {offset > 0 || courses.length === 100 ? <div className="actions"><button disabled={busy || offset === 0} onClick={() => void run(async () => { const page = offset - 100; await refresh(page); setOffset(page); })}>上一页</button>
        <button disabled={busy || courses.length < 100} onClick={() => void run(async () => { const page = offset + 100; await refresh(page); setOffset(page); })}>下一页</button></div> : null}
    </section><div>
      {editing ? <CourseEditor key={selected?.id ?? 'new'} course={selected} busy={busy} onSave={data => void save(data)} onCancel={() => setEditing(false)} /> : selected ?
        <section className="course-detail"><h2>{selected.title}</h2><dl className="course-meta"><dt>学科</dt><dd>{selected.subject || '未设置'}</dd><dt>教材</dt><dd>{selected.textbook || '未设置'}</dd><dt>学习目标</dt><dd>{selected.learning_goal || '未设置'}</dd></dl>
          <div className="actions"><button disabled={busy} onClick={() => setEditing(true)}>编辑课程</button><button className="danger" disabled={busy} onClick={() => setDeleteTarget(selected.id)}>删除课程</button></div>
          {deleteTarget === selected.id ? <div className="confirm" role="alert"><p>删除“{selected.title}”及其文件？此操作无法撤销。</p><div className="actions"><button className="danger" disabled={busy} onClick={() => void run(async () => {
            await api(`courses/${selected.id}`, { method: 'DELETE' }); setSelected(null); setDeleteTarget(null); await refresh(); setMessage('课程已删除');
          })}>确认删除</button><button disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button></div></div> : null}
          <div className="materials"><h3>学习资料</h3><p className="help">支持 UTF-8 .txt，最大 1 MiB。暂不支持图片和 PDF。</p>
            <form onSubmit={upload} className="upload-form"><label>选择文件<input type="file" name="file" accept=".txt,text/plain" required /></label><button disabled={busy}>{busy ? '处理中…' : '上传文件'}</button></form>
            {files.length ? <ul className="file-list">{files.map(file => <li key={file.id}><span>{file.filename}<small>{file.size.toLocaleString()} 字节</small></span><div className="actions"><button disabled={busy} onClick={() => void run(async () => {
              const result = await api<{ url: string }>(`courses/${selected.id}/uploads/${file.id}/download`);
              window.location.assign(result.url);
            })}>下载</button><button disabled={busy} onClick={() => void run(async () => {
              if (!window.confirm(`删除“${file.filename}”？此操作无法撤销。`)) return;
              await api(`courses/${selected.id}/uploads/${file.id}`, { method: 'DELETE' }); setFiles(previous => previous.filter(row => row.id !== file.id)); setMessage('文件已删除');
            })}>删除</button></div></li>)}</ul> : <p className="help">还没有学习资料。</p>}
          </div></section> : <div className="course-placeholder"><h2>为学习留一页空间</h2><p>选择课程，整理教材与学习目标。</p></div>}
    </div></div>
  </>;
}
