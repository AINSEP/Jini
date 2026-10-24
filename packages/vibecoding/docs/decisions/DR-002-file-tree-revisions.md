# DR-002: Local working trees and content-addressed revisions

Status: accepted for step 1 by the coordinator's 2026-10-24 dispatch and binding Opus review.

The app root is the real directory a dev server watches. Revision state belongs in a private,
host-selected `stateDir` outside the served tree. Independent copied revision trees would require
a later synchronization engine, waste unchanged bytes, and let undo erase npm/editor changes.

`@jini-ai/vibecoding/node` owns local project orchestration. It reuses platform's guarded file
reader, file lock and atomic writer. Platform owns bounded EPERM/EBUSY rename retry and binary
atomic writes. Universal project types belong in `core/project.ts`; no Node dependency enters core.
The five added production files are `core/project.ts`, `node/paths.ts`, `node/store.ts`,
`node/project.ts` and `node/index.ts`. Existing session/tools move to framework-free modules
with one `./session` entry and identical React compatibility re-exports.

Files use canonical relative paths as PartIds. A create carries its relative path directly;
there are no reservations. Host allowlisting intersects mandatory secret/generated/dependency
exclusions. Platform owns physical containment and bounded reads/listing; project path rules add
portable names, depth/length bounds, and candidate-wide case/NFC file and directory collisions.
The directory must be controlled by the host; these checks do not sandbox an adversarial process.

Revisions contain immutable manifests and deduplicated SHA-256 objects. A commit durably prepares
dependencies, atomically selects `current.json` with an advancing generation and pending source,
then materializes the destination and clears pending. Reopen rolls pending work forward
idempotently. Materialization deletes removed files, writes files, then prunes empty managed
folders. Empty managed aliases/blockers may be pruned first for portable directory renames and
file/directory transitions. Unmanaged contents are never recursively deleted. This is process-crash
recovery, not an atomic multi-file read view or a universal power-loss promise.

`capture()` records drift without rewriting it. Compare disk fingerprints (size/mtime/ctime),
hash only changed files, and refresh same-content fingerprints without a revision. First open is
the first capture. Whole-candidate validation is optional and runs outside the shared lock;
generation and drift checks repeat under it. A refused candidate is never selected.

Existing `core/history` is the sole undo/redo owner. One private pointer part records each
revision switch; its write is the only and last recording write. All mutation paths serialize,
capture drift before replay, and advance generation on selection. Another writer's generation clears both
stacks and returns `CONFLICT`, including A→B→A; the same handle may continue after refreshing. A stale
caller token alone (e.g. drift this handle captured as its own entry) returns `CONFLICT` and keeps history.
History remains session-local. Its `retainedEntries()` pins undo and redo revisions for collection.
Snapshot handles do not pin indefinitely and may expire. The default history limit remains 50.

`createVibecodingSession({target}, {history, applyTurn})` delegates mutation/recording to the
project and owns notifications/cache invalidation. The default sequential core loop remains
appropriate for existing HTML targets. Tools are exported through `./session`, with no separate
`./tools` entry or additional mutation-controller lifecycle.

Deferred: execution, npm installation, preview/UI, compiler implementation, retained drafts,
capacity quotas/snapshot pinning, Git history and deployment. Native Mac/Windows acceptance and
test/build/typecheck execution are assigned to the reviewer by the build dispatch.
