Spec ID: SPEC-JINI-CLI-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:798babb07e320862e3b0161ea3457b77d18f34c6847c6b588155254303cd935b
spec_mode: reverse_spec


# CLI state contract

## Command registry

Each CommandRegistry owns an initially empty in-memory Map. add installs a handler and optional usage; duplicate names throw unless explicitly overridden. Replacement preserves that name's insertion position. names returns a fresh array. There is no remove, persistence, expiry, global singleton or concurrency lock.

dispatch awaits the selected handler and returns handled only after it completes. Multiple dispatch calls are not serialized by the registry. Hosts own handler concurrency and mutation policy. `CommandRegistryToken` is an identifier, not an instantiated registry.

## Transient I/O lifecycle

JSON HTTP calls create one internal abort controller and timer; the timer is cleared after fetch/body read, including failure. Streaming readers release their reader locks. Reader-lock release does not itself cancel a remote stream. The package stores no response cache or retry queue.

Local discovery reads an externally owned registry record on each invocation; it neither writes it nor starts/stops the recorded process. Missing/stale records yield null through the sidecar reader. Its closure fixes the selected registry path at construction.

Run watch maintains a decoded partial-frame buffer, writes arrived data, and ends on a terminal event or EOF. It does not persist a cursor, reconnect, deduplicate deliveries or own the run. A consumer passes its saved cursor through --after-cursor. No timeout or total lifetime ceiling is installed for watch.

Text intake retains chunks until EOF or size/cancellation failure; prompt stdin changes process.stdin's encoding. All stored command and I/O state is process-local and discarded on exit.

Evidence: `src/command-registry.ts`, `http.ts`, `local-daemon-discovery.ts`, `run-command.ts`, `prompt.ts`; static tests under `src/__tests__/`. No tests were run.
