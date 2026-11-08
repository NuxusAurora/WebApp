'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from './icon';

type Notification = { message: string };

export function useToast() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const notify = useCallback((message: string) => {
    setNotification(message ? { message } : null);
  }, []);
  const dismiss = useCallback(() => setNotification(null), []);
  return { notification, notify, dismiss };
}

export function Toast({ notification, onDismiss }: {
  notification: Notification | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [notification, onDismiss]);

  if (!notification) return null;
  return <div className="success-toast" role="status" aria-live="polite" aria-atomic="true">
    <Icon name="check" size={20} />
    <span>{notification.message}</span>
    <button className="icon-button" type="button" aria-label="关闭提示" onClick={onDismiss}>
      <Icon name="close" size={16} />
    </button>
  </div>;
}
