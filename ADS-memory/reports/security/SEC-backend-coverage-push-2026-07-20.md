# Security review — backend coverage push (2026-07-20)

**Reviewer:** Security (Execution)  
**Scope:** Coverage-push commit `7a4a94159` (`HEAD^..HEAD`), as described by `session-handoff-2026-07-20-coverage-push.md`, plus the directly connected trust boundaries needed to judge whether the new tests pin secure behavior. Frontend was excluded. The separately owned download-test issue was not reviewed.

## Executive assessment

The affected suites are broad and generally careful about malformed input, lifecycle races, platform differences, and cleanup. However, the backend is **not ready to be treated as a hardened agent host**. I found **1 High and 6 Medium** security issues. The highest-risk issue is wholesale daemon-environment inheritance by agent subprocesses, directly contradicting locked architecture decision C8. Several new tests also codify unsafe disclosure of raw internal error text instead of protecting the public boundary.

No Critical finding was identified. The High finding requires human sign-off if it is accepted or deferred. The Medium findings do not require sign-off under the Security persona policy, but should be tracked and fixed before the affected boundary is exposed to untrusted callers.

## Trust-boundary map

| Boundary | Untrusted/less-trusted input | Privileged destination | Existing controls | Main gap |
|---|---|---|---|---|
| HTTP run API | Local browser/client requests | Run lifecycle, agent driver, event log | Node host installs bearer auth and origin guard before routes | Raw exception disclosure; unbounded SSE buffering/backpressure |
| Agent subprocess | Prompt-influenced coding agent/runtime | Host environment, filesystem, child process tree | Controlled spawn API and descendant-tree stop port | Whole daemon env inherited; cleanup failures unobserved |
| OpenCode log parser | Provider log containing embedded request body | User-facing service failure | Status/message classification and keyword gate | New fallback bypasses the anti-masquerade gate |
| Deployment reachability | Provider-returned URL/alias | Host outbound network | Timeout and manual redirect handling | No private-address or provider-domain restriction |
| Sidecar IPC | Local socket client and NDJSON frame | Host-supplied handler/capabilities | Filesystem socket path, timeout on client side | No authentication/replay protection, no frame bound, duplicate dispatch possible |

## Findings

### SEC-001 — High — Agent subprocesses inherit the daemon's complete environment

**Evidence**

- `packages/daemon/src/agent-executor.ts:763-781` uses `input.env ?? process.env` for both launch resolution and the spawned process environment.
- `packages/node-host/src/create-local-node-daemon.ts:221` constructs the default executor without an environment sanitizer.
- `packages/daemon/src/__tests__/agent-executor.test.ts:136-163` injects `applyAgentLaunchEnv: (env) => env`; the suite checks spawn/cancellation mechanics but does not prove daemon/API/provider secrets are removed.
- Locked architecture decision C8 (`ADS-memory/reports/jini-port/extraction-plan.md:203`) explicitly requires scoped credentials/allowlisted environment rather than wholesale inheritance.

**Impact and exploit path**

A prompt-injected, malicious, or compromised coding-agent runtime can inspect its own environment and exfiltrate values such as the daemon bearer token, unrelated provider keys, database URLs, cloud credentials, and host-specific secrets. This turns an expected subprocess execution capability into access to credentials that were never delegated to the run.

**Required remediation**

Build the child environment from a deny-by-default allowlist (for example, executable-search, home/temp, and locale variables), then add only the credentials explicitly delegated to that agent/provider. Always strip the daemon API token and unrelated provider/cloud/database secrets. Make the host's credential delegation explicit and auditable. Add tests with sentinel secrets in `process.env` proving they are absent while required baseline variables and the selected agent credential remain present.

**Human sign-off required:** Yes, if accepted/deferred.

### SEC-002 — Medium — OpenCode fallback defeats its anti-masquerade control and can expose embedded request content

**Evidence**

- `packages/agent-runtime/src/opencode-log.ts:43-44` documents that each relevant log line can embed the entire request body, including the system prompt and tool schemas.
- `packages/agent-runtime/src/opencode-log.ts:80-86` says only service-error-like `message` values should be used so payload text cannot masquerade as an error.
- `packages/agent-runtime/src/opencode-log.ts:88-104` now returns the first non-matching `message` as a fallback.
- `packages/agent-runtime/src/opencode-log.ts:141-149` independently classifies a line by HTTP status, so a line such as status 429 plus an unrelated embedded `message` returns that unrelated value as the user-visible failure message.
- The test named “falls back to a non-matching first message” at `packages/agent-runtime/src/__tests__/opencode-log.test.ts:183-186` does not exercise that behavior: with no recognized status or keyword it still expects `null`. It therefore passes both the conservative and unsafe implementations.

**Impact and exploit path**

