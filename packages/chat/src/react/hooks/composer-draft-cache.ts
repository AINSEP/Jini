/**
 * @module composer-draft-cache
 *
 * Per-conversation composer draft cache, keyed by conversation id. Exists so whatever the operator
 * was typing comes back — across a `ChatPane` remount (a host re-keying the pane on a conversation
 * switch, so a user-initiated switch re-seeds the transcript from `initialMessages` — a documented
 * pattern for this component: the pane owns its own transcript and takes no `conversationId`-change
 * effect of its own), across a navigation away and back, and across a full page reload or a server
 * restart that takes the page down with it. `useComposer.ts` reads/writes this on every
 * `conversationId` it is given, with zero host wiring required.
 *
 * Two tiers, same key:
 * - a module-level `Map`, which answers instantly and is the only tier that works when storage is
 *   unavailable;
 * - `localStorage` under {@link COMPOSER_DRAFT_STORAGE_PREFIX}, which is what actually survives a
 *   reload. Every access is wrapped: a private window, blocked site data, a quota rejection, or a
 *   non-browser runtime degrades this module to memory-only. It never throws at a caller and it
 *   never returns a wiped draft in place of a live one — a failed read falls back to the in-memory
 *   tier rather than reporting "no draft".
 *
 * Durability is deliberately NOT gated behind `ComposerDraftPersistence` (`useComposer`'s
 * host-supplied port). That port is a single opaque host-owned slot with no conversation key, and
 * grep across every known host finds nothing passing it — an opt-in seam nobody opted into would
 * not have fixed the reported bug (an operator lost a half-written message to a site-server
 * restart, 2026-09-18). The port still works and still takes precedence at mount for a host that
 * wires one.
 *
 * Scope limits worth knowing: `localStorage` is per-browser and per-origin, so a draft never
 * reaches the server, never follows the operator to another machine, and is visible to anything
 * else running on that origin. Two tabs open on the same conversation last-write-wins. None of
 * that is a regression — before this, the draft simply did not survive at all.
 *
 * @tradeoffs A module-level singleton (rather than a per-instance store a host constructs and
 * passes down) was chosen so the fix works for every host with no new prop plumbing. The risk a
 * singleton usually carries — two unrelated call sites sharing state that should be isolated (see
 * `create-daemon-attachment-uploader.ts`'s per-uploader `batchUsage` map, which exists for exactly
 * that reason) — does not apply the same way here: the partition key (`conversationId`) is already
 * globally unique per backend, so two `ChatPane` instances showing two different conversations can
 * never collide on it. Tests must call {@link __resetComposerDraftCacheForTests} between cases to
 * avoid cross-test leakage; that is the real cost of this choice.
 *
 * Both tiers are bounded to `MAX_CACHED_CONVERSATION_DRAFTS` distinct conversations so a long
 * session visiting many conversations cannot grow without limit — the oldest entry is evicted once
 * the cap is exceeded (insertion order in memory, stored timestamp in storage, since storage
 * outlives insertion order). A cleared/empty draft is deleted from both tiers outright rather than
 * kept as `''`, so the common case (drafted, then sent) leaves nothing behind to resurrect on the
 * next load.
 */

import type { ChatAttachment } from '../../core/index.js';

/** Cap on distinct conversations tracked at once, per tier; see the module doc's `@tradeoffs`. */
export const MAX_CACHED_CONVERSATION_DRAFTS = 50;

/**
 * Key prefix for the `localStorage` tier. Versioned (`.v1.`) so a future change to the stored shape
 * can be introduced without having to interpret, or mis-interpret, entries written by this one.
 */
export const COMPOSER_DRAFT_STORAGE_PREFIX = 'jini.chat.composer-draft.v1.';

/**
 * Key prefix for a conversation's staged attachment REFERENCES. Deliberately a separate entry from
 * the draft text rather than one combined record: text and attachments must degrade independently,
 * so a corrupt or unwritable attachment entry can never cost the operator their words, and vice
 * versa. See {@link readCachedAttachments} for what these references are and are not.
 */
export const COMPOSER_ATTACHMENTS_STORAGE_PREFIX = 'jini.chat.composer-attachments.v1.';

