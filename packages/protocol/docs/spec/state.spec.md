Spec ID: SPEC-JINI-PROTOCOL-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a1cd669d73874a8527dae5f765a59c7d2e48c6af6adb96e0648eb2f14bcf9972
spec_mode: reverse_spec


# Protocol state and persistence contract

## Ownership

The package defines state shapes and the EventLog storage port. It contains no mutable store, queue, cache, supervisor or persistence implementation. A consumer supplies an EventLog and RegistryBackend with its own durability and retention policies.

## EventLog lifecycle

| Operation | Contract |
|---|---|
| `append({runId,event,data}, {dedupeKey?})` | Assign a monotonic per-run cursor and epoch-ms recordedAt; return the recorded entry |
| Duplicate append | Same run and same dedupeKey return the original entry unchanged; different runs have independent dedupe domains |
| `replay({runId,afterCursor:null})` | Return retained entries from their beginning; if earlier records were evicted, report `ok` with `truncated:true` rather than replay-gap |
| Replay after cursor | Return entries after that position in order; distinguish invalid cursor from an evicted replay range |
| Unknown run | Return `{kind:'unknown-run'}` rather than fabricate records |
| Replay gap | Return requestedCursor and oldestAvailableCursor (nullable); caller chooses full resync or explicit error |
| `listRunIds({})` | List runs with retained state for host rehydration |
| `drop({runId})` | Discard retained state for the run |

The contract specifies no maximum log length, retention duration, global cursor order, cursor numeric width, dedupe lifetime after eviction, cross-process locking, or transactional relationship with another store. Those must be agreed with the chosen adapter. No state transitions are enforced by the TypeScript interface.

## Other state vocabulary

`RunStatus` names queued/starting/running/succeeded/failed/cancelled; terminal membership is implemented, but transition policy and restart recovery belong to the lifecycle implementation. Run-start idempotency metadata describes reuse of an existing run rather than creation of another; the package does not maintain that index.

`RunEvent.eventId` identifies a delivery, while `opaqueCursor` identifies a replay position. Consumers own at-least-once deduplication and persistence of their last cursor. `durability` permits durable and ephemeral; this package implements neither channel.

Registry publish/yank and verification metadata describe backend state without selecting a persistence format. No default backend or credential store is created on import.

Evidence: `src/event-log.ts`, `run.ts`, `events.ts`, `registry.ts`; `src/__tests__/event-log-contract.test.ts` confirms port signatures statically and does not demonstrate a storage implementation. Tests were not run.
