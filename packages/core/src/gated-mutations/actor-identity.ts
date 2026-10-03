/** Pure composite actor references; reject references across workspace boundaries. O(1). */
export class WorkspaceMismatchError extends Error {
  constructor(required: { message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
  }
}

// Composite (workspace, actor) references retain the tenant boundary even when an agent or
// API key acts for a delegating user. Reject mismatches before a caller persists the row.
// This helper performs no I/O or foreign-key checks: dependent domains own read-time orphan
// tolerance and reconciliation, rather than making identity population depend on storage.
export function appendActorReference(
  required: {
    referencingRowWorkspaceId: string;
    actorWorkspaceId: string;
    actorId: string;
  },
  optional: { delegatedByWorkspaceId?: string | null; delegatedById?: string | null } = {}
): {
  actorWorkspaceId: string;
  actorId: string;
  delegatedByWorkspaceId: string | null;
  delegatedById: string | null;
} {
  const { referencingRowWorkspaceId, actorWorkspaceId, actorId } = required;
  const { delegatedByWorkspaceId, delegatedById } = optional;

  if (actorWorkspaceId !== referencingRowWorkspaceId) {
    throw new WorkspaceMismatchError({
      message: `actor workspace '${actorWorkspaceId}' does not match referencing row workspace '${referencingRowWorkspaceId}'`
    });
  }
  if (delegatedByWorkspaceId != null && delegatedByWorkspaceId !== referencingRowWorkspaceId) {
    throw new WorkspaceMismatchError({
      message: `delegator workspace '${delegatedByWorkspaceId}' does not match referencing row workspace '${referencingRowWorkspaceId}'`
    });
  }

  return {
    actorWorkspaceId,
    actorId,
    delegatedByWorkspaceId: delegatedByWorkspaceId ?? null,
    delegatedById: delegatedById ?? null,
  };
}
