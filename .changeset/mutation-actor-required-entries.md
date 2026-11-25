---
"@jini-ai/cms": minor
---

Entry writes now require a typed `actor` (`ActorIdentityInput.actor`) and `WidgetWriteActor.kind`; `createEntry`/`updateEntry`/`importEntry`/`publishEntry`/`unpublishEntry` refuse an unattributed write with `MissingMutationActorError`, and import/publish/unpublish events now carry the actor.
