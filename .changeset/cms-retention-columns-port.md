---
"@jini-ai/cms": minor
---

`createSubmissionIpRetentionRepo` (`@jini-ai/cms/forms/sql`) takes the host's column catalog as a required `columns` port (`ColumnCatalogPort`, `({ table }) => [{ name, notNull }]`) instead of importing `listColumns` from `@jini-ai/db`, and accepts any `StorageKernel<Kysely<DB>, DB>`. A host on a `@jini-ai/db` kernel binds `columns: ({ table }) => listColumns(kernel, table)`. `@jini-ai/db` leaves cms's optional peers (it stays a devDependency for tests).
