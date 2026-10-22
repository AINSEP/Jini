import type { WidgetsEventsPort } from '../../../ports.js';
const listeners = new Set<(scope: readonly string[] | null) => void>();
export function publishContentRefresh(scope: readonly string[] | null = null) { for (const listener of listeners) listener(scope); }
export function resetContentRefreshBus() { listeners.clear(); }
export const events: WidgetsEventsPort = {
  subscribe({ resource, onRefresh }) {
    const listener = (scope: readonly string[] | null) => { if (scope === null || scope.includes(resource)) onRefresh(); };
    listeners.add(listener); return () => listeners.delete(listener);
  },
};
