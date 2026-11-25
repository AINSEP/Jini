import type { MutationActor } from "@jini-ai/core/contracts/events";

/**
 * @file The one check every content writer applies to the trusted actor it is handed. The execution
 * channel supplies attribution (`actor.kind`), the principal ID still governs authorization
 * (`actorId`), and the two are not interchangeable — so a writer stamps the actor it was given and
 * refuses one naming somebody else, but never derives a kind from what an ID looks like.
 */

/** Raised when a writer is handed an actor whose id is not the principal it authorizes. */
export class ConflictingMutationActorError extends Error {
  constructor(required: { principalId: string; actorId: string }, _optional: Record<string, never> = {}) {
    super(`The recorded actor '${required.actorId}' is not the principal '${required.principalId}' making this change.`);
    this.name = "ConflictingMutationActorError";
  }
}

/**
 * The actor to stamp on a write's event, checked against the principal that write authorizes as.
 *
 * @param required - `principalId`: the authorizing principal; `actor`: the trusted actor, when the caller supplied one.
 * @returns The same actor, or `undefined` for an unattributed (legacy) write — never a guessed kind.
 * @throws {ConflictingMutationActorError} When `actor.id` differs from `principalId`.
 * @complexity O(1).
 */
export function checkedMutationActor(
  required: { principalId: string; actor: MutationActor | undefined },
  _optional: Record<string, never> = {},
): MutationActor | undefined {
  const { principalId, actor } = required;
  if (actor && actor.id !== principalId) throw new ConflictingMutationActorError({ principalId, actorId: actor.id });
  return actor;
}
