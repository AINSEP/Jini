/**
 * @module core/history
 *
 * Operation-level undo and redo, layered strictly **on top of** `EditTarget` — it adds no verb to
 * that port. A history records the before/after content of every part a transaction touched, which
 * it learns by calling `readPart` immediately before each `replacePart`. Nothing here needs the
 * host to implement anything new.
 *
 * ## Why this tier exists at all, given `snapshot`/`restore`
 *
 * `snapshot`/`restore` is a whole-artifact rewind: it answers "put everything back the way it was."
 * It cannot answer "undo the last thing," which is the operation a person actually reaches for, and
 * it has no notion of redo. One shipped builder has exactly this gap — a rewind-to-snapshot feature
 * and no undo stack at all, so stepping back one edit means stepping back every edit since the last
 * capture. A second builder has both tiers, with transaction batching, and is the better model.
 *
 * ## Three decisions worth stating, because each could reasonably have gone the other way
 *
 * 1. **Undo and redo bypass `validate`.** `validate` judges a candidate against the whole
 *    prospective artifact (see `./target.ts`). Rewinding a transaction that touched three parts
 *    necessarily passes through two intermediate states that never existed as committed states, and
 *    validating those would reject a legitimate rewind — a half-restored document is exactly the
 *    kind of thing `validate` is built to refuse. The state being restored was already committed
 *    once, so it needs no second opinion. Applying a *new* edit still goes through `applyEdit`, and
 *    that path is unchanged.
 *
 * 2. **A rewind is itself undoable, and so is a snapshot restore.** `restore` below diffs the
 *    target snapshot against current content and records the result as an ordinary transaction, so
 *    the two tiers share one stack and a mis-aimed rewind is recoverable. Borrowed deliberately:
 *    the alternative — a restore that silently discards whatever it overwrote — turns the safety
 *    feature into the most destructive button in the product.
 *
 * 3. **A transaction that throws still commits its partial entry, then rethrows.** Whatever reached
 *    the artifact before the throw is real, and the only thing worse than a partial write is a
 *    partial write nobody can undo. Note that `applyEdits` does not throw — it returns `failed`
 *    outcomes — so this path is genuinely exceptional rather than routine.
 *
 * ## The one thing this tier cannot do
 *
 * `replacePart` is an upsert, and `EditTarget` deliberately has no delete verb, so **undoing the
 * creation of a part cannot remove it** — the best available inverse is writing empty content back.
 * Each change records `existedBefore` so a host that *can* delete may consult the entry and finish
 * the job properly. Pretending otherwise would be the more dangerous choice: a caller would believe
 * a part had gone away while it was still listed and still readable.
 */
import type { EditTarget } from "./target.js";
import type { PartId, Snapshot } from "./types.js";

/** What one part looked like before and after a single transaction touched it. */
export interface PartChange {
  readonly id: PartId;
  /** Content prior to the change. Empty when the part did not exist — see `existedBefore`. */
  readonly before: string;
  /** Content written by the change. */
  readonly after: string;
  /**
   * Whether the part existed before this change.
   *
   * `false` means the transaction created it, and undo therefore cannot fully invert it — see this
   * module's doc. A host with its own delete capability can use this flag to do better.
   */
  readonly existedBefore: boolean;
}

/** One undoable step: every part change a single transaction produced, in the order applied. */
export interface HistoryEntry {
  /** Optional caller-supplied description, e.g. the model turn that produced it. Untrusted text. */
  readonly label?: string;
  /** Part changes in application order. Undo replays these in reverse. */
  readonly changes: readonly PartChange[];
}

/** Tuning for `createEditHistory`. */
export interface EditHistoryOptions {
  /**
   * Maximum number of undoable entries retained. Oldest are dropped first.
   *
   * Bounded because every entry holds full copies of the content it touched, so an unbounded stack
   * in a long authoring session grows with total bytes written rather than with artifact size.
   * Defaults to 50.
   */
  readonly limit?: number;
}

/** An operation-level undo/redo stack over one `EditTarget`. */
export interface EditHistory {
  /**
   * Run `work` against a recording view of the target, committing everything it changed as one
   * undoable entry.
   *
   * The target handed to `work` is a transparent wrapper: pass it to `applyEdit`/`applyEdits`
   * exactly as you would the real one. Grouping is what makes a multi-part model turn undo as a
   * single step rather than as N unrelated ones.
   *
   * A transaction that changes nothing records nothing, so a rejected model turn leaves no empty
   * step for a user to click past. Committing also clears the redo stack, which is the standard
   * rule: once you branch off the redo path, the abandoned future is no longer reachable.
   */
  transaction<T>(work: (recording: EditTarget) => Promise<T>, label?: string): Promise<T>;

  /** Whether `undo` would do anything. */
  canUndo(): boolean;

  /** Whether `redo` would do anything. */
  canRedo(): boolean;

  /**
   * Revert the most recent entry, writing each part's `before` content in reverse order.
   *
   * @returns the entry that was reverted, or `null` when there is nothing to undo.
   */
  undo(): Promise<HistoryEntry | null>;

  /**
   * Re-apply the most recently undone entry, writing each part's `after` content in order.
   *
   * @returns the entry that was re-applied, or `null` when there is nothing to redo.
   */
  redo(): Promise<HistoryEntry | null>;

