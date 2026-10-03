Spec ID: SPEC-JINI-DAEMON-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:c3609a7958385603e442ccf0492a5c8ec121e5d8e1838374c2f2226881573d26
spec_mode: reverse_spec


# Error contract: @jini-ai/daemon

## Exported classes and codes

| Class/code | Trigger | Caller action |
|---|---|---|
| AgentExecutorError / AGENT_NOT_FOUND | Runtime lookup has no matching agent | Refresh runtime inventory; correct agentId |
| AgentExecutorError / AGENT_RUNTIME_UNSUPPORTED | Definition cannot be driven with a supported stream format | Choose a supported runtime |
| AgentExecutorError / AGENT_BINARY_NOT_RESOLVED | Launch/help resolution cannot find a usable binary | Correct installation/launch configuration |
| AgentExecutorError / AGENT_SPAWN_FAILED | Child spawn/dispatch setup fails | Inspect launch/cwd/permissions and cause text |
| AgentExecutorError / AGENT_PROMPT_TOO_LARGE | Prompt/argument budget cannot be delivered safely | Shorten input or use a supported staged-delivery runtime |
| RunContextNotBoundError(runId) | Context store resolve has no live binding | Bind authenticated run context before use; do not guess another context |
| ScheduledRunPersistenceError(routineId, slotAt, originalError) | Scheduled run slot cannot be persisted | Repair persistence; scheduler can retry the same slot |
| LegacyMigrationError / symlink_in_payload | Payload traversal encounters a symlink | Supply real files or exclude the symlink; inspect destination after rollback |
| LegacyMigrationError / legacy_dir_invalid | Legacy path is invalid for migration | Correct source/proof configuration |
| LegacyMigrationError / data_dir_not_empty | Destination payload appeared or cannot safely be replaced | Preserve destination; choose an empty destination |
| AgentSessionStoreError / invalid-input | Invalid kernel supplied during adapter construction | Correct dialect/transport/required kernel shape |
| AgentSessionStoreError / unavailable | Session-store driver/query operation fails | Inspect cause; repair storage; do not treat as absent session |

AgentExecutorError exposes code/message, LegacyMigrationError code/message, ScheduledRunPersistenceError routineId/slotAt/originalError, RunContextNotBoundError runId, and AgentSessionStoreError code/cause. No common daemon error superclass exists. The driver tries to emit/finish a failed run before rejecting; failures in injected lifecycle/cleanup collaborators can themselves escape, so consumers shall not rely on every rejection being AgentExecutorError.

## Result channels and untyped failures

| Boundary | Observable failure | Caller action |
|---|---|---|
| EventLog replay | unknown-run, invalid-cursor or replay-gap result; SQLite malformed cursor throws Error | Establish a fresh subscription or replay from retained history; validate cursor first |
| EventLog append/open/close | Original SQL/opener/serialization error | Handle persistence failure and preserve its cause; do not acknowledge an unpersisted event |
| Lifecycle get/list | Absence/empty list | Treat as missing cached run |
| Lifecycle emit/finish/cancel/wait/resume/listeners | Error on unknown/invalid lifecycle operation; original log failure | Check run state and retry only an appropriate idempotent operation |
| Stream | Replay failure union or thrown collaborator/callback failure | Surface replay gap; detach/reattach explicitly |
| Tool execute | denied/confirmation-denied/timed-out/cancelled/failed result | Map distinct outcomes without rerunning denied work; validation can prompt input correction |
| Tool execute unknown ID | Error before execution/audit | Correct registry/tool ID |
| resumeConfirmation | Error when there is no pending confirmation | Treat stale decisions as conflict; do not execute independently |
| Frontend registry | Error for missing/disconnected session, invalid token, missing capability, delivery failure or refused invocation | Rebind an authenticated session or surface refusal; no fallback to another browser |
| Frontend capability handler | Error for scalar/array input (null becomes empty object) | Supply an object |
| Terminal manager | not-found result for unknown/foreign session; PTY/service errors propagate | Preserve ownership boundary; correct runtime/native-addon setup |
| Routine validators/scheduler | Error for invalid schedule/target, missing routine or unset run handler; handler failures recorded/rethrown according to path | Validate at ingress and install a handler before execution |
| Schedule timezone helpers | Invalid timezone may throw RangeError; tzWallToUtcCandidates catches and returns [] | Validate timezone before scheduling |
| Migration helpers | Original filesystem/marker error after rollback attempt | Inspect source/destination; repair I/O before retry |
| RunByteJournal.record | Original EventLog append rejection | Handle persistence failure; record is not guaranteed to resolve |

`MCP_BRIDGE_UNAVAILABLE` is an exported run protocol error marker, not an AgentExecutorError code. Derived analytics codes such as AGENT_EXIT_<code>/AGENT_SIGNAL_<signal>/AGENT_TERMINATED_UNKNOWN describe outcomes; they are not thrown exception classes. Error text is diagnostic and is not a stable machine code unless listed above.

## Attachment reason mapping

| Reason | HTTP/code when the attachment HTTP boundary handles it | Recovery |
|---|---|---|
| `invalid-batch`, `empty-attachment`, `invalid-cleanup-request` | 400 BAD_REQUEST | Correct batch/body/payload. Empty upload uses a direct BAD_REQUEST result. |
| `attachment-too-large`, `batch-count-exceeded`, `batch-too-large`, `storage-full` | 413 PAYLOAD_TOO_LARGE | Reduce files/bytes or free pending storage. |
| `too-many-concurrent-uploads` | 429 RATE_LIMITED | Wait for another upload to finish. |
| `too-many-attachments`, `duplicate-attachment`, `attachment-unknown-or-claimed`, `mixed-batch` | 400 BAD_REQUEST | Correct claim; unknown and already-claimed share a refusal. Claims normally run outside this HTTP pack. |
| `attachment-body-consumed`, `attachment-integrity` | 500 INTERNAL_ERROR with generic text | Fix parser ordering or investigate file replacement/containment; private details go to sink. |

Recognized non-500 rejection messages are disclosed. Filesystem failures are redacted by the HTTP wrapper; direct filesystem/store APIs still reject with raw errors.


## Dedicated entry failures

Surface invalid deadlines or empty/duplicate IDs throw Error; send after termination throws Error. Delivery refusal is a result, while receive expiry/abandon is a normal terminal message. Emit/scheduler/clock/ID failures propagate unless the named outcome helper explicitly contains them. Coordination propagates host critical-section/lifecycle failures and always cancels its wait timer. Audit sink/reporter failures are contained, but required ID/time provider failures can propagate. Run credential mint for nonlive runs and empty/duplicate minted values throw Error. Malformed encoded route IDs become BAD_REQUEST/400; unconfigured daemon bearer yields 503, invalid bearer 401, denied route 403 and foreign/unknown-owned run 404. No automatic retries occur.

## Audit sink contract discrepancy

`ToolAttemptAuditSink.append(required, optional?)` declares `detail` in its optional second object, but `appendSafely` currently passes the complete event as the first object and omits the second. A sink reading the declared optional object loses the detail. Audit failures remain contained. This is a current implementation discrepancy, not a promise that all conforming sinks receive detail. Evidence: [tool-audit.ts](../../src/tool-audit.ts), lines 25 and 38.
