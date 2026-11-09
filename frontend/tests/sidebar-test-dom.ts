import { vi } from 'vitest';

export function sidebarDOM(initialWidth = 1440) {
  let width = initialWidth;
  const queries: { query: string; listeners: Set<() => void> }[] = [];
  vi.stubGlobal('matchMedia', (query: string) => {
    const record = { query, listeners: new Set<() => void>() }; queries.push(record);
    return { get matches() { return query.includes('min-width: 741') ? width > 740 && width <= 1100 : width <= 740; },
      media: query, addEventListener: (_: string, callback: () => void) => record.listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => record.listeners.delete(callback) };
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'show', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) {
    this.setAttribute('open', ''); this.querySelector<HTMLElement>('a,button')?.focus();
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  return { resize(next: number) { width = next; queries.forEach(record => record.listeners.forEach(listener => listener())); },
    listenerCount() { return queries.reduce((n, q) => n + q.listeners.size, 0); } };
}
