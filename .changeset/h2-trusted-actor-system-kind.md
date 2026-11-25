---
"@jini-ai/core": minor
"@jini-ai/cms": major
---

Trusted actor attribution (P10-H2.J, continued).

- `@jini-ai/core`: `CommandActor.kind` widens to every `MutationActor` kind, adding `system` for a stable, named identity a truly autonomous job writes as. The delegation field `onBehalfOfId` is unchanged.
- `@jini-ai/cms` (breaking): `revertChangeSet`'s input now REQUIRES `actor: MutationActor`. The `change-set.reverted` event is stamped with the reverting actor, not the reverted change set's author. The admin revert route derives it from the authenticated principal (`agent`/`system` kept, anything else is `user`); the revert tool stamps `agent` under the acting principal id. Host cutover: every direct `revertChangeSet` caller must pass the actor its trusted channel supplies.
