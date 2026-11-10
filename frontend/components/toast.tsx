'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icon';

type Notification = { message: string; id: number };

export function useToast() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const sequence = useRef(0);
  const notify = useCallback((message: string) => {
    setNotification(message ? { message, id: ++sequence.current } : null);
  }, []);
  const dismiss = useCallback(() => setNotification(null), []);
  return { notification, notify, dismiss };
}

export function Toast({ notification, onDismiss, tone = 'success' }: {
  notification: Notification | null;
  onDismiss: () => void;
  tone?: 'success' | 'warning';
}) {
  const [closingId, setClosingId] = useState<number | null>(null);
  const closing = Boolean(notification && closingId === notification.id);
  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(onDismiss, closing ? 180 : 3000);
    return () => window.clearTimeout(timer);
  }, [notification, onDismiss, closing]);

  if (!notification) return null;
  return <div key={notification.id} className={'success-toast' + (tone === 'warning' ? ' warning-toast' : '') + (closing ? ' is-dismissing' : '')} role="status" aria-live="polite" aria-atomic="true">
    <Icon name={tone === 'warning' ? 'alert' : 'check'} size={20} />
    <span>{notification.message}</span>
    <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setClosingId(notification.id)}>
      <Icon name="close" size={16} />
    </button>
  </div>;
}
