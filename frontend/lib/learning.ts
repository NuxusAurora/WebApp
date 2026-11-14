import { api } from './api';

export type LearningProject = {
  id: string;
  section_id: string;
  section_title: string;
  course_id: string;
  course_title: string;
};
export type LearningProjectPage = { items: LearningProject[]; next_cursor: string | null };
export type LearningProjectDetail = LearningProject & {
  knowledge_points: { id: string; title: string }[];
  conversation: { id: string; knowledge_point_id: string } | null;
};

const projectsPath = 'learning/projects';

export function openLearningProject(projectId: string, signal: AbortSignal, pointId?: string) {
  return api<LearningProjectDetail>(projectsPath + '/' + projectId + '/open', {
    method: 'POST', body: JSON.stringify({ knowledge_point_id: pointId }), signal,
  });
}

export function listLearningProjects(signal: AbortSignal, cursor: string | null = null) {
  return api<LearningProjectPage>(projectsPath + (cursor ? '?before=' + encodeURIComponent(cursor) : ''), { signal });
}
