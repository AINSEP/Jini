---
"@jini-ai/admin": patch
"@jini-ai/cms": patch
---

Move the Collections and Taxonomy lane's host-neutral pieces from the host (verbatim moves).

- `@jini-ai/admin/screens/collections/*`: collections API types, the five collection port hooks and `use-json-field-control`.
- `@jini-ai/admin/screens/taxonomy/*`: taxonomy API types, `html-rules`, `TaxonomyRowMenu` (+ hook) and the five taxonomy port hooks.
- `@jini-ai/cms/entries/site/*`: entry contracts, render-entry vocabulary, public list/read, entries tool metadata and registrations, and the entry-refs extractor.
- `@jini-ai/cms/content-types/site/*`: system content types, declared content-type owners and content-types tool metadata.
- `@jini-ai/cms/taxonomy/site/*`: taxonomy tool metadata, site agent tools and content targets.
