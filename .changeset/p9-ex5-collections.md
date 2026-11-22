---
"@jini-ai/admin": patch
"@jini-ai/cms": patch
---

Move the Collections and Taxonomy lane's host-neutral pieces from the host (verbatim moves).

- `@jini-ai/admin/screens/collections/*`: collections API types, the five collection port hooks and `use-json-field-control`.
- `@jini-ai/admin/screens/{collections,taxonomy}/*-i18n`: the two feature dictionaries, now falling back to `ADMIN_COMMON_I18N`.
- `@jini-ai/admin/screens/taxonomy/*`: taxonomy API types, `html-rules`, `TaxonomyRowMenu` (+ hook) and the five taxonomy port hooks.
- `@jini-ai/cms/entries/site/*`: entry contracts, render-entry vocabulary, public list/read, system content types, entries tool metadata and registrations.
- `@jini-ai/cms/widgets/site/*`: the console-reporting entry-refs extractor binding and the declared content-type owners (both read widgets constants).
- `@jini-ai/cms/content-types/site/tool-metadata`: content-types tool metadata.
- `@jini-ai/cms/taxonomy/site/*`: taxonomy tool metadata and content targets.
