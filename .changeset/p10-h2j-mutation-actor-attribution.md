---
"@jini-ai/core": minor
"@jini-ai/db": minor
"@jini-ai/cms": minor
---

Preserve trusted actor attribution on mutations and events. Core adds `MutationActor` (`{ id, kind: "user" | "agent" | "system" }`), `CommandActor` now extends it, and change-set records and domain events gain an optional `actor` beside the compatibility `actorId`. `executeCommand` stamps the same actor on the change set and its `change-set.applied` event; revert carries the reverted set's recorded actor. The DB change-set adapter round-trips `change_sets.actor_kind` only when the host passes `{ actorKindColumn: true }` (default off, so an unmigrated schema never names the column); the outbox keeps the actor inside `event_json`. Writers refuse an `actorId` that disagrees with `actor.id`. Historic rows without a kind stay unknown. Follow-up (breaking): making `actor` required on write shapes, coordinated with host cutover.
