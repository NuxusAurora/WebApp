'use client';

import { useLayoutEffect, useRef } from 'react';

// Observe committed navigation. Business state, guards and focus remain with callers.
export function usePageMotion<T extends HTMLElement>(page: string, direction = 1) {
  const surface = useRef<T>(null);
  const previous = useRef(page);
  useLayoutEffect(() => {
    const changed = previous.current !== page;
    previous.current = page;
    const element = surface.current;
    if (!changed || !element || typeof element.animate !== 'function') return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches) return;
    const animation = element.animate([
      { opacity: .55, transform: `translateX(${direction * 8}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const cancel = () => animation.cancel();
    preference?.addEventListener('change', cancel);
    return () => {
      cancel();
      preference?.removeEventListener('change', cancel);
    };
  }, [page, direction]);
  return surface;
}
