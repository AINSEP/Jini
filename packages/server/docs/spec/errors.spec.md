Spec ID: SPEC-JINI-SERVER-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d629b09d9523bc621ece0cbbdea4fc5163f6f2dde1354031a839acaac95ea9c0
spec_mode: reverse_spec


# Error contract: @jini-ai/server

## Construction and configuration

| Class/code | Trigger | Consumer response |
|---|---|---|
| `SqliteBackendConfigError` (no code) | Unknown backend kind; postgres missing host/database/user | Correct environment map before boot; no unchanged retry |
| Ordinary Error from activation | Duplicate/unknown feature, unknown capability, explicitly enabled denied feature, unknown/inactive required feature | Repair configuration; capabilities do not authorize fallback activation |
| Ordinary Error from feature composition | Selected feature missing required host collaborator or incompatible storage | Supply required featureOptions or disable feature |
| Core registry/binding errors | Duplicate tool ID or missing pack binding | Repair declarations/bindings; do not discard an earlier registration |
| Driver/storage errors | Opener, DDL, connection, corrupt history or rehydration failure | Inspect original failure; acquired resources are cleaned up on the documented boot path |
| Node listen codes `EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL` | Port collision, denied or unavailable bind | Select valid host/port or correct host permissions; preset tears down failed composition |
| Ordinary Error for unresolved bound port | Listener returned no usable TCP port | Diagnose host listener setup; do not advertise a guessed URL |
| Ordinary Error from legacy openDatabase | options.open missing | Inject a SqliteSyncOpener; driver is not loaded automatically |

No package-wide error envelope/code union exists. `SqliteBackendConfigError(message: string)` is the only error class exported by this package's own storage selection module. Root concerns expose lower-level exceptions without translating all of them into a new server class. Optional arguments are not yet split for this constructor.

## Shutdown and HTTP boundaries

closeHttpServer can reject the Node close callback's error; it can also resolve at the force-close deadline. A failed onShutdown rejects stop after base cleanup. Concurrent stop calls observe the same settled outcome. Signal-driven stop failures are logged and passed to onExit(1), rather than returned to the signal sender.

Discovery errors are swallowed by the preset's explicitly best-effort write/remove paths. Feature/caller-pack disposal uses the core best-effort disposer. Host frontend bind errors are reported through onBindError without failing the run; callers must not treat a successful run start as proof the browser binding succeeded.

Strict bearer middleware, owned by http-kit, returns 503 for an unconfigured required token and 401 for a missing/invalid credential. Other HTTP validation, origin, authorization and tool execution responses belong to mounted route packs; this package does not replace their error envelopes or add a general retry rule.

Legacy project/storage functions otherwise propagate SQL, filesystem and JSON serialization failures. Unknown project IDs return null on get/update and deletion is a no-op. No owner-denial exception exists in these unscoped adapters; authorize before calling.

Evidence: storage backend-config, acquisition ownership tests, activation/composition tests and graceful-shutdown tests. No tests or runtime verification were executed.
