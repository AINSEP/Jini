---
"@jini-ai/cms": minor
---

`@jini-ai/cms/trash/sql` exports `createTableTrashAdapter`, the one `TrashAdapter` (hide, unhide, purge) for every registry entry, written as one Kysely body over the storage kernel. The host passes `{ entry, kernel, tables: { trashedItems } }`; the kernel is read on the first call, not at construction.
