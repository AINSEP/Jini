import { useCallback, useSyncExternalStore } from "react";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

/** Hook seam; the default adapter below owns browser storage and storage events. */
export interface BrowserAgentSettingsPort {
  getEnabled(required: Record<string, never>, optional?: Record<string, never>): boolean;
  setEnabled(required: { enabled: boolean }, optional?: Record<string, never>): void;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
}

/** What `useBrowserAgentSettings` returns — the shape the settings panel's injected hook supplies. */
export interface BrowserAgentSettingsState {
  enabled: boolean;
  setEnabled(required: { enabled: boolean }, optional?: Record<string, never>): void;
}

/**
 * Admin browser preference, deliberately origin-local rather than an installation policy.
 * A blocked storage API still permits a session-only opt-out. No server or schema is needed.
 * The host owns `preferenceKey` (its storage key), so a saved opt-out survives a host rename.
 * @example createBrowserAgentSettingsPort({ preferenceKey: "host.admin.webmcp.enabled" })
 */
export function createBrowserAgentSettingsPort({ preferenceKey }: { preferenceKey: string }, _optional: Record<string, never> = {}): BrowserAgentSettingsPort {
  const listeners = new Set<() => void>();
  let sessionOverride: boolean | undefined;
  const getEnabled = (_required: Record<string, never> = {}, _opt: Record<string, never> = {}): boolean => {
    if (sessionOverride !== undefined) return sessionOverride;
    return orFallbackSync({ work: () => window.localStorage.getItem(preferenceKey) !== "false", fallback: true, step: "Read browser agent preference" });
  };
  const setEnabled = ({ enabled }: { enabled: boolean }, _opt: Record<string, never> = {}): void => {
    sessionOverride = enabled;
    /* Keep the choice for this session when storage is blocked. */
    orFallbackSync({ work: () => {
      window.localStorage.setItem(preferenceKey, String(enabled));
      sessionOverride = undefined;
    }, fallback: undefined, step: "Save browser agent preference" });
    for (const listener of listeners) listener();
  };
  const subscribe = ({ listener }: { listener: () => void }, _opt: Record<string, never> = {}): (() => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== preferenceKey) return;
      sessionOverride = undefined;
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
  };
  return { getEnabled, setEnabled, subscribe };
}

const serverSnapshot = () => true;

/**
 * The browser-agent opt-out over the host-bound preference port; server render reports enabled.
 * @example useBrowserAgentSettings({ port })
 */
export function useBrowserAgentSettings(
  { port }: { port: BrowserAgentSettingsPort },
  _optional: Record<string, never> = {},
): BrowserAgentSettingsState {
  const listen = useCallback((listener: () => void) => port.subscribe({ listener }), [port]);
  const snapshot = useCallback(() => port.getEnabled({}), [port]);
  const enabled = useSyncExternalStore(listen, snapshot, serverSnapshot);
  const setEnabled = useCallback((required: { enabled: boolean }, optional: Record<string, never> = {}) => port.setEnabled(required, optional), [port]);
  return { enabled, setEnabled };
}
