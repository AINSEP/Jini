# publish/transfer/sql

`SqlPublishContentBundleRepo` (`@jini-ai/cms/publish/transfer/sql/bundle-repo`): the one Kysely
query body behind `PublishContentBundleRepoPort` (`../bundle-staging.ts`), for every dialect.

`createBackstopAuditSqlPort` (`@jini-ai/cms/publish/transfer/sql/backstop-audit-repo`): the raw-SQL
body behind `BackstopAuditPort` (`../backstop-audit.ts`) over the host's publish backstop log table.

## Wiring

- The host injects a schema-erased `StorageKernel<Kysely<unknown>, unknown>` and the table name
  (`tables.bundles`); no table name or schema default lives here. The host's table must match the
  structural `PublishContentBundlesTable` row slice declared in `bundle-repo.ts`.
- The host's composition root builds it (typically a thin host binding over its content db handle
  that supplies the table name) and hands it to `stageBundle` / the staged-bundle
  reads and the expiry sweep as `PublishContentBundleRepoPort`.
- For the backstop audit the host injects its storage kernel (any object with raw-SQL `query`/`execute`,
  e.g. a `KyselyKernel`), the table name (`tables.log`) and its `tableExists({ kernel, table })` check
  (typically `@jini-ai/db/kernel`'s, which cms does not depend on at runtime). The table is staged:
  `ready()` reports `false` until the host's migration creates it. The host's composition root puts the
  port on `BackstopPorts.audit` for the dialects it supports.
