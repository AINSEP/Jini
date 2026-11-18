---
"@jini-ai/cms": minor
---

`@jini-ai/cms/taxonomy/sql` exports `SqlTaxonomyRepo`, `SqlTermRepo`, `SqlEntryTermRepo` and `SqlTaxonomyRevisionRepo`, the Kysely adapters for the taxonomy ports: the host passes its storage kernel, the names of its four taxonomy tables and the workspace to scope to. `@jini-ai/cms/taxonomy` also exports the read-port types `TaxonomyPublishReadPort`, `TermPublishReadPort`, `AssignedTermView` and `EntryTermReadPort`.
