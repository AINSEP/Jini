---
"@jini-ai/cms": minor
---

`@jini-ai/cms/forms/sql` exports `createFormsTables({ kernel, tables })`, which idempotently creates the forms definition and submission tables and their indexes on a host-passed kernel (SQLite or Postgres), with the `FormsTablesKernel` and `FormsTablesDialect` port types. Any `@jini-ai/db` storage kernel satisfies the port. Derived index and constraint names longer than Postgres' 63 bytes are shortened with a hash, so none is silently skipped.
