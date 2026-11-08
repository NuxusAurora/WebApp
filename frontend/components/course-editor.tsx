'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Course } from '../lib/course-types';
import { defaultLearningGoal, learningGoalDescription, learningGoals } from '../lib/learning-goals';
import { Icon } from './icon';

export function CourseEditor({ course, busy, onSave, onCancel, onDirty }: {
  course: Course | null;
  busy: boolean;
  onSave: (data: Record<string, FormDataEntryValue>) => void;
  onCancel: () => void;
  onDirty: () => void;
}) {
  const title = useRef<HTMLInputElement>(null);
  const legacyGoal = Boolean(course?.learning_goal && !learningGoalDescription(course.learning_goal));
  const [goal, setGoal] = useState(legacyGoal ? '' : course?.learning_goal || defaultLearningGoal);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (legacyGoal && fields.learning_goal === '') delete fields.learning_goal;
    onSave(fields);
  }

  return <section className="detail-panel editor-panel" aria-labelledby="editor-title">
    <div className="panel-heading">
      <h2 id="editor-title">{course ? '编辑课程' : '新建课程'}</h2>
      <button className="icon-button" type="button" aria-label="关闭课程编辑" disabled={busy} onClick={onCancel}>
        <Icon name="close" />
      </button>
    </div>
    <p className="panel-description">{course ? '更新课程信息和学习目标。' : '填写课程信息，之后可以随时修改。'}</p>
    <form className="form-stack" onSubmit={submit} onChange={onDirty}>
      <div className="editor-fields">
      <label>课程名称 <span className="required">必填</span>
        <input ref={title} name="title" defaultValue={course?.title} required maxLength={200}
          placeholder="例如：高等数学" autoComplete="off" />
      </label>
      <div className="field-pair">
        <label>学科<input name="subject" defaultValue={course?.subject} maxLength={200}
          placeholder="例如：数学" autoComplete="off" /></label>
        <label>教材<input name="textbook" defaultValue={course?.textbook} maxLength={300}
          placeholder="教材名称" autoComplete="off" /></label>
      </div>
      <div className="field-group"><label htmlFor="learning-goal">学习目标</label>
        <select id="learning-goal" name="learning_goal" value={goal} onChange={event => setGoal(event.target.value)}
          aria-describedby="learning-goal-description">
          {legacyGoal ? <option value="">保留原有目标</option> : null}
          {learningGoals.map(option => <option key={option.id} value={option.label}>{option.label}</option>)}
        </select>
        <small id="learning-goal-description">{goal ? learningGoalDescription(goal) : '选择新目标后，才会替换原有自定义目标。'}</small>
        {legacyGoal ? <details className="legacy-goal"><summary>原有自定义目标</summary><p>{course!.learning_goal}</p></details> : null}
      </div>
      {course ? <label>课程状态<select name="status" defaultValue={course.status}>
        <option value="active">学习中</option><option value="archived">已归档</option>
      </select></label> : null}
      </div>
      <div className="editor-actions">
        <button className="button primary" disabled={busy}><Icon name="check" size={17} />{busy ? '保存中…' : '保存课程'}</button>
        <button className="button" type="button" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </form>
  </section>;
}
