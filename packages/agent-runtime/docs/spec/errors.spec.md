Spec ID: SPEC-JINI-AGENT-RUNTIME-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e76f590a8ee8854acb9dadbcb90f91b0c6aebde330957ce73cc49649db2cc1ef
spec_mode: reverse_spec


# Error Contract Spec: agent-runtime

## Error surfaces

The package has no shared error superclass or universal error envelope. Callers must distinguish rejected promises, returned diagnostic values, provider events and subprocess events. Error messages are descriptive; stable dispatch should use a documented class, `kind`, or `code` when one exists. Host callbacks can throw and are not universally caught.

## Exceptions and caller recovery

| Class or message family | Trigger | Caller action |
|---|---|---|
| `ElevenLabsCredentialMissingError` (no code) | Voice credential resolver returns blank API key | Configure credentials for the workspace, then retry |
| `RangeError: ttlMs must be finite and non-negative` | ModelCatalogCache constructor receives negative/nonfinite TTL | Correct configuration; do not retry unchanged |
| `Error: Duplicate agent definition id: …` | Registry module initialization sees a repeated built-in ID | Treat as package/configuration defect; cannot recover by retrying lookup |
| `Error: ACP child process must expose stdin and stdout streams` | attachAcpSession receives a child without required pipes | Spawn with piped stdin/stdout before attaching |
| `Error: pi RPC child process is missing stdin/stdout` | attachPiRpcSession receives a child with a null pipe | Correct spawn configuration |
| ACP discovery `Error` | Spawn, stdin write, JSON-RPC handshake, early exit or discovery timeout fails | Surface diagnostic; use static models or retry after correcting CLI/auth/connectivity |
| `Error: … OAuth state not found or expired` | Unknown, expired, already consumed state | Begin a new authorization flow |
| `Error: … OAuth state mismatch: …` | Consumed state belongs to another provider | Begin the correct provider flow; the state has already been consumed |
| Delegated OAuth exchange/refresh rejection | OAuth wire request or response fails | Handle the upstream rejection; restart authorization when grant cannot be refreshed |
| `Error: Port … is already in use …` | Callback server bind reports EADDRINUSE | Stop conflicting flow/listener or use a registered alternative redirect; this wrapper has no code property |
| Native filesystem errors | Prompt/log staging or OAuth token read/write fails (other than documented read fallbacks) | Correct permissions/path/disk issue; cleanup staged resources in finally |
| Native execFile error | execAgentFile fails, times out or exceeds buffer | Inspect native code/stdout/stderr; use def-specific launch/auth diagnostics |
| `Error: Invalid vela model JSON…` | parseVelaModelJson receives invalid JSON, wrong source or wrong container shape | Reject incompatible catalog output; fallback or correct CLI version |
| AIHubMix image `Error` | HTTP failure or response lacks usable inline image | Surface provider failure; retry only under host policy |
| ElevenLabs voice-list `Error` | HTTP non-success, malformed response JSON or network failure | Surface credential/connectivity/provider error; no automatic retry is promised |
| pinnedFetch `Error` | Redirect, unsupported content-encoding, idle timeout, abort, socket/TLS failure | Keep redirect/encoding checks; correct endpoint or retry transient network errors under host policy |
| `TypeError: Model catalog variant must be a string` | Non-string variant is rejected before trimming or invoking a supplied trim method | Pass a string; omitted or undefined uses the empty-string default |
| Host-port rejection | Merge/clock, credential resolver, custom turn adapter or callback throws | Apply host-owned error policy; no universal conversion is promised |

ModelCatalogCache catches discovery errors, records `live = null` and calls `onDiscoveryError` once for that attempt. A throwing error callback rejects waiting reads; merger and clock exceptions also propagate. AmrModelLoadingCache catches remote errors and exposes `remoteError`; preset failures reject get. resolveOAuthBearer returns null on refresh or refreshed-token-write failure, but initial token-file read errors can still reject.

