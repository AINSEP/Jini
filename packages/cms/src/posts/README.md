# posts

The post/page record and the storage-free helpers around it: the record shape and its errors
(`post.ts`), field normalisation (`post-write-fields.ts`), the optimistic-concurrency parser
(`expected-version.ts`), the model-facing error rules (`post-tool-errors.ts`), plain-text search
documents and the in-JS search fallback (`search.ts`), the scheduled go-live sweep (`go-live-sweep.ts`), slugs (`slug.ts`) and the
before-save hook seam (`post-before-save.ts`). Each is its own `@jini-ai/cms/posts/<name>` subpath.

## Wiring

What the host injects:

- **Repository** — every function takes a `PostRepoPort` (declared in `post.ts`) on its args object; the
  host owns the SQL/in-memory adapters.
- **Storage kinds** — `PostKind` comes from `@jini-ai/core/contracts/site/post-kind`. Public readers
  accept only `PublicPostKind`.
- **Go-live sweep** — `startPostGoLiveSweep` takes `deps` (repo-backed `GoLiveCandidatesPort`, outbox,
  clock) and `workspaceId`; optional `tracker` (a core `Tracker`) and `timers` (for tests). The host
  starts it in the serving process and stops it on shutdown.
- **Clock** — write paths take an optional `Clock`; absent means wall time.
