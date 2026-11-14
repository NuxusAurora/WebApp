'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { askTeachingQuestion, getTeachingHistory, type TeachingQuestion, type TeachingTurn } from '../lib/learning';
import { Icon } from './icon';

export function TeachingChat({ conversationId, title, onSessionExpired }: {
  conversationId: string; title: string; onSessionExpired: () => void;
}) {
  const [turns, setTurns] = useState<TeachingTurn[] | null>(null);
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
    heading.current?.focus({ preventScroll: true });
    void load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    if (scrollAfterPrepend.current !== null) {
      element.scrollTop = element.scrollHeight - scrollAfterPrepend.current;
      scrollAfterPrepend.current = null;
    } else if (scrollToEnd.current) {
      element.scrollTop = element.scrollHeight;
      scrollToEnd.current = false;
    }
  }, [turns, busy]);

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
    scrollToEnd.current = true;
    setBusy('send');
    setError('');
    try {
      const turn = await askTeachingQuestion(conversationId, body, task.signal);
      if (task.signal.aborted) return;
      scrollToEnd.current = true;
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

  return <section className="learning-conversation-main learning-conversation-point teaching-chat"
    aria-labelledby="learning-point-title">
    <h1 ref={heading} id="learning-point-title" tabIndex={-1}>{title}</h1>
    <div className="teaching-transcript" ref={transcript} role="region" aria-label="问答记录" tabIndex={0}>
      {before ? <button type="button" className="text-button" disabled={Boolean(busy)}
        onClick={() => void load(before)}>查看更早的对话</button> : null}
      {turns?.map(turn => <div key={turn.id} className="teaching-turn">
        <p className="teaching-question"><span className="visually-hidden">你：</span>{turn.question}</p>
        <p className="teaching-answer"><span className="visually-hidden">导师：</span>{turn.answer}</p>
      </div>)}
      {busy === 'send' ? <div className="teaching-turn">
        <p className="teaching-question"><span className="visually-hidden">你：</span>{question.trim()}</p>
      </div> : null}
      <div role="status" className="teaching-status muted">
        {busy === 'send' ? '正在回答…' : busy === 'history' || busy === 'older' ? '正在读取对话…' : null}
      </div>
    </div>
    <form className="teaching-composer" onSubmit={event => void send(event)}>
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {((!turns && error) || reloadNeeded) ? <button type="button" className="button secondary"
        disabled={Boolean(busy)} onClick={() => void load()}>重新加载对话</button> : null}
      {turns ? <div className="teaching-input-row">
        <textarea aria-label="提问" placeholder="围绕这个知识点提问…" rows={2} maxLength={4000}
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
  </section>;
}
