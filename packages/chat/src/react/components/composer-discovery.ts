import type { ComposerDiscoveryGroup, ComposerDiscoveryItem } from '../slots.js';

export interface ComposerDiscoveryMatch {
  groupId: string;
  groupLabel: string;
  item: ComposerDiscoveryItem;
}

/**
 * A parsed `/command` or `/command argument…` token, anchored to the WHOLE draft (`^...$`) —
 * matching non-null means the draft contains nothing but the trigger, which is what keeps
 * {@link replaceComposerSlashTrigger}'s whole-draft replacement safe with no separate span to
 * track (verified across three independent designs in the 2026-08-12 debate: a `[start, end]`
 * tuple is always `[0, draft.length]` under this grammar and would be dead generality).
 */
export interface ComposerSlashQuery {
  command: string;
  /**
   * `null` until a separator (one or more spaces) is typed after the command word; from then on
   * holds the verbatim trailing text — including internal spaces and slashes — never re-split.
   */
  argument: string | null;
}

const SLASH_QUERY_RE = /^\/([^\s/]*)(?:(\s+)([\s\S]*))?$/;

/**
 * Open Design's active slash-token rule (`/^\/([^\s/]*)$/`), extended to admit one optional
 * trailing argument while staying anchored end-to-end. The command segment itself is unchanged —
 * still no internal whitespace or slash — so every existing no-argument caller parses identically
 * to before this extension.
 */
export function parseComposerSlashQuery(draft: string): ComposerSlashQuery | null {
  const match = SLASH_QUERY_RE.exec(draft);
  if (!match) return null;
  const [, command, separator, rest] = match;
  return { command: command ?? '', argument: separator === undefined ? null : (rest ?? '') };
}

/**
 * Once a separator has been typed, only an item whose declared `command` exactly equals the typed
 * command word survives. Required so that typing `/mcp supabase` cannot still surface an unrelated
 * `/mcp-docs` row (a substring match on "mcp" would keep it alive) and, worse, hand that row a
 * `server-id` argument that was typed for a different command. An item with no `command` is
 * dropped outright — it declared no argument grammar to lock onto.
 */
function matchesLockedCommand(item: ComposerDiscoveryItem, normalizedCommand: string): boolean {
  return item.command !== undefined && item.command.toLowerCase() === normalizedCommand;
}

/**
 * Still typing the command word: every item — command-bearing or not — is eligible via the
 * existing case-insensitive fuzzy match over `command`/`label`/`description`/`kind`/`keywords`.
 */
function matchesFuzzyCommand(item: ComposerDiscoveryItem, normalizedCommand: string): boolean {
  if (normalizedCommand === '') return true;
  const searchable = [item.command, item.label, item.description, item.kind, ...(item.keywords ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return searchable.includes(normalizedCommand);
}

/**
 * Flattens non-empty groups while preserving host order, then filters.
 *
 * Two modes, selected by `query.argument`: {@link matchesFuzzyCommand} while the command word is
 * still being typed (`argument === null`), {@link matchesLockedCommand} once a separator has been
 * typed (`argument !== null`) — see each helper's own doc for why the rule changes at that point.
 */
export function filterComposerDiscovery(
  groups: readonly ComposerDiscoveryGroup[],
  query: ComposerSlashQuery,
): ComposerDiscoveryMatch[] {
  const normalizedCommand = query.command.trim().toLowerCase();
  const matchesQuery = query.argument !== null ? matchesLockedCommand : matchesFuzzyCommand;
  const matches: ComposerDiscoveryMatch[] = [];

  for (const group of groups) {
    for (const item of group.items) {
      if (matchesQuery(item, normalizedCommand)) matches.push({ groupId: group.id, groupLabel: group.label, item });
    }
  }

  return matches;
}

export type ComposerSlashResolution =
  | {
      /**
       * The command word is not yet complete, or a required argument hasn't been typed yet.
       * Complete the trigger to `draft` and keep editing — no host effect fires.
       */
      type: 'complete';
      draft: string;
    }
  | {
      /** Ready to notify the host. `argument` is `undefined` for a plain macro item (no
       * `command` declared) — its own `insertText`/`label` drives the draft as before. */
      type: 'invoke';
      argument?: string | null;
    };

/**
 * Decides what selecting `item` (via click, Enter, or Tab) should do against the current `draft`.
 *
 * A plain item (no `command`) is unaffected — always resolves to `'invoke'`, preserving today's
 * one-step select-and-replace behavior exactly. A command-bearing item completes the trigger
 * instead of invoking whenever invoking now would be premature or meaningless:
 * - the typed command word is only a fuzzy/prefix match, not the declared word itself (Enter
 *   disambiguates rather than guessing which of several prefix-matched commands was meant);
 * - the item takes an argument and none has been typed yet (no separator);
 * - the argument is declared `required` and only whitespace follows the separator.
 *
 * Everything else invokes: a no-argument command the moment its exact word is typed, or an
 * argument-taking command the moment a separator exists and (if required) the argument is
 * non-blank.
 */
export function resolveComposerSlashInvocation(
  draft: string,
  item: ComposerDiscoveryItem,
): ComposerSlashResolution | null {
  const query = parseComposerSlashQuery(draft);
  if (!query) return null;
  if (!item.command) return { type: 'invoke' };

  const completeTo = (): ComposerSlashResolution => ({
    type: 'complete',
    draft: `/${item.command}${item.argument ? ' ' : ''}`,
  });

  if (query.command.trim().toLowerCase() !== item.command.toLowerCase()) return completeTo();
  if (!item.argument) return { type: 'invoke', argument: query.argument };
  if (query.argument === null) return completeTo();
  if (item.argument.required && query.argument.trim() === '') return completeTo();

  return { type: 'invoke', argument: query.argument };
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
