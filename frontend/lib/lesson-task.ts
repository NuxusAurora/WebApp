import { api } from './api';
import type { LessonProgress } from './learning';

export type ContentFormat = 'markdown' | 'text';
export type LessonProblemParts = { statement: string; parts: { number: number; text: string }[] };
export type SubquestionExplanation = { number: number; title: string; content: string };
export type PublishedStep = {
  step_id?: string; index: number; title: string; content: string; objective?: string;
  takeaway?: string; is_final_step?: boolean; format?: ContentFormat;
};

export type LessonCommand = 'start' | 'next' | 'complete' | 'similar-question' | 'next-type'
  | 'master-type' | 'finish' | 'hint' | 'rephrase'
  | 'check-question' | 'check-answer' | 'evaluate-check';

export type LessonCheck = {
  check_id: string;
  status: 'awaiting_answer' | 'awaiting_evaluation' | 'feedback_ready';
  question: string;
  answer?: string;
  feedback?: string;
};

export type LessonTask = {
  revision: number;
  status: 'not_started' | 'legacy' | 'teaching' | 'final_step' | 'completed';
  actions: LessonCommand[];
  legacy?: LessonProgress | null;
  task_id?: string;
  question?: { question_id: string; problem: string; format?: ContentFormat; type_title?: string | null };
  problem_parts?: LessonProblemParts;
  plan?: { plan_id: string; plan_version: number; learning_objective: string; total_steps: number };
  current_step?: PublishedStep;
  completed_steps?: PublishedStep[];
  support?: { hints?: { level: number; text: string }[]; rephrase?: string } | null;
  check?: LessonCheck | null;
  completion?: { completed_at: string } | null;
  practice?: { types: { title: string; objective: string }[]; current: number; mastered: number[]; finished: boolean } | null;
  previous_questions?: LessonTask[];
};

const path = (id: string) => `learning/conversations/${id}/lesson/task`;
export const readLessonTask = (id: string, signal: AbortSignal) => api<LessonTask>(path(id), { signal });

export function requestSubquestionExplanation(id: string, revision: number, number: number, signal: AbortSignal,
  questionRevision?: number) {
  return api<SubquestionExplanation>(path(id) + '/subquestion', { method: 'POST', signal,
    body: JSON.stringify({ expected_revision: revision, subquestion: number, question_revision: questionRevision }),
  });
}

export function runLessonCommand(id: string, lesson: LessonTask, action: LessonCommand,
  signal: AbortSignal, fields?: { check_id?: string; answer?: string; subquestion?: number }) {
  return api<LessonTask>(path(id), { method: 'POST', signal, body: JSON.stringify({
    action,
    request_id: crypto.randomUUID(),
    expected_revision: lesson.revision,
    expected_task_id: lesson.task_id,
    expected_plan_id: lesson.plan?.plan_id,
    expected_step_index: lesson.current_step?.index,
    ...fields,
  }) });
}
