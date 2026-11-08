// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../components/connection-status';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const ok = (data: object) => Response.json({ success: true, data, error: null });
const health = () => ok({ status: 'ok' });
const ready = () => ok({ status: 'ready', database: 'ok', redis: 'ok' });

it('shows loading, dependency failure and a successful manual retry', async () => {
  let recover = false;
  const fetcher = vi.fn(async (url: string) => url.endsWith('health') ? health() : recover ? ready() : Response.json({
    success: false, data: null, error: { code: 'DEPENDENCY_UNAVAILABLE', details: { database: 'ok', redis: 'unavailable' } },
  }, { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  render(<ConnectionStatus />);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(await screen.findByText('部分基础服务暂不可用')).toBeVisible();
  expect(screen.getByText('暂不可用')).toBeVisible();
  recover = true;
  fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
  expect(await screen.findByText('基础服务已就绪')).toBeVisible();
  expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/v1/'))).toBe(true);
});

it('shows upstream unavailability and aborts pending work on unmount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
  const view = render(<ConnectionStatus />);
  expect(await screen.findByText('服务暂时无法连接')).toBeVisible();
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    signals.push(options.signal as AbortSignal);
    return new Promise(() => {});
  }));
  fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
  await waitFor(() => expect(signals).toHaveLength(2));
  view.unmount();
  expect(signals.every(signal => signal.aborted)).toBe(true);
});
