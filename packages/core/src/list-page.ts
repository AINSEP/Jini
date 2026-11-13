/**
 * @file The one cursor contract for capped lists (refactor pattern "lists cut off at a limit",
 * 2026-11-13).
 *
 * Why it exists: list calls with a limit and no cursor (members 100, newsletter 100, other-site keys
 * 50, visitor assistant 20) returned the first N rows and said nothing, so the admin screen and the
 * assistant both believed they had everything. Forms submissions, trash, comments and the admin
 * entity list already page as `{ items, nextCursor }` over a keyset; this module is that contract
 * once, generic over the sort key, so every remaining list applies the same shape.
 *
 * Contract: request `{ limit?, cursor? }`; response `{ items, nextCursor }` where `nextCursor` is
 * `null` on the last page. The cursor is opaque and carries the POSITION (sort values + id), never a
 * row id to look up, so a page still resumes after the row it ended on is deleted. Forward-only.
 *
 * Storage- and server-neutral: a repo over-fetches `limit + 1` rows in its own query language and
 * hands them to {@link pageFromOverfetch}.
 */
import { ToolInputError } from './tool-input-errors.js';

/** One page of a list. `nextCursor === null` means there is nothing after these items. */
export interface ListPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** A keyset position: the row's sort values, ending with its unique id as the tie-breaker. */
export type ListPosition = readonly (string | number)[];

/** Hard ceiling when a caller names none — big enough for any screen, small enough for one response. */
export const DEFAULT_MAX_LIST_LIMIT = 200;

/** Default page size when a caller names none. */
export const DEFAULT_LIST_LIMIT = 50;

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * Builds the opaque cursor for the row a page ended on.
 * @complexity O(position size).
 */
export function encodeListCursor(required: { position: ListPosition }, _optional: Record<string, never> = {}): string {
  return toBase64Url(JSON.stringify(required.position));
}

/**
 * Reads a cursor {@link encodeListCursor} built. Refuses anything else instead of restarting from the
 * first page — a silently restarted scan repeats rows forever.
 *
 * @param required.size - How many values the caller's position has (sort keys + id).
 * @throws {ToolInputError} `invalid cursor` (a 400 on HTTP, a correctable input error for a tool).
 * @complexity O(cursor length).
 */
export function decodeListCursor(required: { cursor: string; size: number }, _optional: Record<string, never> = {}): ListPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(required.cursor));
  } catch {
    throw new ToolInputError({ message: 'invalid cursor: pass the nextCursor value from the previous page unchanged' });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== required.size ||
    !parsed.every((value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
  ) {
    throw new ToolInputError({ message: 'invalid cursor: pass the nextCursor value from the previous page unchanged' });
  }
  return parsed as ListPosition;
}

/**
 * Reads `{ limit, cursor }` off an untrusted request (query string or tool input). An absent limit
 * becomes the default; a limit above the ceiling is clamped (a caller asking for "everything" gets
 * the most one page holds plus a cursor, never an error); anything malformed is refused.
 *
 * @throws {ToolInputError} for a non-integer/non-positive limit or a non-string cursor.
 * @complexity O(1).
 */
export function parseListPageRequest(
  required: { value: { limit?: unknown; cursor?: unknown } },
  optional: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; cursor: string | null } {
  const maxLimit = optional.maxLimit ?? DEFAULT_MAX_LIST_LIMIT;
  const defaultLimit = Math.min(optional.defaultLimit ?? DEFAULT_LIST_LIMIT, maxLimit);
  const rawLimit = typeof required.value.limit === 'string' && /^\d+$/.test(required.value.limit) ? Number(required.value.limit) : required.value.limit;
  if (rawLimit !== undefined && (typeof rawLimit !== 'number' || !Number.isSafeInteger(rawLimit) || rawLimit < 1)) {
    throw new ToolInputError({ message: "'limit' must be a whole number of at least 1" });
  }
  const rawCursor = required.value.cursor;
  if (rawCursor !== undefined && rawCursor !== null && (typeof rawCursor !== 'string' || rawCursor.length === 0)) {
    throw new ToolInputError({ message: "'cursor' must be the nextCursor string from the previous page" });
  }
  return { limit: Math.min(rawLimit ?? defaultLimit, maxLimit), cursor: typeof rawCursor === 'string' ? rawCursor : null };
}

/**
 * Cuts a page from a query that fetched `limit + 1` rows in keyset order. The extra row only proves
 * more exist; it is never returned.
 *
 * @complexity O(limit).
 */
export function pageFromOverfetch<T>(
  required: { rows: readonly T[]; limit: number; positionOf: (row: T) => ListPosition },
  _optional: Record<string, never> = {},
): ListPage<T> {
  const items = required.rows.slice(0, required.limit);
  const last = items[items.length - 1];
  const hasMore = required.rows.length > required.limit;
  return { items, nextCursor: hasMore && last !== undefined ? encodeListCursor({ position: required.positionOf(last) }) : null };
}

function comparePositions(left: ListPosition, right: ListPosition): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
    return String(a) < String(b) ? -1 : 1;
  }
  return 0;
}

/**
 * The in-memory twin of a keyset query: sorts by position, keeps rows strictly after the cursor, and
 * cuts a page — so a memory repo and its SQL sibling answer the same contract test identically.
 * Ascending order only; a descending list negates or reverses its sort key in `positionOf`.
 *
 * @complexity O(n log n).
 */
export function pageFromArray<T>(
  required: { rows: readonly T[]; limit: number; cursor: string | null; positionOf: (row: T) => ListPosition },
  _optional: Record<string, never> = {},
): ListPage<T> {
  const sorted = [...required.rows].sort((a, b) => comparePositions(required.positionOf(a), required.positionOf(b)));
  const first = sorted[0];
  // An empty list has nothing after any cursor; there is no row to learn the position size from.
  if (first === undefined) return { items: [], nextCursor: null };
  let after = sorted;
  if (required.cursor !== null) {
    const marker = decodeListCursor({ cursor: required.cursor, size: required.positionOf(first).length });
    after = sorted.filter((row) => comparePositions(required.positionOf(row), marker) > 0);
  }
  return pageFromOverfetch({ rows: after.slice(0, required.limit + 1), limit: required.limit, positionOf: required.positionOf });
}

/**
 * What an assistant tool returns for a page: the items, the cursor, and — only when more exist — a
 * plain sentence telling the model the list is NOT complete and exactly how to continue. Without
 * that sentence a model reads 100 rows as "all members".
 *
 * @complexity O(1).
 */
export function listPageForModel<T>(
  required: { page: ListPage<T>; toolId: string },
  _optional: Record<string, never> = {},
): { items: readonly T[]; nextCursor: string | null; more?: string } {
  const { page } = required;
  if (page.nextCursor === null) return { items: page.items, nextCursor: null };
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    more:
      `This is NOT the full list: ${page.items.length} shown and more exist. ` +
      `To see the rest, call ${required.toolId} again with the same filters and cursor set to nextCursor. ` +
      'Do not tell the person this is everything.',
  };
}
