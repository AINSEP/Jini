# posts

The post/page record and the storage-free helpers around it: the record shape and its errors
(`post.ts`), field normalisation (`post-write-fields.ts`), the optimistic-concurrency parser
(`expected-version.ts`), the model-facing error rules (`post-tool-errors.ts`), plain-text search
documents and the in-JS search fallback (`search.ts`), the scheduled go-live sweep (`go-live-sweep.ts`), slugs (`slug.ts`) and the
before-save hook seam (`post-before-save.ts`). Each is its own `@jini-ai/cms/posts/<name>` subpath.

## Wiring

- `posts/post-read`, `posts/post-write-effects`: pure over the injected `PostRepoPort` / `OutboxPort`; the go-live rule comes from `@jini-ai/core/contracts/site/scheduled-publish`.
- `posts/featured-image`: the host binds `FeaturedImageDeps.findMediaByIdOrSlug` (required) to the media owner's lookup, plus `mediaRepo` and the optional `mediaContentTypeStore`.
- `posts/expected-version`: `versionConflictEnvelope({ err, outwardErrorMessage })` — the host words the 409 `error` copy.
- `posts/go-live-sweep`: `startPostGoLiveSweep({ deps, workspaceId, onError })` — the host's required reporter receives a failed pass's error.
- `posts/post-tool-views`: every view takes `{ deps: PostToolViewDeps, post }` (or `{ post }`); the host binds `PostToolViewDeps.entryPublicPath` to its configured routing instance, `runtimeMode` to its live-site signal, and supplies the `publishedWhere: { live, local }` copy (product wording stays in the host).
- `posts/post-import`: `importPostEntity({ deps, input })` — the host passes `ImportPostEntityDeps` (clock, repo, outbox, optional `beforeSaveHook`); used by the host's publish/replication path.
- `posts/post-slugs`: the host passes `reservedSegments` (its reserved first path segments) to `assertValidExplicitSlug`, `resolveCreateSlug` and `availablePostSlug`, and its `postPublicPath` to `captureSlugChange`; `releaseTrashedSlug({ repo, holder })` is pure over the repo.

What the host injects:

- **Repository** — every function takes a `PostRepoPort` (declared in `post.ts`) on its args object; the
  host owns the SQL/in-memory adapters.
- **Storage kinds** — `PostKind` comes from `@jini-ai/core/contracts/site/post-kind`. Public readers
  accept only `PublicPostKind`.
- **Go-live sweep** — `startPostGoLiveSweep` takes `deps` (repo-backed `GoLiveCandidatesPort`, outbox,
  clock) and `workspaceId`; optional `tracker` (a core `Tracker`) and `timers` (for tests). The host
  starts it in the serving process and stops it on shutdown.
- **Clock** — write paths take an optional `Clock`; absent means wall time.
