import type { TransactionalRepoPort } from "../taxonomy/write-service.js";
import type { UUID } from "@jini-ai/core/primitives";
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
 * Ordinary slice function — not a port. `deps.repo.list` is the count source; the guard
 * check and the delete run in one transaction. The earlier single-Node-event-loop,
 * "atomic by construction" reasoning (also used for `identity/grant-service.ts`'s transitions
 * and `DISABLE_PRINCIPAL`'s count-check-then-disable) was insufficient: awaits can
 * interleave even in one process. needs serialization across the count read and delete.
 * The memory adapter queues transactions; a multi-process/multi-connection deployment needs
 * a DB-level transaction that serializes all workspace writers, supplied by the host.
 * Without the required transaction port, deletion fails closed before repository reads.
 * See docs/decisions/DR-007-workspace-and-owner-floors.md.
 */

/** Command payload for `DELETE_WORKSPACE`. */
export interface DeleteWorkspaceInput {
  id: UUID;
}

/** Dependencies required by the delete-workspace slice. */
export interface DeleteWorkspaceDeps {
  repo: WorkspaceRepoPort;
  /** Required transaction; must serialize workspace writers on its store. */
  transaction: TransactionalRepoPort["transaction"];
}

/** Required parameters for `deleteWorkspace`. */
export interface DeleteWorkspaceRequired {
  deps: DeleteWorkspaceDeps;
  input: DeleteWorkspaceInput;
}

/**
 * Execute `DELETE_WORKSPACE`. Throws `WorkspaceNotFoundError` if `input.id` does not
 * resolve to a row, else `WorkspaceLastRemainingError` if it is the only workspace row —
 * which is always true in v1, so this transition always refuses today. No row is deleted on either
 * rejection.
 *
 * @complexity O(n) in the total workspace count (`repo.list`) — bounded by the same
 * operator-managed-roster assumption `identity`'s `PrincipalRepoPort.list` already makes; not a
 * caller-controlled collection.
 * @overallScore 100
 * See docs/decisions/DR-007-workspace-and-owner-floors.md.
 */
export async function deleteWorkspace(required: DeleteWorkspaceRequired): Promise<void> {
  const { deps, input } = required;

  const transaction = deps.transaction;
  if (!transaction) throw new Error("workspace deletion requires a transaction port");
  const guardedDelete = async (): Promise<void> => {
    const existing = await deps.repo.findById({ id: input.id });
    if (!existing) throw new WorkspaceNotFoundError({ message: `workspace '${input.id}' was not found` });

    const all = await deps.repo.list();
    if (all.length <= 1) {
      // See docs/decisions/DR-007-workspace-and-owner-floors.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
      throw new WorkspaceLastRemainingError({ message: "the install's last remaining workspace cannot be deleted" }
      );
    }

    await deps.repo.delete({ id: input.id });
  };
  await transaction({ fn: guardedDelete });
}
