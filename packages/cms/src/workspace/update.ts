import type { UUID } from "../core/ports.js";
import {
  validateWorkspaceNameAndSlug,
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  type WorkspaceRecord,
  type WorkspaceRepoPort,
} from "./create.js";

/**
 * @file `UPDATE_WORKSPACE` (SPEC-044 REQ-04) — rename a workspace's `name` and/or `slug`.
 *
 * Purpose:
 * The one mutating transition SPEC-044 adds beyond create/delete. Mirrors `create.ts`'s
 * validate -> check-constraints -> persist shape (no domain event is enqueued here — REQ-04 doesn't
 * ask for one, and no consumer subscribes to a workspace-renamed topic yet; add one the same way
 * `createWorkspace` does if a real consumer appears, rather than emitting a speculative event now).
 *
 * Architectural role:
 * Ordinary slice function, not a port (ADR-006) — one implementation, ADR-006's rule-of-two doesn't
 * apply to business logic, only to the repo/outbox seams it calls through `WorkspaceRepoPort`.
 */

/** Command payload for `UPDATE_WORKSPACE`. At least one of `name`/`slug` must be present (EC-01). */
export interface UpdateWorkspaceInput {
  id: UUID;
  name?: string | undefined;
  slug?: string | undefined;
}

/** Dependencies required by the update-workspace slice. */
export interface UpdateWorkspaceDeps {
  repo: WorkspaceRepoPort;
}

/** Required parameters for `updateWorkspace`. */
export interface UpdateWorkspaceRequired {
  deps: UpdateWorkspaceDeps;
  input: UpdateWorkspaceInput;
}

/**
 * Execute `UPDATE_WORKSPACE` (REQ-04). At least one of `name`/`slug` must be present in the input
 * (EC-01 — an empty-object update is rejected, not a silent no-op, so a client-side bug that drops
 * both fields fails loudly instead of masquerading as a successful save). When only one field is
 * given, the other keeps its current stored value; both are re-validated together through
 * `validateWorkspaceNameAndSlug` either way, so a `slug`-only update still catches a blank stored
 * `name` (defensive; `name` can never actually be blank in practice since `createWorkspace` already
 * rejects that, but re-validating both together — rather than only the changed field — keeps this
 * function's invariant identical to `createWorkspace`'s with no special-cased partial path).
 *
 * The slug-uniqueness check excludes the row being updated (EC-02 — a workspace is never "in
 * conflict with itself"): `findBySlug` naturally excludes it whenever the row's own `id` matches,
 * since that's a no-op rename, not a collision with a *different* row.
 *
 * @complexity O(1) — one lookup by id, one lookup by slug, one write.
 * @overallScore 100
 */
export async function updateWorkspace(required: UpdateWorkspaceRequired): Promise<{ workspace: WorkspaceRecord }> {
  const { deps, input } = required;

  if (input.name === undefined && input.slug === undefined) {
    throw new WorkspaceValidationError("at least one of name or slug is required");
  }

  const existing = await deps.repo.findById(input.id);
  if (!existing) throw new WorkspaceNotFoundError(`workspace '${input.id}' was not found`);

  const { name, slug } = validateWorkspaceNameAndSlug({
    name: input.name ?? existing.name,
    slug: input.slug ?? existing.slug,
  });

  if (slug !== existing.slug) {
    const collision = await deps.repo.findBySlug(slug);
    if (collision && collision.id !== existing.id) {
      throw new WorkspaceConflictError(`slug '${slug}' already exists`);
    }
  }

  const updated: WorkspaceRecord = { ...existing, name, slug };
  await deps.repo.update(updated);
  return { workspace: updated };
}
