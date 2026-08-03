/**
 * @module core/apply
 *
 * Validate-then-commit: the only sanctioned path from a model's proposed content to a real write.
 *
 * Two failure behaviours here are deliberate corrections of what the reference implementations do,
 * and both were observed in their source rather than inferred:
 *
 * - **A write failure is never swallowed.** One builder wraps both its directory-create and its
 *   file-write in `try/catch` blocks that only log, then returns normally — so the action is
 *   marked complete whether or not anything reached disk, while its *shell* actions do surface
 *   failures. That asymmetry looks accidental. Here a failed write becomes a `failed` outcome the
 *   caller must handle.
 * - **Per-part outcomes are collected and returned, not aggregated into a single boolean.** This is
 *   the one thing the second reference implementation does better than the first, and it is what
 *   lets a host stream partial progress and tell the model precisely which parts landed.
 */
import type { EditTarget } from "./target.js";
import type { ApplyOutcome, PartId } from "./types.js";

/** One proposed change: replace `id`'s content with `content`. */
export interface ProposedEdit {
  readonly id: PartId;
  readonly content: string;
}

/** Normalizes an unknown thrown value into an `Error`, preserving a non-Error as its message. */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Validate one proposed edit and, if the host accepts it, commit it.
 *
 * @param target - the host's artifact port.
 * @param edit - the model's proposed replacement.
 * @returns what happened — applied, rejected by `validate`, or failed while writing.
 * @complexity 3
 */
export async function applyEdit(target: EditTarget, edit: ProposedEdit): Promise<ApplyOutcome> {
  const verdict = await target.validate({ id: edit.id, content: edit.content });
  if (!verdict.ok) {
    return { status: "rejected", id: edit.id, reason: verdict.reason };
  }

  try {
    await target.replacePart(edit.id, edit.content);
  } catch (thrown) {
    return { status: "failed", id: edit.id, error: toError(thrown) };
  }

  return { status: "applied", id: edit.id };
}

/**
 * Apply several proposed edits in order, one at a time.
 *
 * Sequential on purpose: `validate` is defined over the whole prospective artifact, so two edits
 * validated concurrently would each be judged against a state that never existed. A rejected or
 * failed edit does **not** halt the rest — every proposal gets an outcome, so the caller can report
 * precisely which parts landed rather than abandoning the batch at the first problem.
 *
 * @param target - the host's artifact port.
 * @param edits - proposals, applied in the given order.
 * @returns one outcome per proposal, positionally aligned with `edits`.
 * @complexity 2
 */
export async function applyEdits(
  target: EditTarget,
  edits: readonly ProposedEdit[]
): Promise<readonly ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = [];
  for (const edit of edits) {
    outcomes.push(await applyEdit(target, edit));
  }
  return outcomes;
}

/**
 * The subset of outcomes a host should feed back to the model as its next turn.
 *
 * Rejections carry a reason written for the model; write failures carry an error message. Both are
 * things the model can act on, and neither reaches it unless the host asks for them here — which
 * is what closes the loop between validation and correction.
 *
 * @param outcomes - results from `applyEdits`.
 * @returns one `{ id, reason }` per non-applied outcome, in input order.
 * @complexity 3
 */
export function correctionsFor(
  outcomes: readonly ApplyOutcome[]
): readonly { readonly id: PartId; readonly reason: string }[] {
  const corrections: { id: PartId; reason: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      corrections.push({ id: outcome.id, reason: outcome.reason });
    } else if (outcome.status === "failed") {
      corrections.push({ id: outcome.id, reason: outcome.error.message });
    }
  }
  return corrections;
}
