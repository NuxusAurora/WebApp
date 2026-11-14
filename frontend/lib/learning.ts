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

const textbooksPath = projectsPath + '/textbooks';

export function listLearningTextbooks(signal: AbortSignal, cursor: string | null = null) {
  return api<{ items: LearningTextbook[]; next_cursor: string | null }>(
    textbooksPath + (cursor ? '?before=' + encodeURIComponent(cursor) : ''), { signal },
  );
}

export function getLearningOutline(courseId: string, signal: AbortSignal) {
  return api<LearningOutline>(textbooksPath + '/' + courseId, { signal });
}
