import type { ComposerDiscoveryGroup, ComposerDiscoveryItem } from '../slots.js';

export interface ComposerDiscoveryMatch {
  groupId: string;
  groupLabel: string;
  item: ComposerDiscoveryItem;
}

/** Open Design's active slash-token rule, kept as a pure parser for deterministic testing. */
export function parseComposerSlashQuery(draft: string): string | null {
  return draft.match(/^\/([^\s/]*)$/)?.[1] ?? null;
}

/** Flattens non-empty groups while preserving host order, then applies case-insensitive search. */
export function filterComposerDiscovery(
  groups: readonly ComposerDiscoveryGroup[],
  query: string,
): ComposerDiscoveryMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches: ComposerDiscoveryMatch[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      const searchable = [item.label, item.description, item.kind, ...(item.keywords ?? [])]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      if (normalizedQuery === '' || searchable.includes(normalizedQuery)) {
        matches.push({ groupId: group.id, groupLabel: group.label, item });
      }
    }
  }

  return matches;
}

/** Replaces the complete active slash token; callers only invoke this after the parser matches. */
export function replaceComposerSlashTrigger(draft: string, insertText: string): string {
  return parseComposerSlashQuery(draft) === null ? draft : insertText;
}

/** Adds a menu-selected resource to an existing prompt without concatenating words. */
export function appendComposerDiscovery(draft: string, insertText: string): string {
  if (draft.trim() === '') return insertText;
  return `${draft.trimEnd()} ${insertText}`;
}

export type ComposerSlashKeyAction =
  | { type: 'move'; offset: -1 | 1 }
  | { type: 'select' }
  | { type: 'dismiss' }
  | { type: 'none' };

/** Maps palette keys without owning React state; arrows are intentionally circular at the caller. */
export function resolveComposerSlashKeyAction(key: string, shiftKey: boolean): ComposerSlashKeyAction {
  if (key === 'ArrowDown') return { type: 'move', offset: 1 };
  if (key === 'ArrowUp') return { type: 'move', offset: -1 };
  if ((key === 'Enter' || key === 'Tab') && !shiftKey) return { type: 'select' };
  if (key === 'Escape') return { type: 'dismiss' };
  return { type: 'none' };
}
