Spec ID: SPEC-JINI-SIDECAR-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4b7e5a369bdaea43575102eb9d0dee52fd684d1501468d03d9e9f9b9aa779da9
spec_mode: reverse_spec


# Behavior Rules: sidecar

## Precedence and defaults

WHEN resolving a namespace, the package shall choose explicit namespace, supplied environment value, then descriptor default. Unlike base/IPC resolution, omitted namespace environment does not implicitly use `process.env`.

WHEN resolving a base, the package shall choose explicit base, environment base, then `<projectRoot>/<projectTmpDirName>/<normalized source>`, with native absolute-path resolution. Default environment is `process.env`; default project root is `process.cwd()`.

WHEN composing launch environment, the package shall copy `extraEnv` (default `process.env`) and overwrite base/IPC/namespace/source with normalized values. Bootstrap shall validate app, derived IPC and conflicting IPC/namespace/source environment entries before mutating those three entries. It shall return the resolved base without writing that base back into the environment.

WHEN resolving a runtime namespace root in the caller-designated runtime mode, the package shall use the parent of `runtime.base`; otherwise it shall append the normalized namespace. Default log filename is `latest.log`; registry filename is `daemon.json`.

## Guards and I/O

IF an IPC path is empty, padded, contains NUL, or is neither absolute nor a Windows pipe, THEN normalization shall throw. Windows pipes are accepted by prefix; no additional pipe-name validation is supplied.

IF an app runtime filename is empty, contains NUL or a separator, THEN resolution shall throw. Dot segments and run IDs are not containment-validated; consumers own safe path segments and normalizers.

WHEN allocating a forced port, the package shall accept integers 1–65535, reject managed conflicts and bind failures, and add successful allocations to the supplied reserved set. WHEN allocating dynamically, it shall try at most 20 ephemeral binds, selecting the first port outside that set. Host defaults to `127.0.0.1`, label to `runtime`, and reservations to a fresh set. The probe listener closes before return: reservations are bookkeeping, not an OS lease.

WHEN reading JSON, any read/parse failure shall become `null`; generic `T` shall not perform runtime validation. Writes shall create parents, pretty-print JSON and publish by same-directory rename. Missing-file removals shall succeed; other removal errors propagate.

WHEN discovering a daemon, the package shall require nonempty URL/host/start timestamp strings, positive integer PID/port and a live PID. It shall treat signal-zero `EPERM` as alive. It does not parse URL/timestamp, cap registry ports at 65535, probe HTTP readiness, or prove PID identity beyond liveness.

## IPC framing and bounds

WHEN serving IPC, the package shall process only the first newline-delimited JSON frame on each connection, preserve split UTF-8 characters and ignore subsequent bytes after claiming a frame. Requests over the default 1,000,000 received-byte cap shall receive `FRAME_TOO_LARGE`; the check counts the entire arriving chunk before splitting at newline. The default 30,000 ms frame deadline shall destroy incomplete connections. Neither option is range-validated.

WHEN handling a valid frame fails, the package shall return `HANDLER_ERROR` with generic message and correlation `requestId`, logging redacted detail server-side. The handler has no execution timeout. The client defaults to a 1,500 ms deadline, forwards remote code/requestId on `Error`, and has no response-size cap. Client timeout does not cancel handler work.

WHEN preparing a Unix endpoint, the package shall remove only an existing socket whose connection probe returns missing/refused. Live sockets and regular files remain. Named pipes need no filesystem staging. The stale-socket probe has no configured timeout.

## Respawn and supervision

WHEN recording failure, the policy shall prune timestamps at or before `now - window`, append the current failure and apply consecutive port conflicts before the rolling crash cap. Defaults: delays `[1000,2000,4000,8000,16000,30000]` ms, window 60,000 ms, crash cap 5, port-conflict cap 3. Delay indexes use current retained count and saturate at the last entry.

WHEN resetting, the policy shall clear both counters and the trip flag. `isTripped()` remains true until reset; `recordFailure` itself does not enforce a latched prohibition against later retry decisions.

WHILE a child is live/stopping or a retry is queued, repeated start/on-demand calls shall avoid another child. Unexpected exit shall classify, report and schedule the policy decision. Spawn exceptions and process error events shall report without automatically retrying. Manual restart shall cancel retries, reset policy and wait for exit and termination completion before replacement.

WHEN on-demand recovery is accepted, it shall reset policy and enforce a default 30,000 ms cooldown between recovery attempts. WHEN shutdown is requested, the supervisor shall permanently refuse rearming and cancel pending retry. Shutdown returns before asynchronous termination finishes. Quiet mode suppresses the first spawn and deliberate exits, retaining respawns/failures.

The Node adapter shall use caller environment, detached children, piped output and process-tree termination, attempting group SIGTERM or Windows tree kill before its first await. Registry removal follows confirmed tree teardown.

## Deliberate exclusions and known issues

The package does not provide command schemas, capability negotiation, IPC authentication/replay protection, application readiness, launch authorization, durable retry state, or a global scheduler.

Malformed request JSON receives the actual parse diagnostic via the object-argument error helper ([json-ipc.ts](../../src/json-ipc.ts)). JSON writers use unique UUID temporary names. Daemon registry cleanup detaches a file, verifies the captured owner and restores a foreign record without overwriting newer publication ([json-file.ts](../../src/json-file.ts), [daemon-registry.ts](../../src/daemon-registry.ts)). Generic namespace-pointer removal remains read-then-remove and requires external serialization.

Evidence: [IPC/path/I/O characterization](../../src/__tests__/index.test.ts), [policy](../../src/__tests__/respawn-policy.test.ts), [supervisor](../../src/__tests__/supervisor.test.ts), [registry](../../src/__tests__/daemon-registry.test.ts). Tests were read, not executed.
