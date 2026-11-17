---
"@jini-ai/commerce": minor
---

`migrateCommercePayments` (`@jini-ai/commerce/payments/ledger/sql`) takes the host's migration runner as a required `runMigrations` value (db's `runMigrations`, called with its own three positional arguments) instead of importing `@jini-ai/db/migrate`, and accepts any kernel typed `StorageKernel<Kysely<unknown>, unknown>`. The payments ledger table stays forced to commerce's own, whatever options the caller passes. A host binds `migrateCommercePayments({ kernel, runMigrations })` with `runMigrations` from `@jini-ai/db/migrate`. `@jini-ai/db` leaves commerce's optional peers (it stays a devDependency for tests).
