// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurriculumOutline } from '../components/curriculum-outline';
import { moveOutline } from '../lib/curriculum-order';
import type { Payload } from '../lib/curriculum';
import { cleanTitles, titleText } from '../lib/curriculum-title';

const payload: Payload = { uncertain_items: ['核对页码'], chapters: [
  { id: 'c1', title: '行列式', sections: [{ id: 's1', title: '很长的小节名称完整内容', page_start: 1 }, { id: 's2', title: '性质' }] },
  { id: 'c2', title: '矩阵', sections: [{ id: 's3', title: '概念' }] },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('curriculum outline', () => {
  function Interactive({ initial = payload }: { initial?: Payload }) {
    const [value, setValue] = useState(initial);
    const [selected, setSelected] = useState('');
    return <CurriculumOutline payload={value} onChange={setValue} selectedId={selected} onSelect={setSelected} />;
  }
  it('renames inline with an immutable order prefix and strips imported numbering', () => {
    const initial = structuredClone(payload); initial.chapters[0].title = '第十二章 行列式'; initial.chapters[0].sections[0].title = '12.3 很长的小节名称完整内容';
    render(<Interactive initial={initial} />);
    const chapter = screen.getByRole('button', { name: '章节 1 行列式' });
    fireEvent.contextMenu(chapter);
    expect(screen.getByRole('menuitem', { name: '添加小标题' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '章节 1标题' });
    expect(input).toHaveValue('行列式');
    expect(input.parentElement?.querySelector('.outline-number')).toHaveTextContent('1');
    fireEvent.change(input, { target: { value: '新的标题' } }); fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '章节 1 新的标题' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: /小节 1.1 很长/ }));
    expect(screen.queryByRole('menuitem', { name: '添加小标题' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const child = screen.getByRole('textbox', { name: '小节 1.1标题' });
    expect(child).toHaveValue('很长的小节名称完整内容');
    fireEvent.change(child, { target: { value: '取消这次修改' } }); fireEvent.keyDown(child, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /小节 1.1 很长/ })).toBeInTheDocument();
  });
  it('adds a child to the targeted collapsed chapter and renumbers after moving it', () => {
    render(<Interactive />);
    fireEvent.contextMenu(screen.getByRole('button', { name: '章节 2 矩阵' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '添加小标题' }));
    const input = screen.getByRole('textbox', { name: '小节 2.2标题' });
    fireEvent.change(input, { target: { value: '新增小节' } }); fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.contextMenu(screen.getByRole('button', { name: '章节 2 矩阵' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
    expect(screen.getByRole('button', { name: '小节 1.2 新增小节' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '章节 2 行列式' })).toBeInTheDocument();
  });
  it('supports keyboard menus, outside dismissal, and clears actions when disabled', () => {
    const change = vi.fn();
    const { rerender } = render(<CurriculumOutline payload={payload} onChange={change} />);
    const chapter = screen.getByRole('button', { name: '章节 1 行列式' });
    fireEvent.keyDown(chapter, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: '添加小标题' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(chapter).toHaveFocus(); expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(chapter); fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(chapter); rerender(<CurriculumOutline payload={payload} onChange={change} disabled />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(chapter); expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
  it('limits new children and keeps payload metadata while normalizing names', () => {
    const full = structuredClone(payload); full.chapters[0].sections = Array.from({ length: 100 }, (_, i) => ({ id: 's' + i, title: 'x' }));
    render(<Interactive initial={full} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: '章节 1 行列式' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: '添加小标题' })).toBeDisabled();
    const imported = structuredClone(payload); imported.chapters[0].title = '第2章 矩阵'; imported.chapters[0].sections[0].title = '2.1 基本概念';
    const cleaned = cleanTitles(imported);
    expect(cleaned.chapters[0].title).toBe('矩阵'); expect(cleaned.chapters[0].sections[0]).toEqual({ ...imported.chapters[0].sections[0], title: '基本概念' });
    expect(imported.chapters[0].title).toBe('第2章 矩阵'); expect(cleaned.uncertain_items).toEqual(payload.uncertain_items);
    expect(titleText('3D 向量')).toBe('3D 向量'); expect(titleText('2024 年习题')).toBe('2024 年习题');
    expect(titleText('§2.1 矩阵的概念')).toBe('矩阵的概念');
  });
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
