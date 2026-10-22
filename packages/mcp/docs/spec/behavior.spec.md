Spec ID: SPEC-JINI-MCP-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1712c6059f290310a345d6d4331ef62c65c9923848694284780332e5849e85eb
spec_mode: reverse_spec


# MCP behavior contract

## Config, credentials and installation

- WHEN a server is sanitized, the sanitizer shall trim its id and require 1–64 characters matching `[a-z0-9][a-z0-9_-]*` case-insensitively. Missing transport shall default to stdio; an invalid supplied transport/authMode shall reject the entry.
- WHEN stdio is selected, command shall be non-empty after trimming. WHEN HTTP/SSE is selected, URL shall parse as HTTP(S); no public-address or credential-in-URL guard is applied here.
- WHEN enabled is omitted or differs from false, it shall become true. Missing remote auth mode shall be none for localhost/127.x.x.x/::1, oauth otherwise, including missing/unparseable URL in the inference helper.
- WHEN config contains duplicate ids, the first valid entry shall win with case-sensitive id equality. Unknown fields and malformed entries shall be dropped. Blank string-map values and unsafe map keys __proto__/constructor shall be dropped.
- IF config/token file is missing or contains invalid JSON, THEN its reader shall return an empty store; corrupt JSON shall also log to console.error. Other I/O errors shall reject.
- WHEN default secret storage writes, it shall create a same-directory exclusive temporary file with mode 0600 and rename it into place; POSIX group/other permission bits shall cause refusal before rename. Windows shall skip POSIX verification.
- WHEN builders merge credentials, non-empty user Authorization headers shall win case-insensitively; empty Authorization shall not suppress a supplied bearer token. Token injection shall occur only for effective oauth mode.
- WHEN Claude builder has no enabled servers, it shall return null. ACP builder shall include only enabled stdio servers. OpenCode builder shall return null only when no servers, directory grants or extra config would be emitted.
- WHEN OpenCode builder emits generated mcp/directory permissions, they shall override those particular extraConfig fields; unrelated extra keys shall survive. Directory grants shall be limited to supplied absolute paths and their normalized variants.
- WHEN token records are sanitized, missing tokenType shall default to Bearer and missing/nonfinite savedAt shall use now(). Expiry helper shall return true when expiresAt minus skew (default 30000 ms) is at or before now; absence of expiresAt shall return false. Reads shall not filter expired tokens.
- WHEN install planning runs, it shall return CLI, JSON or manual instructions without executing them. JSON merge/removal shall reject __proto__/prototype/constructor path segments and preserve unrelated config keys; repeated removal of an absent key shall return null.

Config/token writes serialize by exact dataDir string within one process. No cross-process transaction, alias-path locking, encrypted storage or OAuth exchange/refresh is provided. `buildMcpInstallPayload` defaults subcommand to mcp and merges sidecarEnv after the data-directory key, so sidecarEnv can override that key.

## Tool server and daemon proxy

- WHEN server construction receives duplicate tool names/resource URIs, it shall throw synchronously before I/O. Tool capability shall always be advertised; resources shall be advertised only for a non-empty resource list.
- WHEN run() starts, it shall resolve the daemon URL once, remove one trailing slash, connect a fresh stdio server, and wait for transport closure. The default idle window is 1800000 ms.
- WHEN idle controller is constructed, it shall require a positive finite integer idleMs and clamp it to 86400000 ms. In-flight requests shall defer idle closure; the final request completion shall reset the idle interval.
- WHEN handleToolCall receives known tool input, it shall validate JSON Schema before invoking its handler. Unknown names, schema failures and handler failures shall return MCP isError results. Handler errors/schema diagnostics shall be sanitized; unknown-name text is returned directly.
- WHEN okResult receives a content array whose blocks pass the pinned SDK ContentBlockSchema, it shall forward the content array; other envelope fields (including isError and structuredContent) shall not be forwarded. Other strings shall become text, other payloads shall be JSON-stringified.
- WHEN resource read fails, it shall reject with an Error rather than an MCP tool-result envelope; handler error messages shall be sanitized. Result MIME shall prefer the per-read value over the definition value.
- WHEN daemon JSON request runs, it shall use a 15000 ms default timeout and 10 MiB byte cap, forwarding caller signal/auth headers. Empty or malformed JSON shall become {}. It shall throw on HTTP/network failure, clear its timer, and never exit the process.
- WHEN delegated tool factory runs, it shall bind runId once and generate toolUseId per call. Timeout shall default to 360000 ms; a finite positive override shall be accepted, all other values shall fall back. Readonly gateway shall request daemon enforcement with requireReadOnly:true.
- IF active-context GET returns 404, THEN getActiveContextTool shall explain that the host does not support the route; a response not declaring active:true shall become active:false with a hint.

