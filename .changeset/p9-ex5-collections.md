---
"@jini-ai/admin": patch
"@jini-ai/cms": patch
"@jini-ai/core": patch
---

Move the Collections and Taxonomy lane's host-neutral pieces from the host (verbatim moves).

- `@jini-ai/admin/screens/collections/*`: collections API types, the five collection port hooks and `use-json-field-control`.
- `@jini-ai/core/contracts/site/gated-results`: the gated-mutation `GatedPlanResult`/`GatedConfirmResult` wire envelopes (type-only; shared by taxonomy, database and recovery).
- `@jini-ai/admin/screens/taxonomy/*`: taxonomy API types, `html-rules`, `TaxonomyRowMenu` (+ hook) and the five taxonomy port hooks.
- `@jini-ai/cms/entries/site/*`: entry contracts (render vocabulary), public list, system content types and entries tool registrations (the entries and content-types tool metadata maps stay single-owned at `@jini-ai/core/tool-metadata/{entries,content-types}`).
- `@jini-ai/cms/widgets/site/*`: the declared content-type owners (reads widgets constants).
- `@jini-ai/cms/taxonomy/site/*`: taxonomy tool metadata and content targets.
