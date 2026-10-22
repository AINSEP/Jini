Spec ID: SPEC-JINI-MCP-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:9f5ec47c3cc73f819889925b8d86d0cffc3a9eeb0392db1083f9f0e9c8057886
spec_mode: reverse_spec


# MCP state and persistence contract

## On-disk config and tokens

Config persists at `<dataDir>/mcp-config.json` as `{servers:[...]}`. Tokens persist at `<dataDir>/mcp-tokens.json` as `{servers:{id:token}}`. Each module has its own process-local promise chain keyed by the exact dataDir string. A failed write does not block the next queued write; the final settled lock is removed.

Config writes sanitize and replace the whole config. Token set reads then merges one record under lock; clear reads then deletes and skips writing when absent. No read lock, cross-process mutex, transaction spanning the two files or encryption is supplied. Equivalent filesystem paths spelled differently have independent locks. Missing/corrupt stores read as empty and subsequent writes can replace them.

Default writes create parents, exclusively create a same-directory temporary file, verify POSIX owner-only bits and rename. Failure attempts temporary cleanup while preserving any previous destination. Atomic replacement does not promise crash-durable fsync. Injected filesystem ports own the equivalent persistence guarantee.

## Hosted server and idle controller

Server construction snapshots name/URI indexes; each run resolves one base URL and opens a transport. It installs request handlers and tracks activity/in-flight calls. Idle or stdin end/close asks the transport to close; transport close resolves run. Idle timers are disposed in finally. Calling run repeatedly starts separate lifecycles; no single-run guard or explicit handle.stop is exposed.

Idle controller starts live with one timer and zero in-flight requests. noteActivity resets the timer. trackRequest increments/decrements in-flight state and resets the timer when the last request ends. Timer expiry while busy reschedules; idle expiry marks disposed and invokes onIdle once. dispose cancels the timer; later tracked functions still execute without idle tracking.

Compiled JSON-schema validators are cached in a module WeakMap keyed by tool-definition identity. Mutating inputSchema on a reused tool object does not invalidate that cached validator; hosts must treat definitions as immutable. Resource indexes and tool lists have no refresh protocol.

## Federation session lifecycle

Stdio session construction registers channel listeners; connect completes initialize/initialized before returning it. It holds a numeric request id counter, pending request map and per-request timers. Matching response settles one request; timeout/cancel rejects it and removes timer/listener; close rejects pending requests and closes the channel. Child channels buffer complete lines and maintain a redacted stderr tail. No process restart/reconnect policy is included.

HTTP session holds request counter, negotiated identity and first accepted session id. POST calls obtain fresh credentials and carry protocol/session headers. close is locally idempotent, marks closed and best-effort DELETEs remote state; that DELETE has no request deadline. No token or remote-response cache is installed.

## Presets, admission and reload

Preset registry is a module-local ordered array. Same presetId replaces in place; reset discards all presets. list returns a readonly view of the live array rather than an isolated immutable copy. Resolver returns a connection or null; bootstrap isolates each resolver/connection failure.

Bootstrap attaches sequentially and returns live sessions, registered ids and admission/failure reports. Host owns session cleanup at shutdown. A tool's advertised name/schema/hints used at admission are not periodically re-listed. Revocation works through a host-injected per-call gate, independent of this frozen catalog.

Reload coordinator owns admitted connection ids, an in-flight promise and at most one queued trailing pass. It re-reads roster per actual pass, attempts only new/unadmitted ids, and records ids with reports even when zero tools were admitted. Failed connections remain retryable. An admitted id stays skipped until a new coordinator/process; widening/changing that connection needs fresh admission after restart. admittedConnectionIds returns its live set as readonly.

**Ownership gap:** reload discards attach's sessions and exposes neither close nor a session collection. A host requiring shutdown ownership must capture them in its injected attach/connect wrapper; no automatic lifecycle cleanup is supplied by the coordinator.

## Approval storage

Always-approval repo keys are optional opaque scope/serverId/toolName; upsert replaces the record. Fingerprint includes versioned canonical identity and changes on tool drift. Chat store keys are conversationId/principalId/connectionId/toolName, with fingerprint as the current granted value. A new fingerprint replaces a prior one for that tuple in the in-memory adapter. grantedAt is accepted by the chat port but not retained by this memory adapter.

These stores are host-owned ports. Testing adapters retain state only in Maps with no TTL, persistence or cleanup operation for chat grants. Always repo exposes delete and listByScope. In-memory upsert shallow-copies, while find/list return retained record references. Approval lookup errors fail closed; persistence failure after explicit approval does not revoke the current call.

## Ask-choice tickets and exchanges

Ticket adapter creates a private Map per factory instance. mint sweeps entries at or past expiry, requires a non-empty unused id, snapshots question and stores principalId/expiresAtMs. redeem deletes a found ticket before checking principal, time and option binding. Unknown tickets return false; any attempted redemption burns a found ticket. There is no periodic sweep, capacity bound, persistence or explicit reset/dispose.

Live exchange state belongs to the injected host store. Tool opens with tool/principal/emitter, emits one mcp-ui resource, receives an answer and closes in finally or on abort. Host adapters must correlate answer/principal/tool/execution, enforce single delivery and timeout, and wake receive when closed. The package supplies no exchange-store implementation.

Testing sessions/channels/exchanges collect calls/messages. InMemoryMcpSession close only marks a boolean: it does not prevent later calls/listTools, and ignores cancellation. These doubles are deliberately distinct from production session lifecycle guarantees.

Evidence: core/config/tokens/secure-write, client/client, server/tool-server/tool-protocol, federation bootstrap/reload/adapters/testing/approvals and tools/ask-choice/pending. Static tests were read; no runtime checks were run.
