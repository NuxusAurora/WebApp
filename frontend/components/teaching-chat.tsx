'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../lib/api';
import { askTeachingQuestion, getTeachingHistory, type TeachingHistory, type TeachingQuestion, type TeachingTurn } from '../lib/learning';
import { Icon } from './icon';

export function TeachingChat({ conversationId, open, activeStep, onClose, onSessionExpired }: {
  conversationId: string; open: boolean; onClose: () => void; onSessionExpired: () => void;
  activeStep?: number;
}) {
  const [turns, setTurns] = useState<TeachingTurn[] | null>(null);
  const [context, setContext] = useState<TeachingHistory['context']>();
  const [unread, setUnread] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'history' | 'older' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const retry = useRef<TeachingQuestion | null>(null);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const scrollToEnd = useRef(false);
  const scrollAfterPrepend = useRef<number | null>(null);
  const surface = useRef<HTMLElement>(null);

  useEffect(() => {
    const breakpoint = window.matchMedia('(width < 768px)');
    const update = () => setMobile(breakpoint.matches);
    update();
    breakpoint.addEventListener('change', update);
    return () => breakpoint.removeEventListener('change', update);
  }, []);

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); onClose(); return;
    }
    if (!mobile || event.key !== 'Tab') return;
    const controls = [...(surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]') ?? [])]
      .filter(element => element.getClientRects().length > 0);
    const [first] = controls;
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function nearEnd() {
    const el = transcript.current;
    return !el || el.scrollHeight - el.clientHeight - el.scrollTop < 40;
  }

  function goToEnd() {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUnread(false);
  }

  const fail = useCallback((reason: unknown) => {
    if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
    else setError(reason instanceof Error ? reason.message : '请求失败，请重试');
  }, [onSessionExpired]);

  const load = useCallback(async (cursor?: number) => {
    if (request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(cursor ? 'older' : 'history');
    setError('');
    try {
      const result = await getTeachingHistory(conversationId, task.signal, cursor);
      if (task.signal.aborted) return;
      setContext(result.context);
      if (cursor && transcript.current) {
        scrollAfterPrepend.current = transcript.current.scrollHeight - transcript.current.scrollTop;
      } else {
        scrollToEnd.current = true;
        setReloadNeeded(false);
        retry.current = null;
      }
      setTurns(previous => cursor ? [...result.turns, ...(previous ?? [])] : result.turns);
      setBefore(result.before);
    } catch (reason) {
      if (!task.signal.aborted) fail(reason);
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(null);
      }
    }
  }, [conversationId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [conversationId]);

  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = transcript.current;
    if (!element) return;
    if (scrollAfterPrepend.current !== null) {
      element.scrollTop = element.scrollHeight - scrollAfterPrepend.current;
      scrollAfterPrepend.current = null;
    } else if (scrollToEnd.current) {
      element.scrollTop = element.scrollHeight;
      scrollToEnd.current = false;
    }
  }, [turns, busy, open]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = question.trim();
    if (!content || !turns || request.current || reloadNeeded) return;
    const task = new AbortController();
    request.current = task;
    const body = retry.current?.question === content ? retry.current : {
      request_id: crypto.randomUUID(), after: turns.at(-1)?.position ?? 0, question: content,
    };
    retry.current = body;
    scrollToEnd.current = nearEnd();
    setBusy('send');
    setError('');
    try {
      const turn = await askTeachingQuestion(conversationId, body, task.signal);
      if (task.signal.aborted) return;
      scrollToEnd.current = nearEnd() && open;
      if (!scrollToEnd.current) setUnread(true);
      setTurns(previous => [...(previous ?? []), turn]);
      setQuestion('');
      retry.current = null;
    } catch (reason) {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 409) setReloadNeeded(true);
      fail(reason);
    } finally {
      if (request.current === task) {
        request.current = null;
        setBusy(null);
      }
    }
  }

  return <aside className="teaching-chat" id="teaching-questions" hidden={!open} ref={surface}
    role={mobile ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}
    aria-labelledby="teaching-questions-title" onKeyDown={handleKey}>
    <header className="teaching-chat-header">
      <h2 ref={heading} id="teaching-questions-title" tabIndex={-1}>随时提问</h2>
      <button type="button" className="text-button" onClick={onClose} aria-label="关闭提问窗">关闭</button>
      {activeStep || context ? <p className="teaching-context">正在参考：当前题目 · 第 {activeStep ?? context?.step_index} 步</p> : null}
    </header>
    <div className="teaching-transcript" ref={transcript} role="region" aria-label="问答记录" tabIndex={0}
      onScroll={() => { if (unread && nearEnd()) setUnread(false); }}>
      {before ? <button type="button" className="text-button" disabled={Boolean(busy)}
        onClick={() => void load(before)}>查看更早的对话</button> : null}
      {turns?.map(turn => <div key={turn.id} className="teaching-turn">
        <p className="teaching-question"><strong>你</strong>{turn.question}</p>
        <p className="teaching-answer"><strong>助手</strong>{turn.answer}</p>
      </div>)}
      {busy === 'send' ? <div className="teaching-turn">
        <p className="teaching-question"><span className="visually-hidden">你：</span>{question.trim()}</p>
      </div> : null}
      {turns?.length === 0 && busy !== 'send' ? <p className="teaching-empty">你可以请助手解释当前题目，不影响主窗进度。</p> : null}
      <div role="status" className="teaching-status muted">
        {busy === 'send' ? '正在回答…' : busy === 'history' || busy === 'older' ? '正在读取对话…' : unread ? '有新回复' : null}
      </div>
    </div>
    <form className="teaching-composer" onSubmit={event => void send(event)}>
      {unread ? <button type="button" className="text-button" onClick={goToEnd}>查看新回复</button> : null}
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {((!turns && error) || reloadNeeded) ? <button type="button" className="button secondary"
        disabled={Boolean(busy)} onClick={() => void load()}>重新加载对话</button> : null}
      {turns ? <div className="teaching-input-row">
        <textarea aria-label="提问" placeholder="对当前步骤或知识点提问…" rows={2} maxLength={4000}
          value={question} readOnly={busy === 'send'} onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
        <button className="button primary" type="submit" disabled={!question.trim() || Boolean(busy) || reloadNeeded}>
          <Icon name="arrow" size={16} />发送
        </button>
      </div> : null}
    </form>
  </aside>;
}
