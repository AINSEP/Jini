/**
 * @file The one seam a publish-content TYPE uses to say "this failure is about ONE entity — downgrade
 * its report row and keep the run going", rather than "the run is broken".
 *
 * ## Why this file exists
 *
 * `apply-loop.ts`'s per-row catch has exactly two behaviours: downgrade the row, or rethrow and abort
 * the whole run (persisting a `failed` run row with whatever change sets landed first). Until now the
 * downgrade side recognised only `PostConflictError`/`PostNotFoundError`, and `apply-loop.ts`'s own
 * header disclosed that as a known gap: *"a future non-post type either reuses these classes or this
 * catch needs widening when that type lands."*
 *
 * `media` is that type, and neither half of that sentence was acceptable as written. Reusing
 * `post`'s error classes from `features/media` would assert a type hierarchy that does not exist
 * between two unrelated features. Naming media's own classes inside `apply-loop.ts` would make the
 * generic pipeline grow one import per content type forever — the exact per-resource branching
 * `type-registry.ts` was built to avoid (its own header, "one generic pipeline over a growing set of
 * resources instead of one bespoke branch per resource").
 *
 * So the loop checks for THIS base class instead. A new content type raises it (or a subclass) and
 * needs no edit to `apply-loop.ts` at all. `post`'s two pre-existing classes keep their own special
 * case, named by the post handler's `isApplyConflict` rather than by the loop, because retrofitting
 * them onto this base would mean editing `post.ts`'s error hierarchy — a much larger, shared,
 * unrelated surface — for no behavioural gain.
 *
 * ## Dependency direction
 *
 * This module imports NOTHING, which is what makes it safe for a resource feature
 * (`features/media/publish-content.ts`) to value-import while `features/publish-content/apply-loop.ts`
 * imports it too: there is no path back, so no cycle is possible. Note this is deliberately NOT
 * `type-registry.ts` — `post-no-direct-registry-import.boundary.test.ts` forbids a value edge into
 * that specific module and explicitly leaves other `features/publish-content/` helpers unrestricted.
 */

/** The two report outcomes a single failed row may be downgraded to. Mirrors the subset of
 *  `planner.ts`'s `PublishContentOutcomeKind` that describes a row which wrote nothing and was not
 *  going to — restated here as a literal union rather than imported, so this module keeps its
 *  zero-import property (see this file's header). */
export type PublishContentApplyRowOutcome = "conflict" | "blocked";

/**
 * A per-entity apply failure that must downgrade ONE report row instead of aborting the run.
 *
 * Throw this (or a subclass) from a `PublishContentHandler.apply()` for any refusal that is DATA
 * rather than a fault: a precondition that no longer holds, a destination row that moved on. Never
 * throw it for a genuine failure — a broken repo, a bug, an unreachable database — where aborting
 * the run and recording a `failed` phase is the correct, honest outcome.
 *
 * The message is used VERBATIM as the report row's `reason`, so it must read as an operator-facing
 * explanation on its own, with no surrounding context added. `apply-loop.ts` wraps `post`'s legacy
 * errors in a "changed on the destination during apply" prefix precisely because their messages do
 * NOT satisfy that; a subclass of this type owns its own phrasing and is never wrapped.
 *
 * Invariant every thrower must hold: NOTHING is written before this is raised. The loop reports the
 * row as non-writing, so a partial write behind one of these would make the report a lie.
 */
export class PublishContentApplyRowError extends Error {
  /** Which report outcome `apply-loop.ts` downgrades the row to: `blocked` for a precondition that
   *  does not hold (a missing blob, a taken slug), `conflict` for a destination that moved on. */
  readonly rowOutcome: PublishContentApplyRowOutcome;

  constructor({ rowOutcome, message }: { rowOutcome: PublishContentApplyRowOutcome; message: string }) {
    super(message);
    this.name = "PublishContentApplyRowError";
    this.rowOutcome = rowOutcome;
  }
}
