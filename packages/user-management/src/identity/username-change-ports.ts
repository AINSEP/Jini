import type { OutboxPort } from "@jini-ai/core/contracts/events";
import type { IdGenerator } from "@jini-ai/core/primitives";
import { IdentityValidationError, type UsernameChangePort } from "../core/index.js";

/** Bind Jini's rename lifecycle to the host's Trash and existing transactional audit outbox.
 * @complexity O(1): one Trash read per check, one audit enqueue per actual rename.
 */
export function createUsernameChangePort(required: {
  outbox: OutboxPort; idGen: IdGenerator; isInTrash: (required: { principalId: string }, optional?: Record<string, never>) => Promise<boolean>;
  seededOwnerPrincipalId: Promise<string>;
}, _optional: Record<string, never> = {}): UsernameChangePort {
  return {
    assertSupported: async ({ principalId }, _options = {}) => {
      // The host still discovers its bootstrap owner by login on restart. Persisting a stable
      // binding needs an owner decision; until then a rename must not mint/promote another owner.
      if (principalId === await required.seededOwnerPrincipalId) {
        throw new IdentityValidationError({ message: "the seeded owner's username cannot be changed until a persistent owner identity is configured" });
      }
    },
    isInTrash: ({ principalId }, _options = {}) => required.isInTrash({ principalId }),
    record: async ({ workspaceId, principalId, callerPrincipalId, previousUsername, username, occurredAt }, _options = {}) => {
      await required.outbox.enqueue({ id: required.idGen.newId(), name: "identity.user.username_changed",
        workspaceId, aggregateId: principalId, actorId: callerPrincipalId, occurredAt,
        payload: { principalId, previousUsername, username } });
    },
  };
}
