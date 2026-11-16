// Same batch limit as the curriculum parse endpoint.
export const MAX_CURRICULUM_IMAGES = 5;

export type Section = { id: string; title: string; page_start?: number | null; page_end?: number | null };
export type Chapter = Section & { sections: Section[] };
export type CurriculumGap = { id: string; chapter_id: string | null; after_id: string | null; reason: string };
export type Payload = { chapters: Chapter[]; uncertain_items?: string[]; gaps?: CurriculumGap[] };
export type Changes = { added: Section[]; modified: Section[]; archived: Section[]; knowledge_archived?: Section[] };
export type Version = {
  id: string; status: 'DRAFT' | 'CONFIRMED' | 'SUPERSEDED'; revision: number;
  base_course_revision: number; applied_course_revision: number | null;
  payload: Payload; change_summary: Changes; source: { kind: string; model_name?: string };
  created_at: string;
};
export type Curriculum = { confirmed_revision: number; curriculum: Payload; versions: Version[] };
export type Photo = { id: string; filename: string; size: number };
export type Provider = { id: string; provider_name: string; enabled: boolean;
  models: { id: string; model_name: string; enabled: boolean; capabilities?: { vision?: boolean } }[] };
export function temporaryId() { return 'tmp-' + crypto.randomUUID(); }

// Keep an orphaned anchor at its former boundary after a move or removal.
export function reanchorGaps(previous: Payload | null, next: Payload): Payload {
  if (!previous || !next.gaps?.length) return next;
  const gaps = next.gaps.flatMap(gap => {
    const before = gap.chapter_id === null ? previous.chapters :
      previous.chapters.find(chapter => chapter.id === gap.chapter_id)?.sections;
    const after = gap.chapter_id === null ? next.chapters :
      next.chapters.find(chapter => chapter.id === gap.chapter_id)?.sections;
    if (!after) return [];
    if (gap.after_id === null || after.some(node => node.id === gap.after_id)) return [gap];
    const index = before?.findIndex(node => node.id === gap.after_id) ?? -1;
    const anchor = index > 0 ? before?.slice(0, index).findLast(node => after.some(item => item.id === node.id)) : undefined;
    return [{ ...gap, after_id: anchor?.id ?? null }];
  });
  return { ...next, gaps };
}

export function validPayload(payload: Payload) {
  const nodes = payload.chapters.flatMap(chapter => [chapter, ...chapter.sections]);
  return payload.chapters.length > 0 && payload.chapters.length <= 50 && nodes.length <= 500 &&
    nodes.every(node => node.title.trim().length > 0 && node.title.length <= 200 &&
      [node.page_start, node.page_end].every(page => page == null || (Number.isInteger(page) && page >= 1 && page <= 100000)) &&
      (node.page_start == null || node.page_end == null || node.page_end >= node.page_start)) &&
    payload.chapters.every(chapter => chapter.sections.length <= 100);
}
