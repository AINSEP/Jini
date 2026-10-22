Spec ID: SPEC-JINI-SANDBOX-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4fc8f3e6630f285aff85157bef7d3bde67970709ca2752c6ab0ecd8180ba6471
spec_mode: reverse_spec


# State Contract: sandbox

## E2B session lifecycle

`provider construction → boot request → SDK sandbox created → project directory prepared → recursive watcher attached → session returned → teardown`.

Every boot creates another sandbox; there is no boot deduplication, session cache or reconnect registry. The wrapper owns file listener and tracked process sets plus one watch handle. Subscriptions add to a set and return deletion callbacks. Background output is delivered live, without replay or persisted history.

Files persist inside the remote sandbox for its backend lifetime. `mountFiles` overwrites supplied paths without clearing the root. Core permits preexisting files; callers must not infer the whole directory from their mount history. This package does not synchronize files back to the consumer or persist a snapshot.

`ProcessHandle.kill()` removes the process from tracking after backend kill succeeds. Failed kills remain tracked and are retried during teardown; successful VM termination clears any remaining tracking. Teardown attempts remaining process kills, stops watching and kills the VM. There is no closed flag: repeated teardown repeats watcher/VM calls, and methods/listener registration remain callable afterward. Consumers must enforce their own terminal session state and release subscription callbacks.

If SDK creation succeeds but directory/watcher setup fails, no automatic sandbox kill occurs and no session is returned. Consumers using an injected factory/handle should retain ownership for failed-boot cleanup. SDK credentials and session IDs are not persisted by this package.

## Worker invocation lifecycle

`budget validation → worker spawn → event registration → deferred deadline → first completion → cancel deadline → best-effort terminate`.

Each invocation creates a fresh worker; there is no pool or queue. Spawn failure rejects before a handle exists. Subscription/decoder/scheduler failure after spawn settles and requests termination. A settlement flag makes later messages/errors/exits no-ops for the result. Resource teardown can continue after the returned promise settles; the harness does not await confirmed exit.

Only the native factory's caller-owned environment/options survive between invocations. Payload is structured-cloned into `workerData`; no worker state, result cache or persistence is retained by the harness. Consumers provide any durable result storage and invocation idempotency.

Sources: [E2B provider](../../src/e2b/provider.ts), [session](../../src/e2b/wrap-e2b-sandbox.ts), [worker harness](../../src/node-worker.ts).
