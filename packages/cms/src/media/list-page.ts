import { ToolInputError } from '@jini-ai/core';
import { decodeKeysetCursor, encodeKeysetCursor, type KeysetPosition } from '../core/keyset-cursor.js';
import type { MediaRepoPort } from './ports.js';
import type { MediaRecord } from './types.js';

export interface MediaListTypeStore {
  getMany(required: { workspaceId: string; sha256s: readonly string[] }): Promise<ReadonlyMap<string, string>>;
}
const KINDS = ['media', 'image', 'video', 'audio', 'document', 'other'];

/** Validate tool bounds before storage reads. @throws ToolInputError for invalid filters/paging.
 * @complexity O(query + cursor length). */
function listOptions({ input }: { input: Record<string, unknown> }, _options = {}) {
  const { query = '', kind, limit = 50, cursor } = input;
  const normalizedQuery = normalizeQuery({ query });
  if (kind !== undefined && !KINDS.includes(kind as string)) throw new ToolInputError({ message: `kind must be ${KINDS.join('|')}` });
  if (cursor !== undefined && typeof cursor !== 'string') throw new ToolInputError({ message: 'cursor must be a string' });
  return {
    query: normalizedQuery, kind: kind as string | undefined, limit: pageLimit({ limit }),
    after: cursor === undefined ? undefined : decodeKeysetCursor({ cursor })
  };
}

/** Bound search text before storage reads, independently of pagination filters. */
function normalizeQuery({ query }: { query: unknown }, _options = {}): string {
  if (typeof query !== 'string' || query.length > 1000) throw new ToolInputError({ message: 'query must be a string of at most 1000 characters' });
  return query.toLowerCase();
}

/** Keep runtime paging validation identical to the published schema. */
function pageLimit({ limit }: { limit: unknown }, _options = {}): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolInputError({ message: 'limit must be an integer from 1 to 100' });
  return limit;
}

/** Classify using the persisted sniff or the host's existing legacy MIME store, without blob I/O. */
function matchesKind({ row, kind, types }: { row: MediaRecord; kind: string | undefined; types: ReadonlyMap<string, string> }, _options = {}): boolean {
  if (!kind) return true;
  if (kind === 'document') return row.kind === 'document';
  if (row.kind === 'document') return false;
  if (kind === 'media') return true;
  const family = (types.get(row.source.sha256) ?? row.source.contentType ?? '').split('/')[0]!;
  return kind === 'other' ? !['image', 'video', 'audio'].includes(family) : family === kind;
}

/** Ascending total order, including tied timestamps; the cursor does not depend on row existence. */
function comparePosition(a: KeysetPosition, b: KeysetPosition): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Shared Media/Library page owner. Library remains private documents only and active only.
 * @returns A bounded page and nextCursor, null when exhausted. Storage failures propagate.
 * @complexity O(n log n) time/O(n) memory for n workspace rows: the existing repository exposes
 * a whole-workspace list. Only the selected page incurs URL/size lookups; no blob bytes are read.
 */
export async function listMediaPage(required: {
  mediaRepo: MediaRepoPort; workspaceId: string; input: Record<string, unknown>; library: boolean;
}, optional: { contentTypes?: MediaListTypeStore | undefined } = {}): Promise<{ media: MediaRecord[]; nextCursor: string | null }> {
  const options = listOptions({ input: required.input });
  const rows = await required.mediaRepo.list({ workspaceId: required.workspaceId });
  const types = optional.contentTypes && options.kind
    ? await optional.contentTypes.getMany({ workspaceId: required.workspaceId, sha256s: [...new Set(rows.map(row => row.source.sha256))] })
    : new Map<string, string>();
  const scope = required.library || options.kind === 'document' ? 'document' : 'media';
  const matching = rows.filter(row => (row.kind ?? 'media') === scope)
    .filter(row => !required.library || row.status === 'active')
    .filter(row => matchesKind({ row, kind: options.kind, types }))
    .filter(row => [row.title, row.alt, row.originalFilename ?? '', row.slug].some(text => text.toLowerCase().includes(options.query)))
    .filter(row => !options.after || comparePosition(row, options.after) > 0)
    .sort(comparePosition);
  const media = matching.slice(0, options.limit);
  return { media, nextCursor: continuation({ matching, media }) };
}

/** Never advertise a continuation for an exhausted or empty result set. */
function continuation({ matching, media }: { matching: MediaRecord[]; media: MediaRecord[] }, _options = {}): string | null {
  const last = media.at(-1);
  return matching.length > media.length && last ? encodeKeysetCursor(last) : null;
}