Provider logs may contain tool-schema, prompt, or other request-body objects with arbitrary `message` keys. When the same line contains a recognized status, the parser can surface hidden request content as a provider error. Besides confidential prompt/schema disclosure, the result can mislead the user with attacker-controlled text.

**Required remediation**

Prefer the conservative behavior: if no message passes the service-error keyword/structure check, return the code's generic default message. If upstream logs have a stable provider-error object, parse that exact object structurally instead of regex-scanning the full line. Add a regression test containing status 429/500 plus an earlier secret or attacker-controlled `message`, and assert the secret is not returned. Rename/remove the current misleading fallback test.

**Human sign-off required:** No.

### SEC-003 — Medium — Deployment reachability probing permits blind SSRF

**Evidence**

- `packages/deploy/src/reachability.ts:43-48` accepts arbitrary HTTP or HTTPS URLs.
- `packages/deploy/src/reachability.ts:63-97` fetches the URL without hostname/IP policy or connection-time DNS validation.
- `packages/deploy/src/vercel.ts:203-220` treats provider response `url`, `alias`, `aliases[].domain`, and `aliases[].url` values as reachability candidates.
- The new Vercel test accepts arbitrary example-domain aliases but has no private-IP, localhost, metadata-address, or DNS-rebinding case.

**Impact and exploit path**

A compromised/malicious provider response, test adapter, or future caller can make the daemon issue HEAD and sometimes GET requests to loopback, RFC1918/ULA/link-local networks, cloud metadata services, or other internal endpoints. Even without response-body exposure this enables internal reachability scans and GET side effects.

**Required remediation**

For provider-supplied deployment URLs, require HTTPS and an explicit provider-owned/custom-domain policy. Independently enforce public-unicast destinations with connection-time validated DNS, blocking loopback/private/link-local/ULA/mapped addresses and validating every attempt. Manual redirect handling is already a useful control. Add hostile provider-alias and DNS-rebinding tests.

**Human sign-off required:** No.

### SEC-004 — Medium — Sidecar IPC lacks boundary controls and permits resource exhaustion or repeated dispatch

**Evidence**

- Locked decision C7 requires typed dispatch plus authenticated capability negotiation; C8 requires sidecar authentication and replay protection (`ADS-memory/reports/jini-port/extraction-plan.md:197-203`).
- `packages/sidecar/src/json-ipc.ts:153-160` exposes a generic `unknown` message handler with no identity/capability input.
- `packages/sidecar/src/json-ipc.ts:161-198` appends bytes until a newline with no maximum frame size or idle deadline.
- The async `data` listener at `packages/sidecar/src/json-ipc.ts:187-256` has no handled/in-flight guard. A second frame/chunk can invoke the handler again while the first invocation is awaiting, despite the documented one-request-per-connection contract.
- Handler exception details are serialized to the peer at `packages/sidecar/src/json-ipc.ts:241-254`, and `packages/sidecar/src/__tests__/index.test.ts:511` explicitly tests propagation of the thrown text.
- The graph and repository search found no production caller today; the function is nevertheless exported from `packages/sidecar/src/index.ts`.

**Impact and exploit path**

Any local principal able to connect to a future privilege-bearing sidecar socket could invoke capabilities without authentication, replay a request, retain memory indefinitely by streaming without a newline, or trigger a supposedly one-shot handler multiple times. Raw handler failures can additionally reveal paths or secrets. Current exploitability is reduced because no production assembly calls this server yet; it becomes a release blocker before attaching filesystem, render, update, evaluation, or other privileged handlers.

**Required remediation**

Add authenticated session establishment, nonce/sequence replay protection, typed host-owned schemas, and explicit capability negotiation before dispatch. Set restrictive Unix socket permissions/ownership where applicable. Enforce a byte limit and idle/read deadline, reject additional frames, and mark a connection handled before awaiting the handler. Return stable error codes/messages while logging redacted internal details. Add negative tests for oversized/no-newline frames, concurrent/multiple frames, unauthenticated/replayed requests, and handler-detail redaction.

**Human sign-off required:** No.

### SEC-005 — Medium — HTTP run routes disclose raw internal exceptions

**Evidence**

- `packages/http/src/runs.ts:104-107` returns `onStarted`'s raw thrown message to the API caller.
- `packages/http/src/runs.ts:217-220` returns `RunLifecycle.stream`'s raw thrown message when headers have not been sent.
- New tests at `packages/http/src/__tests__/runs.test.ts:286-321` and `:532-554` explicitly require raw Error and non-Error values in the public response.
- In the assembled node host these routes are protected by global bearer authentication and origin checking (`packages/node-host/src/create-local-node-daemon.ts:245-271`), which reduces but does not eliminate disclosure to an authenticated browser/client.

**Impact and exploit path**

Spawn, storage, and adapter failures commonly include executable paths, working directories, command fragments, hostnames, or provider diagnostics. Exposing those verbatim expands information available to a compromised local web client and risks returning secret-bearing third-party errors.

**Required remediation**

