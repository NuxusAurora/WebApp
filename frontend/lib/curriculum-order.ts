import type { Payload } from './curriculum';

export type OutlineNode = { kind: 'chapter' | 'section'; id: string };
export type OutlineTarget = OutlineNode & { position: 'before' | 'after' | 'inside' };

// IDs, rather than display indices, stay stable while a draft is rearranged.
export function moveOutline(payload: Payload, source: OutlineNode, target: OutlineTarget): Payload {
  if (source.id === target.id) return payload;
  const next = structuredClone(payload);
  if (source.kind === 'chapter') {
    if (target.kind !== 'chapter' || target.position === 'inside') return payload;
    const from = next.chapters.findIndex(item => item.id === source.id);
    if (from < 0 || !next.chapters.some(item => item.id === target.id)) return payload;
    const [chapter] = next.chapters.splice(from, 1);
    const to = next.chapters.findIndex(item => item.id === target.id);
    next.chapters.splice(to + Number(target.position === 'after'), 0, chapter);
  } else {
    const from = next.chapters.find(item => item.sections.some(section => section.id === source.id));
    const to = next.chapters.find(item => target.kind === 'chapter' ? item.id === target.id :
      item.sections.some(section => section.id === target.id));
    if (!from || !to || (from !== to && to.sections.length >= 100)) return payload;
    const [section] = from.sections.splice(from.sections.findIndex(item => item.id === source.id), 1);
    const index = target.kind === 'chapter' ? to.sections.length :
      to.sections.findIndex(item => item.id === target.id) + Number(target.position === 'after');
    to.sections.splice(index, 0, section);
  }
  return next;
}
