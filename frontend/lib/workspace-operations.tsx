'use client';

import { createContext, useContext, useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError } from './api';

type Operation =
  | { status: 'running'; label: string }
  | { status: 'succeeded' }
  | { status: 'failed'; error: unknown };
type Execute = (signal: AbortSignal, report: (label: string) => void) => Promise<void>;

function createOperations() {
  const states = new Map<string, Operation>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  function publish(key: string, state?: Operation) {
    if (state) states.set(key, state);
    else states.delete(key);
    listeners.forEach(listener => listener());
  }
  return {
    get: (key: string) => states.get(key),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    acknowledge(key: string, state: Operation) {
      if (states.get(key) !== state) return false;
      publish(key);
      return true;
    },
    start(key: string, label: string, execute: Execute, onExpired?: () => void) {
      if (states.has(key)) return;
      const controller = new AbortController();
      controllers.set(key, controller);
      const report = (label: string) => {
        if (!controller.signal.aborted) publish(key, { status: 'running', label });
      };
      report(label);
      void (async () => {
        try {
          await execute(controller.signal, report);
          if (!controller.signal.aborted) publish(key, { status: 'succeeded' });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && error.status === 401 && onExpired) {
            publish(key);
            onExpired();
          } else publish(key, { status: 'failed', error });
        } finally {
          if (controllers.get(key) === controller) controllers.delete(key);
        }
      })();
    },
    reset() {
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      states.clear();
    },
  };
}

const OperationsContext = createContext<{
  operations: ReturnType<typeof createOperations>; onExpired?: () => void;
} | null>(null);
const serverSnapshot = () => undefined;

// Mounted once per signed-in workspace. Navigating only replaces consumers.
export function WorkspaceOperations({ children, onExpired }: { children: ReactNode; onExpired?: () => void }) {
  const [operations] = useState(createOperations);
  useEffect(() => () => operations.reset(), [operations]);
  return <OperationsContext.Provider value={{ operations, onExpired }}>{children}</OperationsContext.Provider>;
}

export function useWorkspaceOperation(key: string, onSuccess: () => void, onFailure: (error: unknown) => void) {
  const scope = useContext(OperationsContext);
  if (!scope) throw new Error('WorkspaceOperations is required');
  const { operations, onExpired } = scope;
  const state = useSyncExternalStore(operations.subscribe, () => operations.get(key), serverSnapshot);
  const settled = useEffectEvent((entry: Exclude<Operation, { status: 'running' }>) => {
    if (!operations.acknowledge(key, entry)) return;
    if (entry.status === 'succeeded') onSuccess();
    else onFailure(entry.error);
  });
  useEffect(() => {
    if (state && state.status !== 'running') settled(state);
  }, [key, state]);
  return {
    busy: Boolean(state),
    label: state?.status === 'running' ? state.label : '',
    start: (label: string, execute: Execute) => operations.start(key, label, execute, onExpired),
  };
}
