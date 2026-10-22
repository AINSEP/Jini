Spec ID: SPEC-JINI-MEMORY-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5840d5c4e57d8ae67d89dd84aa7cfddd4e200295636e61686664298fc6181216
spec_mode: reverse_spec


# State contract: memory

## Durable note collection

Each method's `dataDir` selects `<dataDir>/<subdir>`. Construction creates no files. Entry files are `<id>.md`; `INDEX.md` determines active membership; `.config.json` holds enabled metadata. Removing an index bullet disables selection without deleting content. No filesystem watcher emits events for external edits.

Upsert writes entry → index → readback → event. Delete attempts unlink → index removal → event; unlink errors are swallowed but index-write errors reject. A failed multi-file operation has no rollback. Repeated upsert converges on content/ID but changes timestamps and can emit again. Concurrent index writers can lose updates.

`deriveId` prefixes the type to a lowercase underscore slug capped at 48 characters; a name with no ASCII slug uses deterministic FNV-1a fallback. Hash/slug collisions are possible. Renaming with an explicit ID retains the filename. Tree folders are derived views; no folder storage or mutation exists.

## Ephemeral attempt logs

| Module | Lifecycle | Retention / notifications |
|---|---|---|
| `ExtractionLog` | start → running → success/failed; skip and heuristic calls create terminal records directly | Newest-first, at most 20; preview 120 chars, error 240 chars, written IDs at most 12; deferred `attempt` events |
| `VerifyLog` | record missing/fail/pass; skipped returns null | Newest-first, at most 20; deferred `verify` events |

Both use separate emitters with listener-warning threshold 64, default UUID IDs, epoch-millisecond clocks and `setImmediate` deferral. Unknown IDs are no-ops; remove returns 0/1, clear returns removed count. Deletion/clear emit lifecycle notifications, not retained records. There is no durable audit log or restart recovery.

Extraction updates can overwrite any retained phase, including a completed record; evicted records cannot be updated. `list()` deep-copies extraction records. Deferred emission closes over mutable records, so updates in the same tick can change an earlier scheduled payload; events are not coalesced.

Verify record/list copies are shallow: nested `uncoveredRules` arrays remain shared. A consumer must not mutate returned nested data. No log API is a thread/process synchronization primitive.

Evidence: `src/note-store.ts`, `src/extraction-log.ts`, `src/verify.ts` and their source tests.
