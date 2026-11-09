import type { Payload } from './curriculum';

// Imported numbering is presentation metadata, never part of an editable name.
export function titleText(title: string) {
  return title.trim().replace(/^(?:第\s*[\d一二三四五六七八九十百零〇两]+\s*[章节篇部]\s*[：:、.．]?\s*|§\s*\d+(?:[.．]\d+)*\s*|\d+(?:[.．]\d+)+(?:\s+|[、:：]\s*)|\d+[、.．]\s+|(?:chapter|section)\s+\d+\s*[:：.．-]?\s+)/i, '').trim();
}

export function cleanTitles(payload: Payload): Payload {
  return { ...payload, chapters: payload.chapters.map(chapter => ({ ...chapter, title: titleText(chapter.title),
    sections: chapter.sections.map(section => ({ ...section, title: titleText(section.title) })) })) };
}
