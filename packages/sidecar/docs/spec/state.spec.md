Spec ID: SPEC-JINI-SIDECAR-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:9defcc02cd3aa41af50906e287f921aa8be34d7cb07db6c73ce9d2ac4fff9908
spec_mode: reverse_spec


# State Contract: sidecar

## Supervisor lifecycle

| Current condition | Trigger | Result |
|---|---|---|
| Cold/no live child | `start()` | Spawn attempt; a thrown spawn is reported without retry |
| Live child | Repeated start/ensure | Keep current child |
| Unexpected exit | Exit event | Policy retry timer or reported give-up |
| Queued retry | `ensureStarted()` | Preserve retry timing |
| Live child | `restart()` | Deliberate stop; one replacement after exit and termination completion |
| Failed/no pending work | `ensureStarted()` | Reset policy and spawn if cooldown permits |
| Any nonterminal condition | `shutdown()` | Cancel retry, mark terminal, request stop if necessary |
| Terminal | Start/restart/ensure | No resurrection; action methods return refusal |

State includes current child flags, retry cancellation, spawn count and last on-demand recovery time. Events from a replaced child cannot mutate its successor. There is no persistence, readiness state or awaitable shutdown result. All state is isolated per supervisor; constructing another supervisor creates a separate lifecycle.

## Policy and reservation state

The respawn policy owns a copied delay ladder, rolling timestamp array, consecutive port-conflict count and trip flag. `reset()` discards all failure history. It does not schedule, stop or persist anything. The caller's clock must supply meaningful millisecond ordering.

The supplied `Set<number>` receives allocated ports. It is never automatically released or persisted, and does not keep an OS listener bound. Share a set only among allocations that should avoid each other.

## Files and endpoint ownership

JSON state publishes via `<file>.<pid>.<uuid>.tmp` then rename. Readers see parsed data or `null`. There is no fsync, lock, journal, generation token, rollback or abandoned-temporary-file cleanup. Each write uses an independent UUID temporary name, including concurrent writes within the same clock tick.

Namespace pointer is `<namespaceRoot>/current.json`; run manifest is `<runtimeRoot>/manifest.json`. Paths do not create records. Pointer removal reads and compares `runId` and can race a new writer; consumers must serialize that operation externally. Daemon registry removal checks `pid`, atomically detaches a record to a unique tombstone, and rechecks its ownership before deletion. A captured foreign record is restored by hard link only if the public path is empty, without overwriting newer publication. Readers can temporarily observe an absent record during this operation. Restoration errors preserve the tombstone and propagate; process termination during cleanup can leave a recoverable tombstone.

Daemon registry defaults to `<dataDir>/daemon.json`; it survives process death. The reader validates fields and PID liveness but leaves stale records in place. Publish after the daemon listens; remove after stopping the owning process. The Node supervisor adapter supplies cleanup, not automatic publication or discovery-based process adoption.

Each IPC connection retains one frame and a deadline; the server handle owns a listener and Unix socket file. Closing waits for native server close and then removes the Unix path. It has no forced client cancellation or shutdown deadline. A module-wide trace counter supplies correlation IDs and resets on process restart.

Sources: [supervisor](../../src/supervisor.ts), [policy](../../src/respawn-policy.ts), [JSON files](../../src/json-file.ts), [registry](../../src/daemon-registry.ts), [IPC](../../src/json-ipc.ts).
