/**
 * @module session
 *
 * `VibecodingSession` — the framework-free stateful object over
 * `./core`'s `EditTarget` + `EditHistory`. Everything else in `./react` (the hook, the tool
 * registrations, the presentational components) reads and drives an artifact through this seam
 * rather than touching `EditTarget`/`EditHistory` directly, for one reason: a tool call arrives
 * from the chat's execution path, not from a React event handler, so the thing tool handlers call
 * into cannot be React state — it has to be a plain, subscribable object a `useSyncExternalStore`
 * hook can also read. This module is React-free and exported with the tools from `./session`.
 *
 * ## Why part content is cached rather than re-read on every render
 *
 * `EditTarget.readPart` is a host call — for the `html` target it is cheap (a string slice), but
 * the port makes no such promise for every target (a filesystem or sandbox-backed host could hit a
 * network round trip per part). Re-reading every listed part's content on every `refresh()` would
 * turn "the operator opened the file viewer" into an O(part count) fan-out of host calls, and
 * nothing here can assume that count stays small — see `./target.ts`'s own doc on why
 * `listParts` is the allowlist, not a bound on its size. So `refresh()` only calls `listParts()`;
 * content is fetched lazily, per id, through `readPart()`, and cached. Every mutating operation
 * below (`applyEdits`, `undo`, `redo`, `restoreSnapshot`) in a default session knows the exact before/after
 * content it just wrote — `./apply.ts`'s `ProposedEdit`, `./history.ts`'s
 * `PartChange.before`/`.after` — so the cache is updated from that data directly instead of
 * re-reading the part it just wrote back from the host. Project sessions clear caches instead:
 * their history entries hold revision pointers, and external tools may have changed file bytes.
 */
import type { ApplyOutcome, PartId, PartRef, Snapshot } from './types.js';
import type { EditTarget } from './target.js';
import { applyEdits as applyEditsToTarget, correctionsFor, type ProposedEdit } from './apply.js';
import { createEditHistory, type EditHistory, type EditHistoryOptions, type HistoryEntry, type PartChange } from './history.js';

export interface VibecodingSessionArgs {
  /** The host's artifact port. See `./target.ts`. */
  readonly target: EditTarget;
}

export interface VibecodingSessionOptions {
  /** Forwarded to `createEditHistory`. See `./history.ts`'s `EditHistoryOptions`. */
  readonly historyOptions?: EditHistoryOptions;
  /** A project supplies its guarded pointer history instead of a per-file stack. */
  readonly history?: EditHistory;
  /** Whole-turn mutation; owns its history recording and returns aligned outcomes. */
  readonly applyTurn?: (
    input: { readonly edits: readonly ProposedEdit[] },
    options?: { readonly label?: string },
  ) => Promise<readonly ApplyOutcome[]>;
}

/**
 * Immutable, point-in-time read of a session. `getSnapshot()` returns the same object reference
 * until something actually changes — required for `useSyncExternalStore`, which re-renders a
 * subscriber whenever the reference it reads changes, not whenever it is merely called again.
 */
export interface VibecodingSessionSnapshot {
  /** `'idle'` until the first `refresh()` resolves; `'error'` reflects the most recent failure, not
   *  a permanently wedged session — a subsequent successful call returns it to `'ready'`. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Every part the host currently advertises, in `EditTarget.listParts()`'s own order. */
  readonly parts: readonly PartRef[];
  /** Cached content, keyed by part id. A part absent from this map has not been read yet — see
   *  this module's doc for why content is lazy rather than eagerly fetched for every part. */
  readonly partContent: ReadonlyMap<PartId, string>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The most recent operation's failure message, if any. Cleared by the next successful call. */
  readonly lastError: string | undefined;
}

export interface ApplyEditsResult {
  readonly outcomes: readonly ApplyOutcome[];
  /** See `./apply.ts`'s `correctionsFor` — the subset a caller feeds back to the model. */
  readonly corrections: readonly { readonly id: PartId; readonly reason: string }[];
}