Proxy calls supply no independent host authorization, retry, response schema checking or cache. The daemon must enforce permissions, readonly classification, run idempotency and cancellation. Search limits are 1–25 for both catalogs; omitted limits are left for daemon defaults. Reference extraction shall deduplicate root-relative paths, strip query/fragment and drop root-escaping traversal and listed external URL prefixes; it is a pattern extractor, not a browser or general URI security validator.

## Federation admission and execution

- WHEN a connection is admitted, connectionId shall match `^[a-z0-9][a-z0-9-]{0,39}$`; remote names shall match `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`. Ids shall be namespaced as mcp__connection__remoteName and shall never replace a pre-existing native id.
- IF allowedToolNames is empty, THEN admission shall contribute zero tools. Write-list membership alone shall grant no admission. Remote readOnlyHint shall grant neither admission nor host permission.
- WHEN admission processes tools, it shall preserve advertised order, reject duplicate names, invalid/missing object input schemas and entries beyond maxTools. Both admission and operator-facing surface description shall share the same classification pass.
- WHEN the operator's reviewed readOnlyRemoteNames includes a name, it shall confer descriptor readOnly only if remote hints do not explicitly contradict it. Remote hints alone shall not confer that descriptor flag.
- WHEN a tool is admitted, its writeAuthorized flag shall report write-list membership; the current code shall not require that membership for ordinary writes or recheck it as a call-time grant.
- WHEN a call starts, it shall run optional connection-usability gate, then required permissionGate using admin.integrations.manage/federated-mcp-connection/connectionId and optional opaque scope, then clone and deep-freeze arguments, then apply call confirmation, then send the remote call. Confirmation and remote shall receive the same frozen argument object.
- WHEN action classification detects permanent deletion, protected delivery or assistant access/instruction mutation, it shall require confirmation. SQL delete/drop/truncate/dynamic EXECUTE shall require destructive confirmation after stripping quoted literals and comments. Ordinary writes, SQL SELECT/CREATE and trash/archive/unpublish shall run without a card under the current classifier.
- IF a protected action has no confirmation port, THEN the handler shall throw before network I/O. A declined answer shall return ran:false plus the host's result instead of invoking the remote.
- WHEN remote authentication fails, an installed onAuthFailed hook shall receive the error and replace it with a host rejection; without that hook the transport error shall propagate. Remote isError shall be represented as untrusted data, not authoritative host execution status.
- WHEN descriptions/results are exposed, the package shall label third-party text as untrusted. Descriptions shall strip control/extra whitespace and retain up to 600 source characters plus ellipsis; result text shall use a fresh UUID delimiter and visible truncation notice.

`maxResultBytes` caps UTF-8 bytes of serialized text before wrapping, without splitting code points. The aggregate serialized image array has a separate per-result budget of the same size, including JSON structure and MIME metadata; blocks that would exceed it are omitted with a note. Wrapper text is outside these budgets. No image decoding, MIME validation beyond string shape, or prompt-injection prevention guarantee exists.

## Federation transports, boot and reload

| Default or limit | Current contract |
|---|---|
| Suggested connection defaults | Connect 60000 ms; call 30000 ms; text/image field limit 65536; maxTools 32; caller explicitly applies constants |
| Protocol negotiation | Client revision 2025-06-18; initialize, then notifications/initialized; no sampling/resources/prompts/roots capabilities |
| tools/list pagination | At most 20 pages; continued nextCursor rejects |
| Adapter message/response cap | 4 MiB measured as decoded string length; HTTP fetch exchange buffers text before the check |
| Child stderr tail | 600 characters; configured secret values of length >=4 redacted, including across chunks |

WHEN stdio receives a server request, it shall answer -32601; notifications and malformed/banner noise shall be ignored. Responses shall correlate to pending numeric ids; timeout/cancellation/close shall reject pending work. The channel shall frame newline-delimited messages. HTTP shall accept JSON or SSE framing, propagate a safe server-issued session id and negotiated protocol header, and reject redirects in the fetch adapter.

