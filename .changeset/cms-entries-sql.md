---
"@jini-ai/cms": minor
---

`@jini-ai/cms/entries/sql` exports `SqlEntryRepo`, the Kysely adapter for `EntryRepoPort`, `EntryListPort`, `EntryDisplayListPort`, `EntryListExcludingTypesPort` and `EntryPublishReadPort`: the host passes its storage kernel, the names of its entry and revision tables, the two JSON dialect helpers it already uses (`EntryJsonDialectPort`) and an `onWriteSettled` hook called after every save and transaction. `@jini-ai/cms/entries` also exports the `EntryPublishReadPort` and `TrashableEntryRecord` types, and `CollectionListQuery` gains an optional `offset`.
