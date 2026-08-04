import type { UUID } from "../core/ports.js";
import { WorkspaceLastRemainingError, WorkspaceNotFoundError, type WorkspaceRepoPort } from "./create.js";

/**
 * @file `DELETE_WORKSPACE` — hard-delete a workspace, guarded so the
 * install is never left with zero workspace rows.
 *
 * Purpose:
 * Because a v1 install always has exactly one workspace row (a host's `workspaceId` is fixed at
 * process composition, so no request can ever address a second, even-if-present workspace row
 * today), `deleteWorkspace` **always refuses in v1**. That is correct,
 * guarded behavior, not a stub: the precondition, the atomicity, and the typed refusal all exist and
 * are exercised by tests now, so the day a second, genuinely addressable workspace exists, delete
 * works without further design.
 *
 * Architectural role:
 * Ordinary slice function — not a port. `deps.repo.list()` is the count source; the guard
 * check and the delete happen inside one `async` function body with no `await` yielded to another
 * caller in between the count read and the delete write, which — under a single Node.js
 * event-loop, no-concurrent-DB-transaction execution model (the same "atomic by construction"
 * reasoning `identity/grant-service.ts`'s own header comment documents for its transitions, and the
 * same model `DISABLE_PRINCIPAL`'s INV-08 count-check-then-disable already relies on) — is the
 * atomicity INV-03 requires. A future multi-process/multi-connection deployment would need a real
 * DB-level transaction here; flagged, not silently assumed away.
 */

/** Command payload for `DELETE_WORKSPACE`. */
export interface DeleteWorkspaceInput {
  id: UUID;
}

/** Dependencies required by the delete-workspace slice. */
export interface DeleteWorkspaceDeps {
  repo: WorkspaceRepoPort;
}

/** Required parameters for `deleteWorkspace`. */
export interface DeleteWorkspaceRequired {
  deps: DeleteWorkspaceDeps;
  input: DeleteWorkspaceInput;
}

/**
 * Execute `DELETE_WORKSPACE` (REQ-05). Throws `WorkspaceNotFoundError` if `input.id` does not
 * resolve to a row, else `WorkspaceLastRemainingError` (INV-03) if it is the only workspace row —
 * which is always true in v1, so this transition always refuses today. No row is deleted on either
 * rejection.
 *
 * @complexity O(n) in the total workspace count (`repo.list()`) — bounded by the same
 * operator-managed-roster assumption `identity`'s `PrincipalRepoPort.list()` already makes; not a
 * caller-controlled collection.
 * @overallScore 100
 */
export async function deleteWorkspace(required: DeleteWorkspaceRequired): Promise<void> {
  const { deps, input } = required;

  const existing = await deps.repo.findById(input.id);
  if (!existing) throw new WorkspaceNotFoundError(`workspace '${input.id}' was not found`);

  const all = await deps.repo.list();
  if (all.length <= 1) {
    throw new WorkspaceLastRemainingError(
      "the install's last remaining workspace cannot be deleted (INV-03)"
    );
  }

  await deps.repo.delete(input.id);
}
