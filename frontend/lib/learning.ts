import { api } from './api';

export type LearningProject = {
  id: string;
  section_id: string;
  section_title: string;
  chapter_id: string;
  course_id: string;
  course_title: string;
  textbook_title: string;
};
type LearningPoint = { id: string; title: string };
export type TeachingTurn = { id: string; position: number; question: string; answer: string };
export type TeachingHistory = { turns: TeachingTurn[]; before: number | null };
export type TeachingQuestion = { request_id: string; after: number; question: string };
export type LearningTextbook = { id: string; title: string };
export type LearningSelection = { courseId: string; chapterId: string; sectionId: string; pointId?: string };
export type LearningOutline = { chapters: {
  id: string;
  title: string;
  sections: { id: string; title: string; knowledge_points: (LearningPoint & { studied: boolean })[] }[];
}[] };
export type LearningProjectDetail = LearningProject & {
  knowledge_points: LearningPoint[];
  conversation: { id: string; knowledge_point_id: string } | null;
};

const projectsPath = 'learning/projects';
const textbooksPath = projectsPath + '/textbooks';
const turnsPath = (id: string) => `learning/conversations/${id}/turns`;

export function getTeachingHistory(id: string, signal: AbortSignal, before?: number) {
  return api<TeachingHistory>(turnsPath(id) + (before ? '?before=' + before : ''), { signal });
}

export function askTeachingQuestion(id: string, body: TeachingQuestion, signal: AbortSignal) {
  return api<TeachingTurn>(turnsPath(id), { method: 'POST', body: JSON.stringify(body), signal });
}

export function showLearningTextbook(courseId: string, signal: AbortSignal) {
  return api<null>(textbooksPath + '/' + courseId, { method: 'PUT', signal });
}

export function hideLearningTextbook(courseId: string, signal: AbortSignal) {
  return api<null>(textbooksPath + '/' + courseId, { method: 'DELETE', signal });
}

export function openSectionConversation(sectionId: string, signal: AbortSignal, pointId?: string) {
  return api<LearningProjectDetail>(projectsPath, {
    method: 'POST', body: JSON.stringify({ section_id: sectionId, knowledge_point_id: pointId }), signal,
  });
}

export function openLearningProject(projectId: string, signal: AbortSignal) {
  return api<LearningProjectDetail>(projectsPath + '/' + projectId + '/open', {
    method: 'POST', body: '{}', signal,
  });
}

export function listLearningTextbooks(signal: AbortSignal, cursor: string | null = null) {
  return api<{ items: LearningTextbook[]; next_cursor: string | null }>(
    textbooksPath + (cursor ? '?before=' + encodeURIComponent(cursor) : ''), { signal },
  );
}

export function getLearningOutline(courseId: string, signal: AbortSignal) {
  return api<LearningOutline>(textbooksPath + '/' + courseId, { signal });
}
