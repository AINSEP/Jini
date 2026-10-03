Spec ID: SPEC-JINI-MCP-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:aef97373375b3b5202e2ad2ac762d7f3913d77f7fc22dbb12ac2e14d8fe6037e
spec_mode: reverse_spec


# MCP error contract

## Exported classes and process boundaries

| Class / surface | Trigger | Caller response |
|---|---|---|
| `DaemonHttpError({message,status})` (`.`) | Daemon JSON GET/POST receives non-2xx | Inspect status; correct auth/input or handle upstream failure; one tool call must not terminate server |
| `DaemonResponseTooLargeError({limitBytes})` (`.`) | Low-level bounded read detects size violation | Public GET/POST convert it to a plain Error; reduce response or explicitly raise cap |
| `McpProtocolError({message}, optional:ErrorOptions = {})` (`federation`) | Handshake/JSON-RPC/framing/status failure, closed session, timeout/cancellation, endless pagination | Distinguish cancellation/terminal connection state before reconnecting; no automatic retry |
| `McpAuthFailedError` (`federation`) | HTTP 401; inherits protocol-error constructor | Refresh/re-authorize through host policy; wire onAuthFailed to prevent futile repeat calls |
| `McpLaunchUnavailableError({message})` (`federation/stdio`) | Missing/unresolvable executable or incomplete configured toolchain | Repair executable/bundle/config; identity fallback requires explicit host opt-in |

McpProtocolError and McpAuthFailedError do not set a distinct `.name`; use instanceof. None defines a stable code field. HTTP 403 is a McpProtocolError, not McpAuthFailedError. Injected challenge-hook errors can replace a 401 transport error.

`serve({}, options)` writes a plain jini-mcp-prefixed diagnostic and exits 1 for missing JINI_RUN_ID or a server-run failure. Inject exit({code})=>never to embed it. The root daemon JSON functions never call process.exit.

## Tool and admission errors

| Boundary | Failure representation | Caller response |
|---|---|---|
| handleToolCall unknown name/schema/handler failure | MCP `{isError:true,content:[{type:'text',text}]}` | Repair name/input or surface diagnostic; server continues |
| handleResourceRead unknown URI/reader failure | Rejected plain Error | Treat as resource/JSON-RPC failure, not tool-result envelope |
| Duplicate tool/resource definitions | Synchronous plain Error | Fix composition before starting the server |
| requireString | Plain Error when value is non-string or empty; whitespace is accepted | Supply a non-empty string |
| Idle controller | RangeError for nonfinite/noninteger/nonpositive idleMs | Supply a valid timeout; values above one day clamp |
| Daemon network/response stream/size | Plain Error or native stream rejection | Recover at tool boundary; generic type T does not validate data |
| Invalid connection id/native-id collision | Plain Error | Fix operator configuration; bootstrap isolates that connection |
| Non-object federated input | Core ToolInputError | Supply object input or omit it; clone errors also propagate |
| Protected action without confirmation | Core ToolInputError with `${errorCode}_NO_CONFIRMATION_CHANNEL` message prefix | Provide a human-confirmation port; nothing is sent |
| Permission/usability/auth hooks | Host-defined rejection | Follow host policy; do not automatically retry revoked or denied access |

The core ToolInputError class is not re-exported here. The confirmation message prefix and confirmation-card required host errorCode are not fields on a package-specific exception class.

Admission reports return refusal reason strings: not-in-operator-allowlist, missing-or-invalid-input-schema, invalid-remote-tool-name, duplicate-remote-tool-name, connection-tool-cap-reached. Legacy remote-declares-destructive and remote-declares-not-read-only remain in the type/copy tables but are not emitted by current admission. Reports also enumerate allowlisted-but-absent and write-allowed-but-not-allowlisted configuration drift. A caller must surface actionable refused attempts; default-denied tools can be omitted from boot notice enumeration.

Revocation reason vocabulary: removed, turned-off, disconnected, changed, tool-not-allowed, write-not-allowed, unverifiable. Gate throws the Error returned by host errorFactory.create. The current helper cannot produce write-not-allowed because write-list checks were removed. A changed revision requires fresh admission after restart, not an automatic retry of the old registration.

## Storage, approvals and ask-choice

| Boundary | Outcome / handling |
|---|---|
| Config/token sanitization | Invalid server becomes null or is dropped; malformed store shape becomes empty; not an exception |
| Config/token file missing or invalid JSON | Empty result; invalid JSON logs diagnostic; distinguish this from other I/O rejection |
| Secret write permissions/I/O | Plain Error or native fs rejection; POSIX insecure temporary file is removed before refusal; preserve prior final file |
| Install merge/remove | Plain Error for invalid JSON/non-object root or unsafe path segment; stop and preserve existing file |
| Unknown agent slug | Plain Error; select an exported AgentSlug |
| Approval lookup/authorization | Rejection; call remains unconfirmed |
| Approval store/webhook after Confirm | Isolated diagnostic (`store` or `webhook`); explicitly approved call proceeds |
| Revocation store/webhook | Store failure becomes unverifiable refusal; webhook failure is diagnostic only and does not remove refusal |
| Ask-choice malformed question | Internal QuestionShapeError mapped through host policy.shapeError; internal class not exported |
| Forged/mismatched/expired fallback answer | host policy.inputError; ticket consumed if found; do not replay it |
| Invalid ticket ttlMs or empty/duplicate id | Plain Error; supply positive finite TTL and unique unpredictable identifiers |
| Presentation/emission/receive/authorization | Host rejection propagates; exchange closes or unused fallback ticket is invalidated where applicable |
| Cancel/expired/abandoned/no-answer | Ordinary submitted:false record with reason/note; not an exception |

Known redaction limit: daemon response messages are sanitized, but URLs and daemon code fields are inserted verbatim in some daemon-client diagnostics. Direct errorResult also trusts its input. Consumers must not treat every returned message as secret-free.

Evidence: `src/server/daemon-client.ts`, `tool-protocol.ts`, `resource-protocol.ts`, `client/client.ts`, federation adapters/trust/registrations/approvals, core stores and ask-choice source. Static tests cover many branches; no tests or builds were run.
