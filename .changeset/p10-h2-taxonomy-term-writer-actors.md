---
"@jini-ai/cms": minor
---

The remaining taxonomy writers stamp a trusted `MutationActor` on their outbox events (P10-H2.J).

- `createTaxonomy`, `createTerm`, `renameTerm`, `deleteTerm`, `deleteTaxonomy`, `importTaxonomy` and `importTerm` accept an optional `actor` whose `id` must equal `principalId`; a conflicting actor is refused with `ConflictingMutationActorError` before anything is written. Omitted, the event records no actor rather than a guessed kind.
- `TaxonomyWriteRouteDeps` now carries the optional host-injected `mutationActor({ principalId })` (moved up from `TaxonomyAssignTermsRouteDeps`, which still inherits it), so the create-taxonomy, create-term and rename-term admin routes stamp it too; the assistant create/rename tools read the existing `TaxonomyPackageToolDeps.mutationActor`.
- `taxonomy_revisions` rows still record `actorId` only; the merge hooks write no outbox event.
