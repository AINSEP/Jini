# publish/transfer/sql

`SqlPublishContentBundleRepo` (`@jini-ai/cms/publish/transfer/sql/bundle-repo`): the one Kysely
query body behind `PublishContentBundleRepoPort` (`../bundle-staging.ts`), for every dialect.

## Wiring

- The host injects a schema-erased `StorageKernel<Kysely<unknown>, unknown>` and the table name
  (`tables.bundles`); no table name or schema default lives here. The host's table must match the
  structural `PublishContentBundlesTable` row slice declared in `bundle-repo.ts`.
- The host's composition root builds it (typically a thin host binding over its content db handle
  that supplies the table name) and hands it to `stageBundle` / the staged-bundle
  reads and the expiry sweep as `PublishContentBundleRepoPort`.