/** The stored shape. `t` is a write timestamp, used only to pick an eviction victim at the cap. */
interface StoredDraft {
  readonly v: 1;
  readonly t: number;
  readonly d: string;
}

/** The attachment entry's stored shape; `a` holds plain references, never file bytes. */
interface StoredAttachments {
  readonly v: 1;
  readonly t: number;
  readonly a: readonly ChatAttachment[];
}

const drafts = new Map<string, string>();
const stagedAttachments = new Map<string, readonly ChatAttachment[]>();

/**
 * The origin's `localStorage`, or `null` when it cannot be used.
 *
 * @returns `null` in a non-browser runtime (SSR, a node-environment test) and in a browser that
 * throws on the property access itself — Safari and Chrome both do that with site data blocked,
 * which is why this is a try/catch rather than a `typeof` check alone.
 * @complexity Time/space: O(1).
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads and validates the stored draft for `conversationId`.
 *
 * Anything that does not parse as this module's own envelope is treated as foreign or corrupt and
 * deleted rather than returned — a stale format, another tool writing under a colliding key, or a
 * truncated write must not surface as composer text.
 *
 * @returns The stored draft, or `null` when there is none, storage is unavailable, or the entry
 * failed validation.
 * @complexity Time/space: O(n) in the stored draft's length (the JSON parse).
 */
function readStoredDraft(conversationId: string): string | null {
  const store = storage();
  if (!store) return null;
  const key = `${COMPOSER_DRAFT_STORAGE_PREFIX}${conversationId}`;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const draft = (parsed as StoredDraft | null)?.d;
    if (typeof draft !== 'string' || draft === '') {
      store.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    // A parse failure leaves the bad entry behind on purpose when `removeItem` is what threw —
    // there is nothing further this module can do, and memory-only is still a working composer.
    try {
      store.removeItem(key);
    } catch {
      /* storage is unusable; the in-memory tier still serves this conversation */
    }
    return null;
  }
}

/**
 * Deletes every stored draft past the cap, oldest write first, so an operator who abandons drafts
 * in many conversations cannot fill the origin's quota and silently break persistence for the
 * conversation they actually care about.
 *
 * @param keep How many entries may remain. Entries whose envelope does not parse are treated as
 * oldest (timestamp `0`) so corrupt rows are the first to go.
 * @complexity Time O(n log n) in the number of this module's stored keys (a sort), bounded in
 * practice by `MAX_CACHED_CONVERSATION_DRAFTS` plus whatever a previous session left behind. Space
 * O(n) in the same.
 */
function pruneStored(prefix: string, keep: number): void {
  const store = storage();
  if (!store) return;
  try {
    const entries: { key: string; at: number }[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key === null || !key.startsWith(prefix)) continue;
      let at = 0;
      try {
        const parsed = JSON.parse(store.getItem(key) ?? '') as { t?: unknown } | null;
        at = typeof parsed?.t === 'number' ? parsed.t : 0;
      } catch {
        at = 0;
      }
      entries.push({ key, at });
    }
    if (entries.length <= keep) return;
    entries.sort((a, b) => a.at - b.at);
    for (const entry of entries.slice(0, entries.length - keep)) store.removeItem(entry.key);
  } catch {
    /* storage is unusable; nothing to prune and nothing to report */
  }
}

/**
 * Writes or removes the stored copy for `conversationId`.
 *
 * @param draft A blank draft removes the entry. A quota rejection is swallowed: the in-memory tier
 * has already accepted the draft, so the composer keeps working and only reload-survival is lost.
 * @complexity Time O(n) in the draft's length, plus a prune (see {@link pruneStored}) only
 * when this introduces a new key at the cap. Space O(n) in the draft's length.
 */
function writeStoredDraft(conversationId: string, draft: string): void {
  const store = storage();
  if (!store) return;
  const key = `${COMPOSER_DRAFT_STORAGE_PREFIX}${conversationId}`;
  try {
    if (draft === '') {
      store.removeItem(key);
      return;
    }
    if (store.getItem(key) === null) pruneStored(COMPOSER_DRAFT_STORAGE_PREFIX, MAX_CACHED_CONVERSATION_DRAFTS - 1);
    const envelope: StoredDraft = { v: 1, t: Date.now(), d: draft };
    store.setItem(key, JSON.stringify(envelope));
  } catch {
    /* blocked, full, or unusable storage — memory-only is the documented degraded mode */
  }
}

