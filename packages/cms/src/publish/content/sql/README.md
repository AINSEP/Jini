# publish/content/sql

`SqlPublishContentBaselineRepo` (`@jini-ai/cms/publish/content/sql/baseline-repo`): the one Kysely
query body behind `PublishContentBaselineRepoPort` (`../baseline-repo.ts`), for every dialect.

## Wiring

- The host injects a schema-erased `StorageKernel<Kysely<unknown>, unknown>` and the table name
  (`tables.baselines`); no table name or schema default lives here. The host's table must match the
  structural `PublishContentBaselinesTable` row slice declared in `baseline-repo.ts` and carry a
  unique index on `(workspace_id, peer_principal_id, entity_type, entity_id)` (the upsert target).
- The host's composition root builds it (typically a thin host binding over its content db handle
  that supplies the table name) and hands it to the publish-content planner/apply loop
  as `PublishContentBaselineRepoPort`.