WHEN HTTP credentials are requested, the adapter shall call the token supplier per request; a returned token shall replace configured Authorization headers case-insensitively. A 401 shall invoke the challenge hook and yield McpAuthFailedError; 403 shall yield generic McpProtocolError. No OAuth flow or retry is performed. Timeouts depend on injected exchange/token supplier honoring AbortSignal. HTTP close's best-effort DELETE does not use the request timeout.

WHEN child env is composed, precedence shall be inherited allowlisted env, launchEnv, specEnv. The adapter shall not inherit all host secrets. Package-runner cwd shall default to a neutral temp directory unless explicitly supplied. Configured incomplete bundled toolchains shall fail closed unless allowIdentityFallback is explicitly true; default connector shall log a resolver warning once. Its stdio connect timeout starts after synchronous resolver and spawnChannel calls; those calls are outside that deadline.

WHEN bootstrap attaches connections, it shall visit preset connections before extras, sequentially; one connection failure shall be reported and isolated. Host must supply connect. A connection admitted with zero tools shall still contribute a report. Already admitted tool lists shall remain fixed; list_changed notifications shall not expand them.

WHEN reload calls overlap, the coordinator shall serialize one running pass and coalesce waiting calls into one trailing pass. It shall skip previously admitted connection ids, retry previously failed ids, and not re-admit edits to an already admitted connection. Per-call revocation is a separately injected gate.

## Approvals and ask-choice

WHEN approval identity changes connection/origin revision/remote name/hints/description/schema, its SHA-256 fingerprint shall change; object key order alone shall not change it. Chat grants bind conversation/principal/connection/tool/fingerprint. Always grants bind opaque scope/connection/tool and matching fingerprint. Destructive requests shall not use always grants; write-shaped protected inputs shall bypass remembered grants and suppress remember choices.

IF approval lookup fails, THEN confirmation shall reject. IF saving an explicitly accepted grant or delivering its webhook fails, THEN that one accepted call shall remain confirmed and the optional diagnostic sink shall be notified. A remember choice not offered on the card shall not be persisted.

WHEN revocation gate runs for a roster call, it shall read current row and check origin, row existence, revision, enabled, disconnected and current allowlist. Missing origin/store error shall be unverifiable; preset calls shall skip this gate. Refusal shall remain enforced even when notification/diagnostics fail. Write-list narrowing is not enforced by the current grant helper.

WHEN ask-choice is invoked, authorization shall precede display or ticket redemption. Question parsing shall require non-empty title and at least one non-empty labeled option group. Already-aborted question calls shall return abandoned before display. A live exchange shall emit mcp-ui, receive an answer and close in finally; dismiss shall precede typed answer, which shall precede selections. Host exchange adapters own answer binding and validation.

WHEN fallback ticket is redeemed, the store shall consume it before checking principal/time/offered options. Expiry shall reject at the exact deadline. Rendering/result-encoding failure shall invalidate an undisplayed ticket. Ticket TTL and id generator are required host inputs with no defaults; mint sweeps expired tickets and snapshots the question. Typed answers are supported on the live exchange path, not fallback ticket redemption.

## Deliberate non-goals and evidence

This package shall not supply product presets, a permission evaluator, OAuth authorization/refresh, encrypted credential storage, durable roster/approval/exchange storage, a UI renderer, automatic reconnect, a process-wide shutdown supervisor, or model inference for remote servers. Tests and comments were read under src; none were run. Known source contradictions and lifecycle limits are recorded in the adjacent API/errors/state contracts.

Decision rationale: [Remote annotations can narrow authority but cannot grant it](../decisions/DR-001-federation-admission.md), [Preserve structured protocol resources without exposing human secrets](../decisions/DR-002-protocol-resource-boundary.md), [Federation presets compose trusted ports](../decisions/DR-003-trusted-federation-composition.md).

Decision rationale: [Parked human exchanges need explicit deadlines](../decisions/DR-004-parked-human-exchange-deadlines.md).


The host supplies fingerprintDomain, errorCode and refusal/confirmation messages; preserving a host namespace preserves fingerprint and error-prefix bytes. Clock and Logger come from core/primitives. Config/token writes delegate to the shared async atomic writer with 0600, parent creation and POSIX owner-only verification. The distinct stdio tail sanitizer retains lowercase markers and four-character exact-secret admission.
