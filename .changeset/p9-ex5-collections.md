---
"@jini-ai/admin": patch
"@jini-ai/cms": patch
"@jini-ai/core": patch
---

Move the Collections and Taxonomy lane's host-neutral pieces from the host (verbatim moves).

- `@jini-ai/admin/screens/collections/*`: collections API types, the five collection port hooks and `use-json-field-control`.
- `@jini-ai/admin/screens/{collections,taxonomy}/*-i18n`: the two feature dictionaries, now falling back to `ADMIN_COMMON_I18N`.
- `@jini-ai/core/contracts/site/gated-results`: the gated-mutation `GatedPlanResult`/`GatedConfirmResult` wire envelopes (type-only; shared by taxonomy, database and recovery).
- `@jini-ai/admin/screens/taxonomy/*`: taxonomy API types, `html-rules`, `TaxonomyRowMenu` (+ hook) and the five taxonomy port hooks.
- `@jini-ai/cms/entries/site/*`: entry contracts (render vocabulary), public list, system content types, entries tool metadata and registrations.
- `@jini-ai/cms/widgets/site/*`: the declared content-type owners (reads widgets constants).
- `@jini-ai/cms/content-types/site/tool-metadata`: content-types tool metadata.
- `@jini-ai/cms/taxonomy/site/*`: taxonomy tool metadata and content targets.