export interface VibecodingSession {
  /** The underlying port, for a caller (or test) that needs it directly — e.g. to read the whole
   *  document a host-specific target stores, which is outside this generic session's vocabulary. */
  readonly target: EditTarget;
  /** The underlying undo/redo stack, for a caller that needs `.entries()` for a history UI. */
  readonly history: EditHistory;
  getSnapshot(): VibecodingSessionSnapshot;
  /** Returns an unsubscribe function; the React hook adapts this object API for React. */
  subscribe(args: { readonly listener: () => void }): () => void;
  /** Re-lists parts from the host. Does not re-read content — see this module's doc. */
  refresh(): Promise<void>;
  /** Cached content for `id`, fetching once from the host on first request. */
  readPart(args: { readonly id: PartId }): Promise<string>;
  /** Applies `edits` as one undoable transaction and updates the cache from the edits themselves. */
  applyEdits(
    requiredArgs: { readonly edits: readonly ProposedEdit[] },
    optionalArgs?: { readonly label?: string },
  ): Promise<ApplyEditsResult>;
  undo(): Promise<HistoryEntry | null>;
  redo(): Promise<HistoryEntry | null>;
  takeSnapshot(): Promise<Snapshot>;
  restoreSnapshot(args: { readonly snapshot: Snapshot }): Promise<HistoryEntry | null>;
}

const READY_ERROR = undefined;

/**
 * Builds a session over `target`, with private history by default or injected project history.
 * Injected applyTurn owns whole-turn recording; this session owns notifications and cache invalidation.
 *
 * The returned session starts in `'idle'` with no parts listed — call `refresh()` (or let
 * `useVibecodingSession` do it on mount) to populate it. Nothing here triggers I/O eagerly, so
 * constructing a session has no side effect a caller needs to clean up.
 *
 * @complexity Construction is O(1). See each method for its own cost.
 */
