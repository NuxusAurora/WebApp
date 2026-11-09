'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Payload } from '../lib/curriculum';
import { moveOutline, type OutlineNode, type OutlineTarget } from '../lib/curriculum-order';

export function CurriculumOutline({ payload, disabled = false, selectedId, onSelect, onChange }: {
  payload: Payload; disabled?: boolean; selectedId?: string;
  onSelect?: (id: string) => void; onChange?: (payload: Payload) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<OutlineTarget | null>(null);
  const drag = useRef<OutlineNode | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drop = useRef<OutlineTarget | null>(null);
  const writable = Boolean(onChange) && !disabled;
  useEffect(() => {
    const parent = payload.chapters.find(chapter => chapter.sections.some(section => section.id === selectedId));
    if (parent) setExpanded(previous => new Set(previous).add(parent.id));
  }, [selectedId, payload]);
  function clearDrag() { drag.current = null; pointer.current = null; drop.current = null; setOver(null); }
  useEffect(() => { if (!writable) clearDrag(); }, [writable]);
  function applyDrop(target: OutlineTarget | null) {
    const source = drag.current;
    clearDrag();
    if (!writable || !source || !target) return;
    const next = moveOutline(payload, source, target);
    if (next !== payload) { onChange?.(next); onSelect?.(source.id); }
  }

  function targetFor(event: DragEvent, node: OutlineNode): OutlineTarget {
    const rect = event.currentTarget.getBoundingClientRect();
    return { ...node, position: drag.current?.kind === 'section' && node.kind === 'chapter' ? 'inside' :
      event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' };
  }
  function row(node: OutlineNode, number: string, title: string, hasChildren = false) {
    const open = expanded.has(node.id);
    const label = (node.kind === 'chapter' ? '章节 ' : '小节 ') + number;
    return <div className={'curriculum-outline-row ' + (node.kind === 'chapter' ? 'outline-parent' : 'outline-child') +
      (selectedId === node.id ? ' is-selected' : '')}
      data-outline-kind={node.kind} data-outline-id={node.id}
      data-drop={over?.id === node.id ? over.position : undefined}
      onDragOver={event => {
        if (!writable || !drag.current || drag.current.kind === 'chapter' && node.kind !== 'chapter') return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setOver(targetFor(event, node));
      }} onDrop={event => {
        if (!writable || !drag.current || drag.current.kind === 'chapter' && node.kind !== 'chapter') return;
        event.preventDefault(); event.stopPropagation();
        applyDrop(targetFor(event, node));
      }}>
      {onChange ? <button type="button" className="outline-drag text-button" draggable={writable} disabled={!writable}
        aria-label={'拖动' + label} title="拖动排序" onPointerDown={event => {
          if (!writable || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = node; pointer.current = { x: event.clientX, y: event.clientY };
        }} onPointerMove={event => {
          if (!writable || !pointer.current || !drag.current) return;
          if (Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) < 5) return;
          const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-outline-id]');
          let target: OutlineTarget | null = null;
          if (element && element.closest('.curriculum-outline') === event.currentTarget.closest('.curriculum-outline')) {
            const kind = element.dataset.outlineKind as OutlineNode['kind'];
            const id = element.dataset.outlineId!; const rect = element.getBoundingClientRect();
            if (drag.current.kind !== 'chapter' || kind === 'chapter') target = { kind, id,
              position: drag.current.kind === 'section' && kind === 'chapter' ? 'inside' :
                event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' };
          }
          drop.current = target; setOver(target);
        }} onPointerUp={event => {
          const target = drop.current; applyDrop(target);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag} onKeyDown={event => { if (event.key === 'Escape') clearDrag(); }} onDragStart={event => {
          if (pointer.current) { event.preventDefault(); return; }
          if (!writable) { event.preventDefault(); return; }
          drag.current = node; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', node.id);
        }} onDragEnd={clearDrag}>⠿</button> : null}
      <button type="button" className="outline-title" title={title || '未命名'}
        aria-label={label + ' ' + (title || '未命名')}
        aria-expanded={node.kind === 'chapter' ? open : undefined}
        onClick={() => {
          if (node.kind === 'chapter') setExpanded(previous => {
            const next = new Set(previous); if (open) next.delete(node.id); else next.add(node.id); return next;
          });
          onSelect?.(node.id);
        }}>
        <span className="outline-number">{number}</span><span className="outline-name">{title || '未命名'}</span>
        {node.kind === 'chapter' ? <span className="outline-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span> : null}
      </button>
      {node.kind === 'chapter' && !hasChildren ? <span className="visually-hidden">暂无小节</span> : null}
    </div>;
  }
  return <ol className="curriculum-outline" aria-label="目录标题">{payload.chapters.map((chapter, ci) =>
    <li key={chapter.id}>{row({ kind: 'chapter', id: chapter.id }, String(ci + 1), chapter.title, chapter.sections.length > 0)}
      {expanded.has(chapter.id) ? <ol>{chapter.sections.map((section, si) =>
        <li key={section.id}>{row({ kind: 'section', id: section.id }, `${ci + 1}.${si + 1}`, section.title)}</li>)}</ol> : null}
    </li>)}</ol>;
}
