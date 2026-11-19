import { orFallbackSync } from '@jini-ai/core/errors/idioms';
import { DEFAULT_HISTORY_STORAGE_NAMESPACE, HISTORY_LIMIT } from './constants.js';
import { historyStorageKey, parseHistoryPayload, serializeHistoryPayload } from './rules.js';
import type { BrowserBridgeRegistrationPort, BrowserHistoryStoragePort } from './ports.js';

export interface BrowserChromeDependencies {
  historyStorage: BrowserHistoryStoragePort;
  bridgeRegistration: BrowserBridgeRegistrationPort;
}

/**
 * Real, SSR-guarded `localStorage`-backed history storage. Only touches
 * generic browser APIs (no backend-specific shape), so — same reasoning as
 * `features/connectors`'s browser-only bridges — this ships as a real
 * implementation rather than a fake/test double.
 */
export function createBrowserHistoryStorage(
  options: { namespace?: string; limit?: number } = {},
): BrowserHistoryStoragePort {
  const namespace = options.namespace ?? DEFAULT_HISTORY_STORAGE_NAMESPACE;
  const limit = options.limit ?? HISTORY_LIMIT;
  return {
    loadHistory(scopeKey) {
      if (typeof window === 'undefined') return [];
      return orFallbackSync({
        work: () => {
          const raw = window.localStorage.getItem(historyStorageKey(namespace, scopeKey));
          return raw ? parseHistoryPayload(raw, limit) : [];
        },
        fallback: [],
        step: 'read browser history preference',
      });
    },
    saveHistory(scopeKey, history) {
      if (typeof window === 'undefined') return;
      // Ignore storage quota and private-mode failures.
      orFallbackSync({
        work: () => {
          window.localStorage.setItem(historyStorageKey(namespace, scopeKey), serializeHistoryPayload(history, limit));
        },
        fallback: undefined,
        step: 'save browser history preference',
      });
    },
  };
}

/**
 * Default bridge-registration port: a no-op. A host that wants to expose the
 * live browser tab's handle to some external mechanism (its own bridge, an
 * event bus, whatever it uses) supplies a real implementation instead.
 */
export function createNoopBrowserBridgeRegistration(): BrowserBridgeRegistrationPort {
  return {
    registerBrowserHandle() {
      // Intentionally no-op — see the port's doc comment.
    },
  };
}

export function createDefaultBrowserChromeDependencies(
  options: { historyNamespace?: string; historyLimit?: number } = {},
): BrowserChromeDependencies {
  return {
    historyStorage: createBrowserHistoryStorage({
      ...(options.historyNamespace !== undefined ? { namespace: options.historyNamespace } : {}),
      ...(options.historyLimit !== undefined ? { limit: options.historyLimit } : {}),
    }),
    bridgeRegistration: createNoopBrowserBridgeRegistration(),
  };
}
