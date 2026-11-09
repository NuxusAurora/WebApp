// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurriculumOutline } from '../components/curriculum-outline';
import { moveOutline } from '../lib/curriculum-order';
import type { Payload } from '../lib/curriculum';

const payload: Payload = { uncertain_items: ['核对页码'], chapters: [
  { id: 'c1', title: '行列式', sections: [{ id: 's1', title: '很长的小节名称完整内容', page_start: 1 }, { id: 's2', title: '性质' }] },
  { id: 'c2', title: '矩阵', sections: [{ id: 's3', title: '概念' }] },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('curriculum outline', () => {
  it('collapses children with accessible buttons and exposes full titles on hover', () => {
    render(<CurriculumOutline payload={payload} />);
    const chapter = screen.getByRole('button', { name: '章节 1 行列式' });
    expect(chapter).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /很长的小节/ })).not.toBeInTheDocument();
    fireEvent.click(chapter);
    expect(chapter).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /很长的小节/ })).toHaveAttribute('title', '很长的小节名称完整内容');
    fireEvent.click(chapter);
    expect(screen.queryByRole('button', { name: /很长的小节/ })).not.toBeInTheDocument();
  });
  it('drags a child into a collapsed different chapter and selects the moved item', () => {
    const change = vi.fn(); const select = vi.fn();
    render(<CurriculumOutline payload={payload} onChange={change} onSelect={select} />);
    fireEvent.click(screen.getByRole('button', { name: '章节 1 行列式' }));
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动小节 1.1' }), { dataTransfer: transfer });
    const target = screen.getByRole('button', { name: '章节 2 矩阵' }).parentElement!;
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });
    const next = change.mock.calls[0][0];
    expect(next.chapters[0].sections.map((item: { id: string }) => item.id)).toEqual(['s2']);
    expect(next.chapters[1].sections.map((item: { id: string }) => item.id)).toEqual(['s3', 's1']);
    expect(next.chapters[1].sections[1].page_start).toBe(1);
    expect(next.uncertain_items).toEqual(payload.uncertain_items);
    expect(payload.chapters[0].sections).toHaveLength(2);
    expect(select).toHaveBeenLastCalledWith('s1');
  });
  it('blocks disabled drops and does not apply cancelled drags', () => {
    const change = vi.fn();
    const { rerender } = render(<CurriculumOutline payload={payload} onChange={change} />);
    const transfer = { setData: vi.fn() };
    const handle = screen.getByRole('button', { name: '拖动章节 1' });
    fireEvent.dragStart(handle, { dataTransfer: transfer }); fireEvent.dragEnd(handle);
    fireEvent.drop(screen.getByRole('button', { name: '章节 2 矩阵' }).parentElement!, { dataTransfer: transfer });
    expect(change).not.toHaveBeenCalled();
    rerender(<CurriculumOutline payload={payload} onChange={change} disabled />);
    expect(handle).toBeDisabled();
    fireEvent.dragStart(handle, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole('button', { name: '章节 2 矩阵' }).parentElement!, { dataTransfer: transfer });
    expect(change).not.toHaveBeenCalled();
  });
  it('moves with pointer capture and cancels when Escape is pressed', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const change = vi.fn();
    render(<CurriculumOutline payload={payload} onChange={change} />);
    const handle = screen.getByRole('button', { name: '拖动章节 1' });
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn(() => true); handle.releasePointerCapture = vi.fn();
    const target = screen.getByRole('button', { name: '章节 2 矩阵' }).parentElement!;
    const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    try {
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(handle, { clientX: 10, clientY: 100 });
      fireEvent.keyDown(handle, { key: 'Escape' });
      fireEvent.pointerUp(handle);
      expect(change).not.toHaveBeenCalled();
      fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(handle, { clientX: 10, clientY: 100 });
      fireEvent.pointerUp(handle);
      expect(change.mock.calls[0][0].chapters.map((item: { id: string }) => item.id)).toEqual(['c2', 'c1']);
    } finally {
      if (original) Object.defineProperty(document, 'elementFromPoint', original);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
  it('reorders both levels by stable ID and protects chapter boundaries and capacity', () => {
    const reordered = moveOutline(payload, { kind: 'chapter', id: 'c1' }, { kind: 'chapter', id: 'c2', position: 'after' });
    expect(reordered.chapters.map(item => item.id)).toEqual(['c2', 'c1']);
    expect(reordered.chapters[1].sections).toEqual(payload.chapters[0].sections);
    const sections = moveOutline(payload, { kind: 'section', id: 's2' }, { kind: 'section', id: 's1', position: 'before' });
    expect(sections.chapters[0].sections.map(item => item.id)).toEqual(['s2', 's1']);
    const moved = moveOutline(payload, { kind: 'section', id: 's1' }, { kind: 'section', id: 's3', position: 'before' });
    expect(moved.chapters[1].sections.map(item => item.id)).toEqual(['s1', 's3']);
    expect(moveOutline(payload, { kind: 'chapter', id: 'c1' }, { kind: 'section', id: 's3', position: 'after' })).toBe(payload);
    const full = structuredClone(payload); full.chapters[1].sections = Array.from({ length: 100 }, (_, i) => ({ id: 'full-' + i, title: 'x' }));
    expect(moveOutline(full, { kind: 'section', id: 's1' }, { kind: 'chapter', id: 'c2', position: 'inside' })).toBe(full);
  });
});
