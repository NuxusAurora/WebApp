'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type State = { checking: boolean; api: string; database: string; redis: string; message: string; good: boolean };
const initial: State = { checking: true, api: '检查中', database: '检查中', redis: '检查中', message: '正在检查连接…', good: false };
const unavailable: State = { checking: false, api: '无法连接', database: '未确认', redis: '未确认', message: '服务暂时无法连接', good: false };
const label = (state: string) => state === 'ok' ? '正常' : state === 'timeout' ? '连接超时' : '暂不可用';

export function ConnectionStatus() {
  const [state, setState] = useState<State>(initial);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState(initial);
    try {
      const responses = await Promise.all(['health', 'ready'].map(probe => fetch(`/api/v1/${probe}`, {
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })));
      const [health, ready] = await Promise.all(responses.map(response => response.json()));
      if (controller.signal.aborted) return;
      if (!responses[0].ok || health.success !== true) { setState(unavailable); return; }
      if (responses[1].ok && ready.success === true) {
        setState({ checking: false, api: '已连接', database: '正常', redis: '正常', message: '基础服务已就绪', good: true });
      } else if (ready.error?.code === 'DEPENDENCY_UNAVAILABLE') {
        setState({ checking: false, api: '已连接', database: label(ready.error.details?.database),
          redis: label(ready.error.details?.redis), message: '部分基础服务暂不可用', good: false });
      } else setState({ ...unavailable, api: '已连接', message: '暂时无法确认服务状态' });
    } catch { if (!controller.signal.aborted) setState(unavailable); }
  }, []);

  useEffect(() => { void refresh(); return () => active.current?.abort(); }, [refresh]);
  return <section className="status-panel" aria-label="服务连接" aria-busy={state.checking}>
    <div className="status-heading"><div className="status-message" role="status" aria-live="polite">
      <span className={`status-dot ${state.good ? 'good' : state.checking ? 'waiting' : 'warning'}`} aria-hidden="true" />{state.message}
    </div><button type="button" onClick={() => void refresh()} disabled={state.checking}>{state.checking ? '检查中…' : '重新检查'}</button></div>
    <dl className="service-list">{[['API 服务', state.api], ['数据库', state.database], ['缓存服务', state.redis]].map(([name, value]) =>
      <div className="service-row" key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}
