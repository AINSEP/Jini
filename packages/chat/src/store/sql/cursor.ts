/** Versioned keyset continuations. Encoding grants no authority; all queries remain scoped. */
import type { ChatOwnerScope, ChatPageOptions } from '../ports.js';
import { ChatStoreError } from '../errors.js';

type ReadKind = 'conversations' | 'messages';
export type Anchor = readonly [number, string];

/** Reject bad limits before accessing any storage. */
export function pageLimit({ options }: { options: ChatPageOptions | undefined }): number {
  const limit = options?.limit === undefined ? 50 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ChatStoreError({ code: 'invalid-input' });
  return limit;
}

/** Scope binding uses the host's already-hashed guest ID, never a bearer token. */
function ownerTuple(scope: ChatOwnerScope): readonly string[] {
  return [scope.scopeId, scope.ownerKind, scope.ownerId];
}

/** UTF-8/base64url preserves arbitrary opaque IDs; cursors represent live views, not snapshots. */
export function encodeCursor({ kind, scope, conversation, anchor }: { kind: ReadKind; scope: ChatOwnerScope; conversation: string | null; anchor: Anchor }): string {
  const bytes = new TextEncoder().encode(JSON.stringify([1, kind, ownerTuple(scope), conversation, anchor]));
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Validate version, exact structure, scope and read bindings before a query can run. */
export function decodeCursor({ cursor, kind, scope, conversation }: { cursor: string | undefined; kind: ReadKind; scope: ChatOwnerScope; conversation: string | null }): Anchor | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new ChatStoreError({ code: 'invalid-cursor' });
  }
  let value: unknown;
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  catch (cause) { throw new ChatStoreError({ code: 'invalid-cursor' }, { cause }); }
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== 1 || value[1] !== kind || value[3] !== conversation) {
    throw new ChatStoreError({ code: 'invalid-cursor' });
  }
  const owner = value[2], anchor = value[4];
  if (!Array.isArray(owner) || owner.length !== 3 || owner.some((part, i) => part !== ownerTuple(scope)[i])) {
    throw new ChatStoreError({ code: 'invalid-cursor' });
  }
  if (!Array.isArray(anchor) || anchor.length !== 2 || typeof anchor[0] !== 'number' || !Number.isFinite(anchor[0]) || typeof anchor[1] !== 'string') {
    throw new ChatStoreError({ code: 'invalid-cursor' });
  }
  if (kind === 'messages' && (!Number.isSafeInteger(anchor[0]) || anchor[0] < 0)) throw new ChatStoreError({ code: 'invalid-cursor' });
  return [anchor[0], anchor[1]];
}
