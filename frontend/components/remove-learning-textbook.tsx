'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { hideLearningTextbook } from '../lib/learning';
import { Icon } from './icon';

export function RemoveLearningTextbook({ courseId, title, onRemoved, onSessionExpired }: {
  courseId: string;
  title: string;
  onRemoved: () => void;
  onSessionExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function remove() {
    if (request.current) return;
    const task = new AbortController();
    request.current = task;
    setBusy(true);
    setError('');
    try {
      await hideLearningTextbook(courseId, task.signal);
      if (!task.signal.aborted) onRemoved();
    } catch (reason) {
      if (task.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onSessionExpired();
      else setError(reason instanceof Error ? reason.message : '无法移除学习对话，请重试');
    } finally {
      request.current = null;
      if (!task.signal.aborted) setBusy(false);
    }
  }

  return <>
    <button type="button" className="sidebar-item learning-textbook-remove" aria-disabled={busy}
      aria-label={'从学习对话移除：' + title} title="从学习对话移除" onClick={() => void remove()}>
      <Icon name="trash" size={15} />
    </button>
    {error ? <p className="sidebar-project-status learning-textbook-error" role="alert">{error}</p> : null}
  </>;
}