Return a stable generic `INTERNAL_ERROR` message and a correlation/trace ID. Record the original exception only in redacted host logs/telemetry. Rewrite the new tests to assert that sentinel paths/tokens are absent from responses and that the internal logger receives appropriately redacted diagnostics.

**Human sign-off required:** No.

### SEC-006 — Medium — SSE streaming ignores backpressure and permits memory exhaustion

**Evidence**

- `packages/http/src/runs.ts:148-150` ignores the boolean return from `res.write`.
- `packages/http/src/runs.ts:179-208` buffers pre-subscription events in an unbounded array, then writes replay/live output without a bounded queue, pause policy, or slow-consumer disconnect.
- The new SSE tests use an always-successful write mock (`packages/http/src/__tests__/runs.test.ts:471-485`) and do not exercise `write() === false`, `drain`, or a queue cap.

**Impact and exploit path**

A high-output agent combined with a slow or stalled authenticated client can cause Node's response buffer and the route's pending array to grow until the daemon experiences excessive memory use or termination. Agent output is particularly susceptible because its volume may be prompt-influenced.

**Required remediation**

Adopt a bounded per-client buffer. Pause/queue on `write() === false` until `drain`, or disconnect slow consumers and require cursor-based replay. Bound the initial pending/replay phase as well. Add tests for false writes, delayed drain, queue-cap enforcement, disconnect cleanup, and terminal-event ordering under backpressure.

**Human sign-off required:** No.

### SEC-007 — Medium — Process-tree cleanup failures become unhandled rejections and may orphan agents

**Evidence**

- `packages/daemon/src/agent-executor.ts:390-395` allows snapshot/stop failures to reject.
- Cancellation paths fire and forget that promise without observing rejection at `packages/daemon/src/agent-executor.ts:493-496` and `:589-593`; ACP attach failure does the same at `:832-840`.
- `packages/platform/src/__tests__/process.test.ts:488-496` correctly establishes that `stopProcesses` can reject on EPERM.
- Agent-executor tests at `packages/daemon/src/__tests__/agent-executor.test.ts:497-540`, `:937-954`, and `:1028-1040` cover only successful cleanup/no-pid behavior.

**Impact and exploit path**

Permission changes, stale process state, or platform errors can turn cancellation into an unhandled rejection. Depending on process policy this can crash the daemon; otherwise descendants may remain running with filesystem/network access after the run is reported cancelled or failed.

**Required remediation**

Always observe cleanup promises. Await cleanup where lifecycle ordering allows it; otherwise attach a catch that records a redacted diagnostic and attempts a direct-child fallback kill. Do not claim clean cancellation until the cleanup outcome is known. Add tests where snapshot enumeration and process stopping reject, asserting no unhandled rejection, deterministic lifecycle state, diagnostic emission, and best-effort direct-child termination.

**Human sign-off required:** No.

## Test-quality conclusions

Strong areas in the reviewed suites include malformed ACP/JSON handling, cancellation races, IPv4/IPv6/private-address rejection in the platform asset cache, response-size cancellation, platform process behavior, origin/bearer middleware, and traversal/reserved-path handling in chat artifacts. The asset-cache implementation uses connection-time DNS validation and is a good model for deploy reachability.

The most important weaknesses are security-invariant gaps rather than missing line coverage:

1. Tests pin raw exception strings at public HTTP/IPC boundaries.
2. The OpenCode fallback test's name claims behavior it does not actually distinguish.
3. Agent tests mock environment transformation as identity and never assert secret non-inheritance.
4. Sidecar tests cover happy-path IO and errors but omit authentication, replay, maximum frame size, idle connections, and multiple-frame behavior.
5. SSE tests do not model Node backpressure or bounded queues.
6. Cancellation tests do not inject cleanup-port failure even though platform tests prove it can occur.
7. Reachability tests do not treat provider-returned URLs as an SSRF boundary.

## Verification performed

Read-only validation was run against the current working tree:

- `pnpm --filter @jini/agent-runtime test` — 87 files, 1,648 tests passed.
- `pnpm --filter @jini/daemon test` — 15 files, 267 tests passed.
- `pnpm --filter @jini/http test` — 13 files, 254 tests passed.
- `pnpm --filter @jini/deploy test` — 6 files, 94 tests passed.
- `pnpm --filter @jini/sidecar test` — 1 file, 42 tests passed.

Green suites confirm reproducibility of the current behavior; they do not negate the security findings because several unsafe behaviors are what the tests currently require.

## Release recommendation

**Block a security-hardened backend release on SEC-001.** Fix SEC-002 and SEC-005 before accepting the current behavior changes/tests. Resolve SEC-003 and SEC-006 before exposing deploy/run streaming to less-trusted clients. Do not connect `createJsonIpcServer` to privileged sidecar operations until SEC-004 is resolved. Fix SEC-007 before relying on cancellation as a security boundary.
