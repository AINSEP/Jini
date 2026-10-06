import { normalizeComposerHistory, type ComposerHistoryStoragePort } from '../../core/composer-history.js';

/** Browser default; private/embedded hosts may replace this port without changing recall. */
export function createBrowserComposerHistoryStorage(
  _required: {},
  { storage, prefix = 'jini:composer-history:v1:' }: { storage?: Pick<Storage, 'getItem' | 'setItem'>; prefix?: string } = {},
): ComposerHistoryStoragePort {
  const memory = new Map<string, readonly string[]>();
  function resolveStorage() {
    // Accessing localStorage itself can throw (sandboxed embeds/private browsing).
    return storage ?? globalThis.localStorage;
  }
  return {
    async read({ scope }, _optional = {}) {
      try {
        const raw = resolveStorage()?.getItem(prefix + encodeURIComponent(scope));
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const entries = normalizeComposerHistory({ entries: parsed.filter((value): value is string => typeof value === 'string') });
            memory.set(scope, entries);
            return entries;
          }
        }
      } catch {
        // Storage denial/corruption must not disable draft editing or in-memory recall.
      }
      return memory.get(scope) ?? [];
    },
    async write({ scope, entries }, _optional = {}) {
      const normalized = normalizeComposerHistory({ entries });
      memory.set(scope, normalized);
      try {
        resolveStorage()?.setItem(prefix + encodeURIComponent(scope), JSON.stringify(normalized));
      } catch {
        // Quota/denial falls back to the same scoped in-memory list.
      }
    },
  };
}

export const browserComposerHistoryStorage = createBrowserComposerHistoryStorage({});
