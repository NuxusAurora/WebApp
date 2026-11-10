'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Course } from '../lib/course-types';
import { defaultLearningGoal, learningGoalDescription, learningGoals } from '../lib/learning-goals';
import { Icon } from './icon';
import { Button, Card, FormField, Input, PageHeader, Select } from './ui';

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
  const [titleError, setTitleError] = useState('');
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (!course) fields.textbook = '';
    if (legacyGoal && fields.learning_goal === '') delete fields.learning_goal;
    onSave(fields);
  }

  return <section className="course-editor" aria-labelledby="editor-title">
    <PageHeader id="editor-title" title={course ? '编辑课程' : '新建课程'}
      description={course ? '更新课程信息和学习目标。' : '创建专属学习空间，配置你的学习目标。'} />
    <Card>
    <form className="form-stack" onSubmit={submit} onChange={onDirty} aria-busy={busy}>
      <fieldset disabled={busy} className="course-form-fields">
      <div className="editor-fields">
      <FormField id="course-title" label="课程名称" required error={titleError}>
        <Input ref={title} id="course-title" name="title" defaultValue={course?.title} required maxLength={200}
          aria-invalid={Boolean(titleError)} aria-describedby={titleError ? 'course-title-error' : undefined}
          onInvalid={() => setTitleError('请输入课程名称。')}
          onChange={() => setTitleError('')}
          placeholder="例如：高等数学" autoComplete="off" />
      </FormField>
      <div className="field-pair">
        <FormField id="course-subject" label="学科"><Input id="course-subject" name="subject" defaultValue={course?.subject} maxLength={200}
          placeholder="例如：数学" autoComplete="off" /></FormField>
        <FormField id="learning-goal" label="学习目标"
          description={goal ? learningGoalDescription(goal) : '选择新目标后，才会替换原有自定义目标。'}>
          <Select id="learning-goal" name="learning_goal" value={goal} onChange={event => setGoal(event.target.value)}
            aria-describedby="learning-goal-description">
            {legacyGoal ? <option value="">保留原有目标</option> : null}
            {learningGoals.map(option => <option key={option.id} value={option.label}>{option.label}</option>)}
          </Select>
        </FormField>
      </div>
        {legacyGoal ? <details className="legacy-goal"><summary>原有自定义目标</summary><p>{course!.learning_goal}</p></details> : null}
      {course ? <FormField id="course-status" label="课程状态"><Select id="course-status" name="status" defaultValue={course.status}>
        <option value="active">学习中</option><option value="archived">已归档</option>
      </Select></FormField> : null}
      </div>
      </fieldset>
      <div className="editor-actions">
        <Button disabled={busy} onClick={onCancel}>取消</Button>
        <Button variant="primary" type="submit" loading={busy}><Icon name="check" size={17} />{busy ? '保存中…' : '保存课程'}</Button>
      </div>
    </form>
    </Card>
  </section>;
}
