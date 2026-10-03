Spec ID: SPEC-JINI-PLATFORM-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e60717b8977a9b7d9afd609517f9284d508cb3c709fea57847522ace56727f44
spec_mode: reverse_spec

# State Contract: @jini-ai/platform

## Terminal sessions

Each service owns a Map of sessions and a cached PTY-loading Promise. Concurrent initial create calls share one loading attempt; success stays cached and rejection clears the cache so a later create can retry. The service persists no metadata or scrollback and inherits the host process environment when spawning.

```text
create -> running -> exit/forced finish -> exited -> TTL removal
```

Each session has monotonic event IDs starting at 1. Output coalesces on a 16 ms timer or at 64 KiB UTF-8 byte threshold. Defaults: maxEvents 2000, maxBufferBytes 512 KiB, exitTailBytes 64 KiB, exit TTL 30 minutes. Byte counts use UTF-8 encoding; buffer trimming removes oldest events toward 75% of the limit but retains at least the newest record, which can exceed the ceiling. Exited tail trimming can also retain a chunk larger than its nominal bound.

Attach replays IDs greater than the cursor, then subscribes while running. Nonfinite cursor replays all retained events. Exited attach guarantees a final retained event even when the cursor is beyond it, ends the sink, and returns ended. Detach removes the sink without terminating the PTY. No replay-gap signal is returned when old scrollback was evicted.

Finish flushes pending output, records exit, ends all sinks, and schedules TTL deletion. Kill normally waits for backend exit; a kill exception forces an exited state and returns false. Shutdown sends SIGTERM and marks sessions exited immediately; it does not prove child termination, escalate to SIGKILL, or await backend exit. Configured default grace is 3000 ms, but the actual wait is capped at 1000 ms. The consumer owns reliable OS cleanup.

## Managed downloads and asset cache

Managed download store persists `.jini-download-root.json`, completed bucket files, `.state` manifests, `.partial` bytes, and `.locks` records. Manifests use schema version 1 with URL/identity digest, checksum, target identity, partial/complete state, timestamps, optional validators and length. Completed bytes are reused only after identity/checksum reconciliation. Resume can continue a partial file or discard/restart it after validator/range mismatch.

In-process task/target Maps share identical downloads and reject active identity conflicts; they disappear after task settlement. Caller abort removes that wait/subscription without cancelling the shared transfer. Cross-process lock lifetime encloses the transfer; stale/dead-holder recovery and completion release are implemented. Copy leases defer requested cleanup until local copies finish. Partial state supports restart; no retention timer runs automatically. Explicit prune defaults to 24-hour age. Request credentials are not a durable identity/admission mechanism.

Asset cache stores SHA-256 URL-named blobs with `.json` content-type sidecars; in-flight promises are scoped per cache instance. Successful fetches may be served even when disk persistence fails. Blobs are temp-renamed, but metadata is written separately; torn/missing pairs become cache misses. Disk hits do not revalidate URL/DNS/size and have no TTL or quota. There is no exposed dispatcher disposal method.

## File JSON, secrets, blobs

Durable JSON persists the caller's file, a PID-named temporary sibling, a token-owned `.lock`, and quarantined `.corrupt-<time>` files. Reads never automatically replace corrupt data. Write is separate from lock acquisition; the caller must wrap shared critical sections. File fsync precedes rename; parent-directory fsync follows rename. Owned temporary files are cleaned on failure before rename; directory-sync failure is observable after replacement. Shared locks verify token and inode/device ownership, with a residual check-to-unlink race.

EnvOrFileKeyring requires explicit fallback/generation booleans and an injected environment reader at construction. It loads/caches root bytes on first derivation, preferring a truthy injected environment value over a file only when fallback is permitted. Later env/file changes are invisible to that instance. activeKey returns only configured keyId. Explicit file generation is exclusive; automatic generation is permitted only when both required flags are true; when a file is absent that generation is not concurrency-safe exclusive creation. In-memory keyrings choose random roots and lose decryptability across recreated instances unless ciphertext is opened with the same material/context.

Sealed records carry algorithm/keyId/nonce/ciphertext+tag, not root bytes or AAD. The consumer persists records, historical HKDF salt and AAD convention, and the root key needed to open them. There is no automatic key history/rotation/migration. Inspect/reveal read currently configured material rather than a keyring instance's cached root and can diverge after changes.

Memory credential-set rows live per repo, keyed by workspace/id; label/default rules operate within workspace/vendor. Inserts/updates shallow-copy records, while reads/lists expose internal row objects and nested sealed values. Deleting a default promotes the latest updatedAt remaining record; no persistence or encryption workflow is supplied.

LocalBlobStorage persists under root/namespace/path; S3BlobStorage persists at configured bucket/prefix/namespace/key. They open no database or background worker. Writes overwrite, missing deletes are idempotent, and no lock/version/transaction or retention is supplied. The consumer owns root/bucket permissions, path policy, credentials, network deadlines, and quotas.

## Mail

Mail gate is a forwarding wrapper; each call consults current readiness and stores nothing. SMTP stores its transport and clock, with no send ledger, dedup/suppression state, feedback store, queue, or retry worker. Idempotency fields do not make SMTP sends idempotent. The consumer owns transport shutdown and durable delivery handling.

