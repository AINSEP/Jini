# taxonomy/site

Site-level taxonomy pieces a CMS host binds: the content targets the assignment tools may tag
(`content-targets.ts`), per-tool registration metadata (`tool-metadata.ts`), and term-assignment
sync for content publishing (`publish-term-ids.ts`).

## Wiring

- `publish-term-ids.ts` — a post/page/entry publish handler calls `readTermIds`/`withTermIds` when
  packing and `prepareTermSync` when applying. It takes the host's `taxonomy`/`term` publish-ports bag
  as `ports` and the host's publish-content deps bag as `deps`; both are typed as structural slices
  (`TermSyncPorts`, `TermSyncDeps`), so the host passes its own bags unchanged. `deps.authorize` and
  `deps.outbox` must be wired for any apply that changes assignments. It raises the publish
  apply-row error from `publish/transfer/apply-errors.ts`, a leaf module listed in `jini.isolation.shared`.
