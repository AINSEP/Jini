import { DEFAULT_RECENTS_LIMIT, DEFAULT_RECENTS_STORAGE_NAMESPACE } from './constants.js';
import { parseRecentIds, pushRecentId } from './rules.js';
import type { CommandPaletteRecentsPort } from './ports.js';

function storageKey(namespace: string, scopeKey: string): string {
  return `${namespace}:${scopeKey}`;
}

/**
 * Real, SSR-guarded `localStorage`-backed recents storage — only touches
 * generic browser APIs, so (same reasoning as `features/browser-chrome`'s
 * history storage) this ships as a real implementation rather than a
 * fake/test double.
 */
export function createLocalStorageRecents(
  options: { namespace?: string; limit?: number } = {},
): CommandPaletteRecentsPort {
  const namespace = options.namespace ?? DEFAULT_RECENTS_STORAGE_NAMESPACE;
  const limit = options.limit ?? DEFAULT_RECENTS_LIMIT;

  const read = (scopeKey: string): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey(namespace, scopeKey));
      return raw ? parseRecentIds({ raw }) : [];
    } catch {
      return [];
    }
  };

  return {
    read,
    push(scopeKey, id) {
      if (typeof window === 'undefined') return;
      try {
        const next = pushRecentId({ previous: read(scopeKey), id, limit });
        window.localStorage.setItem(storageKey(namespace, scopeKey), JSON.stringify(next));
      } catch {
        // Quota exceeded or private mode — recents are best-effort, drop silently.
      }
    },
  };
}
