---
"@jini-ai/cms": minor
---

Post writers stamp the trusted actor. `enqueueContentWrite` and `emitPublicTransitionEvent` take an optional `actor`, refuse one whose id is not the write's principal, and stamp it (with `actorId`) on their outbox events. A write with no acting principal, which the revision ledger records as `SYSTEM_ACTOR_ID`, now names its events `{ id: "system", kind: "system" }` explicitly (new `SYSTEM_MUTATION_ACTOR`); a principal without a vouched actor still records no kind. New export `postEventActor`.
