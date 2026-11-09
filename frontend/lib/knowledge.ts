export type PointInput = {
  temp_id: string; existing_knowledge_point_id: string | null; title: string; description: string;
  learning_objectives: string[]; importance: 'HIGH' | 'MEDIUM' | 'LOW'; mastery_criteria: string[];
};
export type KnowledgePayload = { knowledge_points: PointInput[]; uncertain_items: string[] };
export type Point = Omit<PointInput, 'temp_id' | 'existing_knowledge_point_id'> & {
  id: string; section_id: string; status: 'NOT_STARTED' | 'LEARNING' | 'PRACTICING' | 'NEEDS_REVIEW' | 'MASTERED';
};
type Change = { id: string; title: string; review_mastery?: boolean };
export type KnowledgeVersion = {
  id: string; revision: number; base_course_revision: number; status: 'DRAFT' | 'CONFIRMED' | 'SUPERSEDED';
  payload: KnowledgePayload; change_summary: { added: Change[]; modified: Change[]; archived: Change[] };
  source: { kind: string; model_name?: string };
};
export type KnowledgeData = { confirmed_revision: number; knowledge_points: Point[]; draft: KnowledgeVersion | null };
export function pointPayload(points: Point[]): KnowledgePayload {
  return { knowledge_points: points.map(({ id, title, description, learning_objectives, importance, mastery_criteria }) => ({
    temp_id: 'kp_' + id, existing_knowledge_point_id: id, title, description,
    learning_objectives: [...learning_objectives], importance, mastery_criteria: [...mastery_criteria],
  })), uncertain_items: [] };
}
export function validKnowledge(payload: KnowledgePayload) {
  const strings = (values: string[]) => values.length > 0 && values.length <= 20 && values.every(value => value.trim() && value.length <= 500);
  return payload.knowledge_points.length <= 50 && payload.knowledge_points.every(point =>
    point.title.trim() && point.title.length <= 200 && point.description.trim() && point.description.length <= 4000 &&
    strings(point.learning_objectives) && strings(point.mastery_criteria));
}
