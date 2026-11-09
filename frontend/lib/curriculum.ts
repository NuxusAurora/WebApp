export type Section = { id: string; title: string; page_start?: number | null; page_end?: number | null };
export type Chapter = Section & { sections: Section[] };
export type Payload = { chapters: Chapter[]; uncertain_items?: string[] };
export type Changes = { added: Section[]; modified: Section[]; archived: Section[] };
export type Version = {
  id: string; status: 'DRAFT' | 'CONFIRMED' | 'SUPERSEDED'; revision: number;
  base_course_revision: number; applied_course_revision: number | null;
  payload: Payload; change_summary: Changes; source: { kind: string; model_name?: string };
  created_at: string;
};
export type Curriculum = { confirmed_revision: number; curriculum: Payload; versions: Version[] };
export type Photo = { id: string; filename: string; size: number };
export type Provider = { id: string; provider_name: string; enabled: boolean;
  models: { id: string; model_name: string; enabled: boolean }[] };
export function temporaryId() { return 'tmp-' + crypto.randomUUID(); }
export function validPayload(payload: Payload) {
  const nodes = payload.chapters.flatMap(chapter => [chapter, ...chapter.sections]);
  return payload.chapters.length > 0 && payload.chapters.length <= 50 && nodes.length <= 500 &&
    nodes.every(node => node.title.trim().length > 0 && node.title.length <= 200 &&
      [node.page_start, node.page_end].every(page => page == null || (Number.isInteger(page) && page >= 1 && page <= 100000)) &&
      (node.page_start == null || node.page_end == null || node.page_end >= node.page_start)) &&
    payload.chapters.every(chapter => chapter.sections.length <= 100);
}
