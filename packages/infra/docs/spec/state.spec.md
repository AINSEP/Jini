Spec ID: SPEC-JINI-INFRA-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:3d69a559eda4ca001a160c36f6d40b2129587df27915e8836cc209a327c8e161
spec_mode: reverse_spec

# State Contract: @jini-ai/infra

## Ownership

The compatibility layer itself has no state. The consumer owns the opened SQLite connection, lifecycle, path, recovery policy, transaction coordination, watermark, and snapshot retention. `SqliteDbOpsAdapter` retains those dependencies plus an optional clock callback; it supplies no shutdown method.

## Persistence lifecycle

```text
optional recovery -> host opens connection -> sequential pragmas -> consumer uses connection
capture -> read watermark -> backup file -> return artifact reference
file restore -> verify artifact accessible -> copy temporary sibling -> rename live file
             -> attempt WAL/SHM deletion -> restartRequired: true
```

Snapshot filenames include sanitized scope, watermark, and timestamp. Repeating a capture with the same values can select the same filename; there is no collision guard or unique-ID generator. Artifacts remain until the consumer deletes them.

File restoration replaces bytes on disk while retaining the old in-process connection reference. The host must stop writers and close/reopen or restart. No directory fsync, distributed lock, integrity validation, or transaction across backup and watermark is supplied.

An in-memory database captures a file in the temporary directory, but restore is a no-op with `restartRequired: false`. It does not replay that snapshot into memory.

Internal outbox source is not a public stateful module in this release because the export map exposes only database shims. Evidence: `src/db/*/index.ts` and delegated db operations. No runtime verification was performed.
