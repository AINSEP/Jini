Spec ID: SPEC-JINI-DEVOPS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:897d113094f9b407dc03665b22dbb520ab189382402e37d2fb311b237005453d
spec_mode: reverse_spec


# DevOps lifecycle and persistence

## Provider registry and deployment

Each registry load builds a new ordered snapshot of loaded modules, refusals and inactive ids. No hot reload, module unload or durable registry is implemented. Array freezes are shallow; switchedOff is a mutable Map exposed as ReadonlyMap by its type. Provider operations own their remote state.

Reachability lazily creates a process-wide undici dispatcher for the default DNS lookup. Overrides create separate dispatchers. No exported dispatcher close/reset exists; callers cannot infer instance-only state. Polling state is per call; it is not persisted.

## Export sessions and staging

An export transitions validation -> output preparation -> manifest -> app open -> routes -> assets -> inventory -> app close. Opened sessions always reach finally; a close failure rejects. Artifacts persist in host outputDir; there is no export rollback. Clean removes prior contents only through an explicit writer option. Reports retain written bytes in memory. Commit/preview use isolated host layout directories, export with clean true and request best-effort cleanup before returning retained bytes or committing them.

Packaging functions mutate only the paths/inventories supplied by the host. Dependency/native/payload planning guards precede the relevant copy/removal phase, but mutations are not atomic and interrupted staging can leave partial output. Hosts own staging exclusivity and post-package verification. Snapshot/freshness checks retain no watcher or background state.

## Agent-job artifacts

Per job: existing `.md` -> skipped; otherwise clear `.jsonl`/`.err` -> run -> decode -> success `.md` or failure `.failed`. A successful retry removes stale failure marker; a failed retry removes success marker. Results follow original job order despite worker concurrency. No durable queue lease, claim file, restart supervisor or cross-batch mutex exists; the host must prevent concurrent batches sharing outputDirectory. A success marker's existence is sufficient to skip, regardless of prompt/model changes.

Node CLI runner owns each spawned child and two log streams for one run; it resolves after the child and streams complete, killing the child on pipeline/input errors. It has no deadline or externally callable cancel operation. Job artifacts survive process exit; library scheduling state does not.

## Published-types shadows

Compile checks acquire a unique scratch directory, then acquire ownership of a nearer scope directory with createDirectory. Existing scope paths are never replaced. The shadow is removed after compilation, scratch after operation completion; a newly created node_modules parent is removed only if still empty. Cleanup errors are reported as operational failures. Host must prevent overlapping external checks; the package serializes projects only within a call. Coverage baselines are parsed/serialized values; only consumer filesystem calls persist them.

Environment-file loading intentionally mutates Node's process environment through the selected adapter. Listener queries and pure checks retain no cache.
