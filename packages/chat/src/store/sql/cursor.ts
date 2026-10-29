import { trimCharsEnd } from '@jini-ai/core/primitives';
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
  return trimCharsEnd({ text: btoa(binary).replaceAll('+', '-').replaceAll('/', '_'), chars: '=' });
}

/** Every structural failure is the same refusal; callers never learn which check rejected it. */
function invalidCursor(): never {
  throw new ChatStoreError({ code: 'invalid-cursor' });
}

/** Shape check before decoding: a non-empty, bounded base64url string. Carries no cause. */
function assertCursorText({ cursor }: { cursor: string }): void {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) invalidCursor();
}

/** base64url -> strict UTF-8 -> JSON; any decode failure is wrapped with its cause attached. */
function decodeBody({ cursor }: { cursor: string }): unknown {
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  catch (cause) { throw new ChatStoreError({ code: 'invalid-cursor' }, { cause }); }
}

/** Version, exact length, read kind and conversation binding. */
function readEnvelope({ value, kind, conversation }: { value: unknown; kind: ReadKind; conversation: string | null }): unknown[] {
  if (!Array.isArray(value) || value.length !== 5) invalidCursor();
  if (value[0] !== 1 || value[1] !== kind || value[3] !== conversation) invalidCursor();
  return value;
}

/** The cursor must carry exactly this scope's owner tuple. */
function assertOwner({ owner, scope }: { owner: unknown; scope: ChatOwnerScope }): void {
  const expected = ownerTuple(scope);
  if (!Array.isArray(owner) || owner.length !== 3 || owner.some((part, i) => part !== expected[i])) invalidCursor();
}

/** A [finite number, string] pair; message positions must also be non-negative safe integers. */
function readAnchor({ anchor, kind }: { anchor: unknown; kind: ReadKind }): Anchor {
  if (!Array.isArray(anchor) || anchor.length !== 2) invalidCursor();
  if (typeof anchor[0] !== 'number' || !Number.isFinite(anchor[0]) || typeof anchor[1] !== 'string') {
    invalidCursor();
  }
  if (kind === 'messages' && (!Number.isSafeInteger(anchor[0]) || anchor[0] < 0)) invalidCursor();
  return [anchor[0], anchor[1]];
}

/** Validate version, exact structure, scope and read bindings before a query can run. */
export function decodeCursor({ cursor, kind, scope, conversation }: { cursor: string | undefined; kind: ReadKind; scope: ChatOwnerScope; conversation: string | null }): Anchor | undefined {
  if (cursor === undefined) return undefined;
  assertCursorText({ cursor });
  const envelope = readEnvelope({ value: decodeBody({ cursor }), kind, conversation });
  assertOwner({ owner: envelope[2], scope });
  return readAnchor({ anchor: envelope[4], kind });
}
