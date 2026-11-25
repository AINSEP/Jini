---
"@jini-ai/cms": minor
---

Widget and taxonomy writers stamp a trusted `MutationActor` on their outbox events (P10-H2.J).

- Entry writes (`createEntry`/`updateEntry`) accept an optional `actor` whose `id` must equal `actorId`; a conflicting actor is refused with `ConflictingMutationActorError` before anything is written. The kernel and taxonomy outbox adapters lift the actor onto the event envelope.
- Widget writes take `actor.kind` from their caller's channel; the widgets subsystem's own region seeding and legacy-trash adoption record kind `system`. `WidgetToolActor.kind` is narrowed to `MutationActor["kind"]`.
- `assignTerms`/`unassignTerms` accept an optional `actor`. The admin assign/unassign routes and the assistant taxonomy tools take an optional host-injected `mutationActor({ principalId })`; unbound, writes record no actor rather than a guessed kind.