/**
 * Records `draft` in the in-memory tier, evicting the oldest-inserted conversation first if this
 * would introduce a new entry past {@link MAX_CACHED_CONVERSATION_DRAFTS}.
 * @complexity Time/space: O(1) amortized.
 */
function rememberInMemory(conversationId: string, draft: string): void {
  if (!drafts.has(conversationId) && drafts.size >= MAX_CACHED_CONVERSATION_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
  drafts.set(conversationId, draft);
}

/**
 * Reads the cached draft for `conversationId`, in memory first and storage second.
 *
 * A storage hit is promoted into memory so the reload-survival path costs one read, not one per
 * keystroke-triggered re-render.
 *
 * @returns The cached draft, or `null` when there is none — including when `conversationId` itself
 * is absent (an untitled/new conversation has nothing to key on yet). Never returns `''`; callers
 * treat `null` as "nothing to restore".
 * @complexity Time/space: O(1) on an in-memory hit, O(n) in the stored draft's length otherwise.
 */
export function readCachedDraft(conversationId: string | null | undefined): string | null {
  if (!conversationId) return null;
  const remembered = drafts.get(conversationId);
  if (remembered !== undefined) return remembered;
  const stored = readStoredDraft(conversationId);
  if (stored === null) return null;
  rememberInMemory(conversationId, stored);
  return stored;
}

/**
 * Stores `draft` for `conversationId` in both tiers.
 *
 * @param conversationId No-ops when absent (`null`/`undefined`) — there is nothing to key on yet.
 * `useComposer` covers that window by adopting the typed text once an id arrives; see its own doc.
 * @param draft A blank (or whitespace-only) draft deletes the entry from both tiers instead of
 * storing `''`. This is what makes a successful send clear the draft for free: `useComposer.reset`
 * writes `''` here.
 * @complexity Time/space: O(n) in the draft's length; see {@link writeStoredDraft}.
 */
export function writeCachedDraft(conversationId: string | null | undefined, draft: string): void {
  if (!conversationId) return;
  if (draft.trim() === '') {
    drafts.delete(conversationId);
    writeStoredDraft(conversationId, '');
    return;
  }
  rememberInMemory(conversationId, draft);
  writeStoredDraft(conversationId, draft);
}

/**
 * Explicitly evicts `conversationId`'s draft from both tiers, for a host that wants to free it
 * immediately (e.g. on conversation delete) rather than waiting for the cap-triggered eviction.
 * Not currently called by any host — a host's own conversation-delete flow is a candidate
 * follow-up caller, out of scope here (that flow lives outside this package).
 * @complexity Time/space: O(1).
 */
export function clearCachedDraft(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  drafts.delete(conversationId);
  writeStoredDraft(conversationId, '');
  writeCachedAttachments(conversationId, []);
}

/**
 * Narrows one parsed array element to a `ChatAttachment`.
 *
 * Validated field by field rather than trusted, for the same reason the draft envelope is: this
 * data came back from storage, where anything on the origin could have written it. `size`/`order`
 * are optional in the type, so they are checked only when present.
 * @complexity Time/space: O(1).
 */
function isChatAttachment(candidate: unknown): candidate is ChatAttachment {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { path, name, kind, size, order } = candidate as Record<string, unknown>;
  if (typeof path !== 'string' || path === '') return false;
  if (typeof name !== 'string') return false;
  if (kind !== 'image' && kind !== 'file') return false;
  if (size !== undefined && typeof size !== 'number') return false;
  if (order !== undefined && typeof order !== 'number') return false;
  return true;
}

/**
 * Reads the stored attachment references for `conversationId`.
 *
 * Elements that do not validate are dropped individually rather than failing the whole entry — one
 * malformed row should cost the operator that row, not every attachment on the turn.
 *
 * @returns The stored references, or `null` when there are none, storage is unavailable, or nothing
 * in the entry validated.
 * @complexity Time/space: O(n) in the number of stored references.
 */
function readStoredAttachments(conversationId: string): readonly ChatAttachment[] | null {
  const store = storage();
  if (!store) return null;
  const key = `${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}${conversationId}`;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as StoredAttachments | null)?.a;
    if (!Array.isArray(list)) {
      store.removeItem(key);
      return null;
    }
    const valid = list.filter(isChatAttachment);
    if (valid.length === 0) {
      store.removeItem(key);
      return null;
    }
    return valid;
  } catch {
    try {
      store.removeItem(key);
    } catch {
      /* storage is unusable; the in-memory tier still serves this conversation */
    }
    return null;
  }
}

