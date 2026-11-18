/**
 * @file The one lock key a Trash transition takes for one entity: `trash:<entityType>:<workspaceId>:<entityId>`.
 * A host that wants another package's lock on the same entity (a member's, a user's) to be the same lock binds to this
 * builder instead of spelling the string again, so a transition of one entity is serialised once, not once per package.
 */

/** @complexity O(1). */
export function trashEntityLockKey({ entityType, workspaceId, entityId }: { entityType: string; workspaceId: string; entityId: string }, _optional = {}): string {
  return `trash:${entityType}:${workspaceId}:${entityId}`;
}
