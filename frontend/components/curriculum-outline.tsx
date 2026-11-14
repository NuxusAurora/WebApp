'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';
import type { Payload } from '../lib/curriculum';
import { temporaryId } from '../lib/curriculum';
import { titleText } from '../lib/curriculum-title';
import { moveOutline, type OutlineNode, type OutlineTarget } from '../lib/curriculum-order';

type MenuAction = { label: string; disabled?: boolean; onSelect: () => void };

export function CurriculumOutline({ payload, disabled = false, selectedId, onSelect, onChange, sectionDisclosure, sectionAction, sectionMenu }: {
  payload: Payload; disabled?: boolean; selectedId?: string;
  onSelect?: (id: string) => void; onChange?: (payload: Payload) => void;
  sectionDisclosure?: { openId: string | null; onOpen: (id: string | null) => boolean; content: ReactNode };
  sectionAction?: { pendingId: string | null; onAdd: (id: string) => Promise<void> };
  sectionMenu?: (id: string) => MenuAction[];
}) {
  const outlineId = useId();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<OutlineTarget | null>(null);
  const drag = useRef<OutlineNode | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const drop = useRef<OutlineTarget | null>(null);
  const writable = Boolean(onChange) && !disabled;
  const [menu, setMenu] = useState<{ node: OutlineNode; x: number; y: number; alignRight: boolean } | null>(null);
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLOListElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function focusRow(id: string) {
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-outline-id]') ?? [])
      .find(row => row.dataset.outlineId === id)?.querySelector<HTMLElement>('.outline-title')?.focus({ preventScroll: true });
  }
  function closeMenu(restore = false) { setMenu(null); if (restore) trigger.current?.focus({ preventScroll: true }); }
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const rect = element.getBoundingClientRect();
    const left = menu.alignRight ? menu.x - rect.width : menu.x;
    element.style.left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)) + 'px';
    element.style.top = Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)) + 'px';
    (element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? element).focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) closeMenu(); };
    const dismiss = () => closeMenu();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [menu]);
  useEffect(() => { if (!writable) setEditing(null); }, [writable]);
  useEffect(() => {
    if (menu && !writable && (menu.node.kind !== 'section' || !sectionMenu)) setMenu(null);
  }, [menu, writable, sectionMenu]);
  useEffect(() => {
    if (!writable || !selectedId) return;
    const item = payload.chapters.flatMap(chapter => [chapter, ...chapter.sections]).find(item => item.id === selectedId);
    if (item && !item.title) setEditing(previous => previous?.id === item.id ? previous : { id: item.id, original: '' });
  }, [selectedId, payload, writable]);
  function updateNode(id: string, update: (node: Payload['chapters'][number] | Payload['chapters'][number]['sections'][number]) => void) {
    if (!writable) return;
    const next = structuredClone(payload);
    const item = next.chapters.flatMap(chapter => [chapter, ...chapter.sections]).find(node => node.id === id);
    if (item) { update(item); onChange?.(next); }
  }
  function openMenu(node: OutlineNode, target: HTMLElement, x: number, y: number, alignRight = false) {
    trigger.current = target;
    setMenu({ node, x, y, alignRight });
  }
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
    title = titleText(title);
    const chapter = node.kind === 'chapter';
    const hasMenu = writable || (!chapter && Boolean(sectionMenu));
    const open = chapter ? expanded.has(node.id) : sectionDisclosure?.openId === node.id;
    const disclosure = chapter || Boolean(sectionDisclosure);
    const label = (node.kind === 'chapter' ? '章节 ' : '小节 ') + number;
    const item = payload.chapters.flatMap(chapter => [chapter, ...chapter.sections]).find(item => item.id === node.id)!;
    return <div className={'curriculum-outline-row ' + (node.kind === 'chapter' ? 'outline-parent' : 'outline-child') +
      (selectedId === node.id ? ' is-selected' : '')}
      data-outline-kind={node.kind} data-outline-id={node.id}
      data-drop={over?.id === node.id ? over.position : undefined}
      onContextMenu={event => { if (!hasMenu) return; event.preventDefault(); event.stopPropagation();
        const origin = event.currentTarget.querySelector<HTMLElement>('.outline-title') ?? event.currentTarget;
        openMenu(node, origin, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
          if (!hasMenu) return; event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(node, event.target as HTMLElement, rect.left + 32, rect.bottom);
        }
      }}
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
      {editing?.id === node.id && writable ? <div className="outline-title outline-rename">
        <span className="outline-number">{number}</span>
        <input autoFocus aria-label={label + '标题'} value={item.title} maxLength={200} required
          onFocus={event => event.currentTarget.select()}
          onChange={event => updateNode(node.id, item => { item.title = event.target.value; })}
          onBlur={() => { updateNode(node.id, item => { item.title = titleText(item.title); }); setEditing(null); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); requestAnimationFrame(() => focusRow(node.id)); }
            if (event.key === 'Escape') { event.preventDefault(); updateNode(node.id, item => { item.title = editing.original; }); setEditing(null); requestAnimationFrame(() => focusRow(node.id)); }
          }} />
      </div> : <button type="button" className="outline-title" title={title || '未命名'}
        aria-label={label + ' ' + (title || '未命名')}
        aria-expanded={disclosure ? open : undefined}
        aria-controls={disclosure ? outlineId + '-' + node.kind + '-' + node.id : undefined}
        onClick={() => {
          if (chapter) {
            if (open && sectionDisclosure && payload.chapters.find(item => item.id === node.id)?.sections
              .some(section => section.id === sectionDisclosure.openId) && !sectionDisclosure.onOpen(null)) return;
            setExpanded(previous => {
              const next = new Set(previous); if (open) next.delete(node.id); else next.add(node.id); return next;
            });
          } else if (sectionDisclosure && !sectionDisclosure.onOpen(open ? null : node.id)) return;
          onSelect?.(node.id);
        }}>
        <span className="outline-number">{number}</span><span className="outline-name">{title || '未命名'}</span>
        {disclosure ? <span className="outline-chevron" aria-hidden="true"><Icon name="chevron" size={14} /></span> : null}
      </button>}
      {!chapter && sectionAction ? <button type="button" className="text-button outline-add-learning"
        disabled={disabled || Boolean(sectionAction.pendingId)}
        aria-label={'添加到对话栏：' + title} title="添加到对话栏" onClick={() => void sectionAction.onAdd(node.id)}>
        <Icon name="plus" size={15} /><span>{sectionAction.pendingId === node.id ? '正在添加…' : '添加到对话栏'}</span>
      </button> : null}
      {hasMenu ? <button className="text-button outline-more" type="button" aria-label={label + '操作'} aria-haspopup="menu"
        aria-expanded={menu?.node.id === node.id}
        onClick={event => { const rect = event.currentTarget.getBoundingClientRect();
          openMenu(node, event.currentTarget, rect.right, rect.bottom, true); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button> : null}
      {node.kind === 'chapter' && !hasChildren ? <span className="visually-hidden">暂无小节</span> : null}
    </div>;
  }
  const menuChapter = menu && payload.chapters.find(chapter => chapter.id === menu.node.id || chapter.sections.some(section => section.id === menu.node.id));
  const menuItem = menu && (menu.node.kind === 'chapter' ? menuChapter : menuChapter?.sections.find(section => section.id === menu.node.id));
  const extraActions = menu?.node.kind === 'section' ? sectionMenu?.(menu.node.id) : undefined;
  return <><ol ref={rootRef} className="curriculum-outline" aria-label="目录标题">{payload.chapters.map((chapter, ci) =>
    <li key={chapter.id}>{row({ kind: 'chapter', id: chapter.id }, String(ci + 1), chapter.title, chapter.sections.length > 0)}
      <ol id={outlineId + '-chapter-' + chapter.id} className="motion-disclosure" hidden={!expanded.has(chapter.id)} inert={!expanded.has(chapter.id)} aria-hidden={!expanded.has(chapter.id)}>{chapter.sections.map((section, si) =>
        <li key={section.id}>{row({ kind: 'section', id: section.id }, `${ci + 1}.${si + 1}`, section.title)}
          {sectionDisclosure ? <div className="outline-section-panel" id={outlineId + '-section-' + section.id} hidden={sectionDisclosure.openId !== section.id}>
            {sectionDisclosure.openId === section.id ? sectionDisclosure.content : null}
          </div> : null}</li>)}</ol>
    </li>)}</ol>{menu && menuItem && menuChapter && (writable || extraActions?.length) ? createPortal(<div ref={menuRef} role="menu" tabIndex={-1} aria-label="标题操作" className="outline-context-menu"
      style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
        if (event.key === 'Tab') closeMenu(true);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' || (index < 0 && event.key === 'ArrowUp') ? items.length - 1 :
            (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      {extraActions?.map(action => <button key={action.label} type="button" role="menuitem" disabled={action.disabled}
        onClick={() => { closeMenu(true); action.onSelect(); }}>{action.label}</button>)}
      {writable ? <><button role="menuitem" onClick={() => { updateNode(menu.node.id, item => { item.title = titleText(item.title); });
        setEditing({ id: menu.node.id, original: titleText(menuItem.title) }); closeMenu(); }}>重命名</button>
      {menu.node.kind === 'chapter' ? <button role="menuitem" disabled={menuChapter.sections.length >= 100 || payload.chapters.reduce((n, c) => n + 1 + c.sections.length, 0) >= 500}
        onClick={() => { const next = structuredClone(payload); const id = temporaryId(); next.chapters.find(c => c.id === menu.node.id)!.sections.push({ id, title: '' });
          setExpanded(previous => new Set(previous).add(menu.node.id)); setEditing({ id, original: '' }); onSelect?.(id); onChange?.(next); closeMenu(); }}>添加小标题</button> : null}
      <button role="menuitem" className="danger-quiet" onClick={() => {
        if (!window.confirm(menu.node.kind === 'chapter' ? '从草稿移除此章及其小节？正式目录在确认前不变。' : '从草稿移除此小节？正式目录在确认前不变。')) return;
        const next = structuredClone(payload);
        if (menu.node.kind === 'chapter') next.chapters = next.chapters.filter(c => c.id !== menu.node.id);
        else next.chapters.forEach(c => { c.sections = c.sections.filter(s => s.id !== menu.node.id); });
        onChange?.(next); closeMenu();
      }}>移除</button></> : null}
    </div>, document.body) : null}</>;
}