  /**
   * Restore a snapshot as an **undoable** step rather than a destructive one.
   *
   * Current content is captured first and recorded as the `before` side, so the rewind can itself
   * be undone. Parts present now but absent from the snapshot are left alone — there is no delete
   * verb to remove them with (see this module's doc).
   *
   * @returns the entry recorded, or `null` when the snapshot already matches current content.
   */
  restore(snapshot: Snapshot): Promise<HistoryEntry | null>;

  /** Undoable entries, oldest first. For rendering a history UI; do not mutate. */
  entries(): readonly HistoryEntry[];

  /** Discard both stacks. */
  clear(): void;
}

/** Reads a part's current content, reporting absence rather than throwing. */
async function readCurrent(
  target: EditTarget,
  id: PartId
): Promise<{ readonly content: string; readonly existed: boolean }> {
  try {
    return { content: await target.readPart(id), existed: true };
  } catch {
    return { content: "", existed: false };
  }
}

/**
 * Create an undo/redo stack over one target.
 *
 * @param target - the host's artifact port; used directly for reads and for replaying changes.
 * @param options - see `EditHistoryOptions`.
 * @returns a history whose `transaction` wrapper is the only thing callers need to adopt.
 * @complexity 4
 */
export function createEditHistory(
  target: EditTarget,
  options: EditHistoryOptions = {}
): EditHistory {
  const limit = options.limit ?? 50;
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let transactionOpen = false;

  function push(entry: HistoryEntry): void {
    undoStack.push(entry);
    while (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
  }

  /**
   * Replay part contents directly, deliberately skipping `validate` — see this module's doc for
   * why an intermediate state of a multi-part rewind must not be judged.
   */
  async function replay(changes: readonly PartChange[], side: "before" | "after"): Promise<void> {
    for (const change of changes) {
      await target.replacePart(change.id, side === "before" ? change.before : change.after);
    }
  }

  return {
    async transaction<T>(work: (recording: EditTarget) => Promise<T>, label?: string): Promise<T> {
      if (transactionOpen) {
        throw new Error(
          "a transaction is already open — overlapping transactions would interleave their changes into one another's entries"
        );
      }
      transactionOpen = true;

      const changes: PartChange[] = [];
      const recording: EditTarget = {
        listParts: () => target.listParts(),
        readPart: (id) => target.readPart(id),
        snapshot: () => target.snapshot(),
        restore: (snapshot) => target.restore(snapshot),
        validate: (candidate) => target.validate(candidate),
        async replacePart(id: PartId, content: string): Promise<void> {
          const current = await readCurrent(target, id);
          await target.replacePart(id, content);
          // A write that changed nothing is not a step a person can meaningfully undo.
          if (current.existed && current.content === content) return;
          changes.push({
            id,
            before: current.content,
            after: content,
            existedBefore: current.existed,
          });
        },
      };

      try {
        return await work(recording);
      } finally {
        transactionOpen = false;
        // Committed even when `work` threw: partial writes already reached the artifact, and the
        // caller needs them to be undoable.
        if (changes.length > 0) push(label === undefined ? { changes } : { label, changes });
      }
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    async undo(): Promise<HistoryEntry | null> {
      // Peeked, not popped: a `replacePart` that throws partway through leaves the earlier parts
      // already rewound, and popping first would strand that half-applied entry in NEITHER stack —
      // the artifact changed and the history API could no longer reach it. Same principle decision
      // 3 in this module's doc states for `transaction`. Moving between stacks only after a clean
      // replay means a failed undo is simply retryable: replaying `before` again rewrites the
      // parts that already landed with the content they already hold (a no-op) and retries the one
      // that failed.
      const entry = undoStack[undoStack.length - 1];
      if (!entry) return null;
      await replay([...entry.changes].reverse(), "before");
      undoStack.pop();
      redoStack.push(entry);
      return entry;
    },

    async redo(): Promise<HistoryEntry | null> {
      // Peeked for the same reason as `undo` above, in the other direction.
      const entry = redoStack[redoStack.length - 1];
      if (!entry) return null;
      await replay(entry.changes, "after");
      redoStack.pop();
      undoStack.push(entry);
      return entry;
    },

    async restore(snapshot: Snapshot): Promise<HistoryEntry | null> {
      const changes: PartChange[] = [];
      for (const [id, after] of Object.entries(snapshot.parts)) {
        const current = await readCurrent(target, id);
        if (current.existed && current.content === after) continue;
        changes.push({ id, before: current.content, after, existedBefore: current.existed });
      }
      if (changes.length === 0) return null;

      // Recorded BEFORE the replay, not after. A restore that throws on its second part has still
      // changed the first, and pushing afterwards left those writes with no undo record at all —
      // the destructive-restore failure mode decision 2 in this module's doc exists to prevent,
      // reached by a different route. The `before` sides were captured above and are correct
      // regardless of how far the replay got: undoing a partially-applied restore rewrites every
      // listed part with the content it had before, which is a no-op for the ones never reached.
      const entry: HistoryEntry = { label: `restore ${snapshot.id}`, changes };
      push(entry);
      await replay(changes, "after");
      return entry;
    },

    entries: () => [...undoStack],

    clear(): void {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}
