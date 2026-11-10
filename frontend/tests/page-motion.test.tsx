// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageMotion } from '../lib/page-motion';

function Surface({ page, revision = 0 }: { page: string; revision?: number }) {
  const ref = usePageMotion<HTMLDivElement>(page);
  return <div ref={ref} data-revision={revision}><input aria-label="草稿" defaultValue="原值" /></div>;
}
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

function animationDOM(reduced = false) {
  const listeners = new Set<() => void>();
  const media = { matches: reduced, addEventListener: vi.fn((_: string, callback: () => void) => listeners.add(callback)),
    removeEventListener: vi.fn((_: string, callback: () => void) => listeners.delete(callback)) };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn(() => { const animation = { cancel: vi.fn() }; animations.push(animation); return animation; });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  return { media, listeners, animations, animate };
}

describe('page motion lifecycle', () => {
  it('animates committed page changes without remounting drafts or replaying on ordinary updates', () => {
    const { animate } = animationDOM();
    const { rerender } = render(<Surface page="connection" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '未保存' } });
    input.focus();
    rerender(<Surface page="models" />);
    expect(animate).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('未保存');
    expect(input).toHaveFocus();
    rerender(<Surface page="models" revision={1} />);
    expect(animate).toHaveBeenCalledOnce();
  });
  it('cancels interrupted animations and releases the preference listener on unmount', () => {
    const { animations, listeners } = animationDOM();
    const { rerender, unmount } = render(<Surface page="courses" />);
    rerender(<Surface page="profile" />);
    rerender(<Surface page="system" />);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(1);
    unmount();
    expect(animations[1].cancel).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
  it('skips spatial motion under reduced motion and cancels when the preference changes', () => {
    const { media, animate, animations, listeners } = animationDOM(true);
    const { rerender } = render(<Surface page="courses" />);
    rerender(<Surface page="profile" />);
    expect(animate).not.toHaveBeenCalled();
    media.matches = false;
    rerender(<Surface page="system" />);
    act(() => { media.matches = true; listeners.forEach(callback => callback()); });
    expect(animations[0].cancel).toHaveBeenCalledOnce();
  });
});