## Returned codes, kinds and stream errors

| Surface | Code/kind | Trigger and caller response |
|---|---|---|
| Prompt budget result | `AGENT_PROMPT_TOO_LARGE` | Size exceeds applicable guard; shorten selected context/history or choose stdin/file delivery; do not spawn unchanged |
| Native agent service classifier | `AGENT_AUTH_REQUIRED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` | Recognized CLI text; sign in, back off, or surface upstream connectivity failure respectively |
| Provider failure events | `{type: 'error', message, code?}` followed by `{type: 'end', reason: 'error'}` | URL/HTTP/stream/network failure; inspect event rather than assuming a resolved turn promise means success |
| Provider terminal reason | `stop`, `contaminated`, `max_tool_turns`, `error` | Completion, fabricated role marker, feedback-round ceiling, or failure; preserve this reason for host reporting |
| Provider raw result | stopReason/finishReason can be null or provider-specific string | Transport failure/early EOF can leave raw stop code empty; consume end event for normalized termination |
| Tool-result failure | tool_result isError and rejected-result text | Executor threw or content failed provider validation; built-in loops feed an error result back to model and can continue |
| URL validation | `Invalid baseUrl`, `Only http/https allowed`, `Internal IPs blocked` | Returns error; blocked address also sets forbidden; refuse the outbound request |
| Model/connection response | `auth_failed`, `forbidden`, `not_found_model`, `invalid_model_id`, `invalid_base_url`, `rate_limited`, `upstream_unavailable`, `timeout`, `unknown` | Use kind to select sign-in/configuration/model/backoff/connectivity response; detail is redacted by these helpers |
| Model response additions | `no_models`, `unsupported_protocol` | No usable text models or unsupported listing protocol; retain fallback catalog or configure manually |
| ACP structured model failure | `AMR_MODEL_UNAVAILABLE`, retryable false, action choose_model | Opt-in model-unavailable mapping; prompt caller to choose another model |
| ACP promoted failure | `AGENT_EXECUTION_FAILED` or injected AccountFailure code | Fatal protocol/status/account failure; honor supplied retryability/action/details |
| ACP promoted role-marker failure | `ROLE_MARKER_HALLUCINATION` | Matching upstream opencode_session_error details; retryable defaults true; host decides reseeding/retry policy |
| pi resume failure | `PI_PARENT_SESSION_FAILED` | Parent new_session rejected; host must reseed history in a new session |
| ACP resume failure | `error.details.kind: 'resume_failed'` | Failures before session/load acknowledgement, including initialize/load RPC errors, timeouts and transport loss, retain the original error code and retryability; original details are nested under cause. Errors after load succeeds retain ordinary run-error behavior; host decides reseeding policy |
| OAuth callback outcome | `{kind: 'error', error, state?}` | Provider error, missing code/state, mismatch or timeout; stale/malformed requests do not invoke onCallback or consume the listener |

## Handling rules and evidence

Redact secrets before displaying/logging arbitrary native errors; only the provider helpers that explicitly call redactSecrets promise their defined token/header/query substitutions. Native subprocess events use `send({event: 'error', payload})`, whose nested error shape varies by path. Missing ACP permission policy produces a fatal session error and termination; an injected cancelled decision produces a cancelled reply without automatically making the session fatal. Do not interpret cancelled as approval. Session failure kills the child with SIGTERM; abort termination escalation remains the caller's responsibility.

Evidence: [service classification](../../src/auth.ts), [prompt guards](../../src/prompt-budget.ts), [provider outcomes](../../src/providers/types.ts), [network guards](../../src/providers/connection-guard.ts), [cache](../../src/model-catalog-cache.ts), [OAuth credentials](../../src/providers/oauth-credentials.ts), [ACP](../../src/agent-protocol/acp/session.ts), [pi](../../src/agent-protocol/pi-rpc/session.ts).
