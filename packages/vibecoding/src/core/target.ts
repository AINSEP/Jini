/**
 * @module core/target
 *
 * `EditTarget` — the one seam between this package's loop and whatever is being authored.
 *
 * Four operations cover the artifact (list / read / replace / snapshot), plus `restore` as
 * snapshot's counterpart and `validate` as the guard around `replace`. That set was arrived at by
 * tracing two shipped AI app-builders end to end and then trying to break it: creation, deletion,
 * ordering, cross-part moves and binary parts were all predicted to leak through and none of them
 * did. `replace` being an upsert absorbs creation; deletion and ordering turn out to be host
 * concerns that no model-facing edit protocol needs to express.
 *
 * ## Why `validate` exists, and why it takes the whole prospective artifact
 *
 * Neither reference implementation validates writes at all. They get away with it because their
 * unit is a whole file, and **a malformed file cannot corrupt another file's syntax**. That
 * property does not survive the move to sub-document parts: a tagged region lives inside one
 * shared document, so a single unbalanced tag corrupts everything after it. Nothing in either
 * codebase solves this, so there was nothing to copy — it is the one genuinely new piece here.
 *
 * It receives the **whole prospective artifact**, not the part in isolation, because a fragment
 * that is well-formed on its own can still break the document it lands in — a table cell outside a
 * table, a region that closes a parent's tag. Validating the part alone would pass both.
 *
 * ## What is deliberately absent
 *
 * There are no verbs for running processes, installing dependencies, or building. Those are real
 * needs for a file-tree host and they belong to a separate execution layer — putting them here
 * would make the port undescribable for hosts that have no such tier, which is precisely the
 * over-fitting this seam exists to prevent. Their absence is a design decision, not a gap.
 */
import type { PartId, PartRef, Snapshot, ValidationResult } from "./types.js";

/**
 * The host-supplied artifact port.
 *
 * Implementations are expected to be small: a file-tree host maps parts to files, a
 * single-document host maps them to addressable regions. Nothing here assumes a filesystem, a
 * DOM, or a framework.
 */
export interface EditTarget {
  /**
   * Every part a model may currently be asked to rewrite.
   *
   * This is the allowlist. A part omitted here is structurally unaddressable rather than merely
   * discouraged — which is where scope discipline actually comes from. Prompt severity is not a
   * substitute, and measurably is not one: a shipped builder with three prompt variants enforces
   * identical scope rules with wildly different tone, because the constraint lives in the
   * addressing, not the wording.
   */
  listParts(): Promise<readonly PartRef[]>;

  /** Current content of one part. Rejects if `id` was not published by `listParts`. */
  readPart(id: PartId): Promise<string>;

  /**
   * Write one part's content, creating it if absent — this is an **upsert**.
   *
   * Callers must not invoke this directly when a `validate` implementation exists; go through the
   * apply loop, which validates first. Implementations should assume `content` is model-authored
   * and therefore arbitrary.
   */
  replacePart(id: PartId, content: string): Promise<void>;

  /** Capture every part's content. See `Snapshot` — data only, never execution state. */
  snapshot(): Promise<Snapshot>;

  /**
   * Restore previously captured content.
   *
   * Returns once the data is back. Any downstream execution state is the host's to re-sync
   * afterwards; this call makes no claim about it.
   */
  restore(snapshot: Snapshot): Promise<void>;

  /**
   * Decide whether a prospective change may be committed.
   *
   * Called with the artifact **as it would be** if `id` were replaced by `content`. A host whose
   * parts cannot corrupt one another (a file tree, typically) may return `{ ok: true }`
   * unconditionally; the cost of the hook is then a function call.
   *
   * A rejection's `reason` is fed to the model as its next turn, so it should describe the defect
   * in terms the model can act on.
   */
  validate(candidate: { readonly id: PartId; readonly content: string }): Promise<ValidationResult>;
}
