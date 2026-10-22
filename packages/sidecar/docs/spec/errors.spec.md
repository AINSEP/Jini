Spec ID: SPEC-JINI-SIDECAR-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:beaaaae9e6fd95998e3e78fa14bda1bd632c924e2aec4ae5dc3df339de9b2d09
spec_mode: reverse_spec


# Error Contract: sidecar

## Error mapping and caller action

No package-specific error class is exported. Most operations throw/reject `Error`, `RangeError`, or native Node errors; do not invent machine codes for message-only failures.

| Surface / class or code | Condition | Caller action |
|---|---|---|
| Path helpers / `Error` | Invalid project/data root, IPC shape or simple filename | Correct configuration before retry |
| Descriptor normalizers / caller-defined error | Invalid app, source, namespace or stamp | Handle the descriptor's validation contract |
| Bootstrap / `Error` | App, IPC or canonical environment mismatch | Reject launch; align identity and environment |
| Port allocation / `Error` | Invalid integer, reservation conflict, bind failure or 20 dynamic conflicts | Correct port or choose another; no stable package code |
| JSON write/remove and IPC listen / native error | Permissions, path collision, unavailable filesystem/socket | Handle native `code`; provision writable isolated paths |
| Respawn factory / `RangeError` | Empty/nonfinite/negative delays; nonpositive/nonfinite window; nonpositive or unsafe-integer thresholds | Correct options |
| Supervisor factory / `RangeError` | Negative/nonfinite on-demand cooldown | Correct options |
| Supervisor action result / `{ok:false, reason}` | Terminal shutdown or on-demand cooldown | Respect terminal state or wait; no exception |
| Supervisor failure reporter / message | Spawn/stop failure, unexpected exit or policy give-up | Surface reason; manually recover only if host policy permits |
| Node termination / `Error` | Process tree still has remaining PIDs | Report failed cleanup; do not assume replacement is safe |
| IPC remote / `Error.code = 'FRAME_TOO_LARGE'` | Received request bytes exceed server cap | Reduce payload or explicitly configure a valid cap |
| IPC remote / `Error.code = 'HANDLER_ERROR'` | Handler or success serialization throws | Correlate `requestId` with host logs; retry only if handler is safe to repeat |
| IPC remote / message-only `Error` | Malformed JSON or untyped peer failure envelope | Treat as protocol failure; malformed-request detail is the serialized SyntaxError message |
| IPC client / message-only `Error` | Deadline expires (`IPC request timed out: <socketPath>`) | Check server/liveness; work can still be running |
| IPC client / native error | Missing, refused or inaccessible endpoint | Rediscover endpoint or fix permissions |

Injected scheduler/classifier/logger/reporter/cancellation failures are not generally normalized; their errors can escape synchronous supervisor calls or asynchronous event callbacks. Supply ports that do not throw during lifecycle reporting.

## Non-throwing absence

`readJsonFile` returns `null` on any read/parse failure. `readLiveDaemonRegistryRecord` returns `null` for invalid/stale records. Liveness returns false for invalid PID/unconfirmed existence, true on `EPERM`. These are absence signals, not detailed diagnostics. `removeFile` ignores missing paths only; it is not an all-errors-swallowing remover.

The client decorates remote failure with optional `code` and `requestId`, preserving generic `Error`; it does not expose an HTTP status or response envelope. Response JSON/schema handling is not a validated codec. Non-JSON-serializable payloads and malformed peer replies require host containment; serialization/parsing occur inside socket callbacks.

Sources: [IPC](../../src/json-ipc.ts), [paths](../../src/paths.ts), [port](../../src/port.ts), [policy](../../src/respawn-policy.ts), [supervisor](../../src/supervisor.ts).