export function createVibecodingSession(
  { target }: VibecodingSessionArgs,
  options: VibecodingSessionOptions = {},
): VibecodingSession {
  const history = options.history ?? createEditHistory({ target }, options.historyOptions);
  // Project turns write through revision pointers, so cached part content is never reusable after them.
  const applyTurn = options.applyTurn;
  const listeners = new Set<() => void>();

  const partContent = new Map<PartId, string>();
  let current: VibecodingSessionSnapshot = {
    status: 'idle',
    parts: [],
    partContent,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    lastError: READY_ERROR,
  };

  /** Replaces `current` with a fresh object carrying `patch`, then notifies subscribers. A fresh
   *  `partContent` Map reference is handed out only when the map's contents actually changed
   *  (callers pass a new Map in `patch` for that case); reusing the same Map reference otherwise
   *  is what keeps an unrelated status change (e.g. `'loading'` -> `'ready'`) from invalidating a
   *  component's memoized read of `partContent`. */
  function commit(patch: Partial<VibecodingSessionSnapshot>): void {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  }

  /**
   * Runs `work`, tagging the session `'loading'` -> `'ready'`/`'error'` and always returning
   * control to the caller — a rejection is recorded as `lastError` AND rethrown, so a component
   * can render `lastError` passively while a tool handler that needs to fail loudly still can.
   *
   * `work` returns its data `patch` alongside its `result` rather than calling `commit` itself, so
   * the success path here can fold that patch into the SAME commit as the `'ready'` status
   * transition — one notification per operation instead of two, which matters to a
   * `useSyncExternalStore` subscriber re-rendering on every commit.
   */
  async function run<T>(work: () => Promise<{ result: T; patch: Partial<VibecodingSessionSnapshot> }>): Promise<T> {
    commit({ status: 'loading' });
    try {
      const { result, patch } = await work();
      commit({ ...patch, status: 'ready', lastError: READY_ERROR });
      return result;
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      if (applyTurn) partContent.clear();
      commit({ status: 'error', lastError: message, partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() });
      throw thrown;
    }
  }

  /** Mirrors a replayed change in the cache. Undoing creation keeps empty content because the
   *  target's upsert port has no delete operation; see `./history.ts`. */
  function cacheChange(change: PartChange, side: 'after' | 'before'): void {
    partContent.set(change.id, side === 'after' ? change.after : change.before);
  }

  /** Mirrors a recorded snapshot restore in the cache and re-reads the part list it may have grown. */
  async function restoredPatch(entry: HistoryEntry): Promise<Partial<VibecodingSessionSnapshot>> {
    if (applyTurn) partContent.clear();
    else for (const change of entry.changes) cacheChange(change, 'after');
    const parts = await target.listParts();
    return { parts, partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() };
  }

  return {
    target,
    history,

    getSnapshot: () => current,

    subscribe({ listener }) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    refresh: () =>
      run(async () => {
        const parts = await target.listParts();
        if (applyTurn) partContent.clear();
        const known = new Set(parts.map((p) => p.id));
        // Drop cached content for parts the host no longer lists — stale content for an
        // unaddressable id would otherwise linger forever with nothing to invalidate it.
        for (const id of partContent.keys()) if (!known.has(id)) partContent.delete(id);
        return {
          result: undefined,
          patch: { parts, partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() },
        };
      }),

    readPart: ({ id }) =>
      run(async () => {
        const cached = applyTurn ? undefined : partContent.get(id);
        if (cached !== undefined) return { result: cached, patch: {} };
        if (applyTurn) partContent.clear();
        const content = await target.readPart({ id });
        partContent.set(id, content);
        return { result: content, patch: { partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() } };
      }),

    applyEdits: ({ edits }, options = {}) =>
      run(async () => {
        const outcomes = await (applyTurn
          ? applyTurn({ edits }, options)
          : history.transaction(
              { work: (recording) => applyEditsToTarget({ target: recording, edits }) }, options,
            ));
        if (applyTurn) partContent.clear();
        // Outcomes are aligned with proposals, including repeated ids. Matching only by id
        // would cache the first proposal instead of the last successful write for that part.
        // This pass is O(edits.length), with no additional reads through the target port.
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status !== 'applied') continue;
          const edit = edits[index];
          if (edit && !applyTurn) partContent.set(edit.id, edit.content);
        }
        const parts = await target.listParts();
        return {
          result: { outcomes, corrections: correctionsFor({ outcomes }) },
          patch: {
            parts,
            partContent: new Map(partContent),
            canUndo: history.canUndo(),
            canRedo: history.canRedo(),
          },
        };
      }),

    undo: () =>
      run(async () => {
        const entry = await history.undo();
        if (!entry) return { result: entry, patch: {} };
        // Undo replays in reverse order. Repeated ids must leave the earliest before value
        // cached, matching what history wrote to the target.
        if (applyTurn) partContent.clear();
        else for (const change of [...entry.changes].reverse()) cacheChange(change, 'before');
        const parts = applyTurn ? await target.listParts() : current.parts;
        return {
          result: entry,
          patch: { parts, partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() },
        };
      }),

    redo: () =>
      run(async () => {
        const entry = await history.redo();
        if (!entry) return { result: entry, patch: {} };
        if (applyTurn) partContent.clear();
        else for (const change of entry.changes) cacheChange(change, 'after');
        const parts = applyTurn ? await target.listParts() : current.parts;
        return {
          result: entry,
          patch: { parts, partContent: new Map(partContent), canUndo: history.canUndo(), canRedo: history.canRedo() },
        };
      }),

    takeSnapshot: () => run(async () => ({ result: await target.snapshot(), patch: {} })),

    restoreSnapshot: ({ snapshot }) =>
      run(async () => {
        const entry = await history.restore({ snapshot });
        // A restore that already matched records no entry and changes nothing to mirror.
        return { result: entry, patch: entry ? await restoredPatch(entry) : {} };
      }),
  };
}