/**
 * Reads the cached attachment references for `conversationId`, in memory first, storage second.
 *
 * **These are references, never bytes.** By the time an attachment reaches the composer it has
 * already been uploaded (`ChatPane` blocks sending while uploads are in flight), so what is cached
 * here is the server-side record — a path, a name, a kind. The file itself lives wherever the host
 * put it and is subject to that host's retention, which is why a caller must not treat a returned
 * reference as proof the file still exists. `useComposer` restores these only when the host supplies
 * a validator; see its `validateAttachments` option.
 *
 * @returns The cached references, or `null` when there are none.
 * @complexity Time/space: O(1) on an in-memory hit, O(n) in the stored count otherwise.
 */
export function readCachedAttachments(
  conversationId: string | null | undefined,
): readonly ChatAttachment[] | null {
  if (!conversationId) return null;
  const remembered = stagedAttachments.get(conversationId);
  if (remembered !== undefined) return remembered;
  const stored = readStoredAttachments(conversationId);
  if (stored === null) return null;
  stagedAttachments.set(conversationId, stored);
  return stored;
}

/**
 * Stores `attachments` for `conversationId` in both tiers.
 *
 * @param attachments An empty list deletes the entry, so a sent or cleared turn leaves nothing to
 * restore — the same rule the draft text follows.
 * @complexity Time/space: O(n) in the number of references.
 */
export function writeCachedAttachments(
  conversationId: string | null | undefined,
  attachments: readonly ChatAttachment[],
): void {
  if (!conversationId) return;
  const key = `${COMPOSER_ATTACHMENTS_STORAGE_PREFIX}${conversationId}`;
  const store = storage();
  if (attachments.length === 0) {
    stagedAttachments.delete(conversationId);
    try {
      store?.removeItem(key);
    } catch {
      /* blocked storage; the in-memory tier is already correct */
    }
    return;
  }
  if (!stagedAttachments.has(conversationId) && stagedAttachments.size >= MAX_CACHED_CONVERSATION_DRAFTS) {
    const oldest = stagedAttachments.keys().next().value;
    if (oldest !== undefined) stagedAttachments.delete(oldest);
  }
  stagedAttachments.set(conversationId, attachments);
  if (!store) return;
  try {
    if (store.getItem(key) === null) pruneStored(COMPOSER_ATTACHMENTS_STORAGE_PREFIX, MAX_CACHED_CONVERSATION_DRAFTS - 1);
    const envelope: StoredAttachments = { v: 1, t: Date.now(), a: attachments };
    store.setItem(key, JSON.stringify(envelope));
  } catch {
    /* blocked, full, or unusable storage — memory-only is the documented degraded mode */
  }
}

/**
 * Test-only: empties the cache so test cases cannot leak drafts into each other.
 *
 * @param options `keepStorage: true` empties only the in-memory tier, leaving `localStorage`
 * intact. That is the honest simulation of a page reload — fresh module scope, storage that
 * outlived it — and is how the durability tests reproduce the bug this module exists to fix.
 * @complexity Time O(n) in the number of this module's stored keys; space O(n) in the same.
 */
export function __resetComposerDraftCacheForTests(options?: { readonly keepStorage?: boolean }): void {
  drafts.clear();
  stagedAttachments.clear();
  if (options?.keepStorage === true) return;
  pruneStored(COMPOSER_DRAFT_STORAGE_PREFIX, 0);
  pruneStored(COMPOSER_ATTACHMENTS_STORAGE_PREFIX, 0);
}
