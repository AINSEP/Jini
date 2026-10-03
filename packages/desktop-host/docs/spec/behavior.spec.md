Spec ID: SPEC-JINI-DESKTOP-HOST-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:ab1e9e22c0359309a51bccb6580f6b4f3235a8685e6d32774b6c67caa66769a7
spec_mode: reverse_spec


# Behavior Rules: desktop-host

## Port, bridge and path guards

WHEN a shared single-instance claim fails, the package shall quit the app and return false; successful claims register the supplied second-instance callback. Repeated claims are not deduplicated. Tauri claim always returns true and subscribes, relying on native enforcement before JS starts.

WHEN creating windows, tracking shall retain the latest successfully created handle. Closing an older handle shall not clear its successor. Showing the main window shall do nothing when absent/destroyed, otherwise show then focus. Electron creates hidden unless explicitly shown at creation, loads URL, then shows by default. Tauri uses unique module-counter labels, default visible=true and an explicit navigation after creation. Its visibility/focus/close promises are discarded by shared void methods.

WHEN validating the renderer bridge, the package shall require version 1, recognized client type, string metadata when non-null, shell functions and a valid optional updater. Scope lookup shall prefer an existing direct `__jini__` property over `window.__jini__`, even if direct value is invalid. Invalid bridge returns null; client detection returns `web`. Action wrappers shall return `{ok:false,reason}` for missing host/extension or action rejection. They do not validate successful action result payloads.

WHEN resolving path roots, the package shall append namespace to the supplied base and fixed cache/log/runtime/user-data/session subpaths. A nonblank data override shall expand a leading `~`, `$HOME` or `${HOME}`, require an absolute path, reject an already namespace-scoped data path naming another namespace, and otherwise append `namespaces/<namespace>/data`. Namespace/base themselves are not containment-validated and no directory is created.

WHEN loading config, a nonempty explicit environment path shall take precedence; if absent/unreadable or parsed null it shall throw rather than try candidates. Otherwise the first accessible non-null parsed candidate shall win, with `{}` when none exists. Malformed accessible JSON rejects. Parsed object/schema is not runtime-validated. Default environment is `process.env`.

## Protocol and rendering

WHEN proxying a custom-scheme request, the package shall replace target pathname/query/hash with the incoming values and preserve target origin. Fetch/Request-construction failures inside the catch shall become JSON 502 with `JINI_PROTOCOL_PROXY_FAILED`, message, target and optional native code. URL parsing happens before that catch and can reject. This is a transport proxy, not an origin authorization policy.

WHEN Electron renders, it shall use a hidden window, 1024×768 default viewport, JavaScript enabled by default and blocked navigation unless explicitly allowed. It shall load base64 HTML, wait for load events, render bytes and destroy the window on completion/error/deadline/abort. No default render deadline exists. PDF defaults are landscape=false and printBackground=true; page size applies only when both dimensions exist. `deviceScaleFactor` is ignored.

WHERE `allowedOrigins` is supplied, requests shall be restricted to matching parsed origins plus `data:`/`about:`. WHERE it is omitted, remote requests shall be blocked unless `allowUnrestrictedNetwork:true` is explicitly supplied. An explicit allowlist takes precedence over that opt-out. `isOriginAllowed` uses the same safe defaults. Request filters are installed on the supplied window's session; the adapter does not isolate the session or remove its request filter afterward.

IF Electron artifact export is called, THEN it shall reject as not implemented. Tauri rendering/custom-protocol/recent-directory capabilities shall fail explicitly; consumers can override those ports. Shell open-path errors from Electron become `ShellError`; directory stat failures become false. Dialog cancellation/no selection becomes null; recent locations are returned as supplied by the host.

## Sidecar launch and shutdown

WHEN Node launches a sidecar, it shall use caller command/args/cwd/environment, optionally append stdout/stderr to one log file and resolve after spawn. Without log path output is ignored. Omitted environment uses native spawn inheritance. Tauri forwards binary name/args/environment; it ignores cwd/logPath and always returns null log path.

WHEN waiting for readiness, the launcher shall poll at default 150 ms with a 35,000 ms loop budget, tolerate probe errors and fail on observed process exit. Node races the whole polling task, including a pending probe or poll delay, against exit and the deadline. It cancels pending poll delays and removes its exit listener on settlement. The supplied probe itself is not canceled. Tauri probe execution is not independently bounded or raced against exit. Tauri cannot detect an exit that happened before listener registration from the current process surface.

WHEN shutting down a sidecar, the launcher shall try optional graceful request, swallow its failure, wait 5000 ms by default, send SIGKILL if still waiting, then wait another same interval. It does not bound the graceful-request promise or reject if the second wait expires. Node closes its log handle afterward. The launcher neither restarts crashes nor stops process trees; the supervisor package owns those concerns.

## Drain, navigation and guest boundaries

WHEN draining shutdown work, the tracker shall await all tracked settlements, swallow rejection and include work added during draining. It has no deadline. Repeated quit during draining shall hold even when counts are empty; drained phase proceeds. First routed SIGINT/SIGTERM/SIGHUP shall arm an unreferenced caller-selected deadline and call quit once; later signals do nothing. Signal routing has no unregister function.

WHEN comparing app origins, malformed/opaque URLs shall fail closed. Foreign HTTP(S) popup/navigation/main-frame redirects shall be prevented and handed to the consumer's external opener; non-main-frame redirects remain untouched. Renderer policy compares the exact parsed renderer URL ignoring query/hash.

WHEN handling guest popups, the policy shall return deny after a successful or failed external handoff. Its supervised-URL predicate can throw before denial is returned. Guest attach shall prevent nonstring/unapproved sources and predicate failures. Preferences shall overwrite preload, disable Node integration and enable context isolation; empty preload throws. Host-page predicates are caller code and their exceptions propagate.

## Updates, tools and capabilities

WHEN checking updater eligibility, precedence shall be unpackaged, Store-managed, unsupported platform, environment-disabled, then selftest. The controller does not call eligibility itself. Fresh-owner election shall choose oldest startedAt then smallest PID, excluding heartbeat ages strictly greater than the supplied stale interval. Checks require owner, idle status and elapsed interval; equality is eligible.

WHEN constructing the controller, it shall enable auto-download, enable install-on-quit initially on Windows, and attach listeners without starting timers. `start` shall advertise presence and arm supplied first/tick timers once. Prompting deduplicates by most recently prompted version. Only the last live instance can install/restart; busy/ready state prevents new checks. Final quit must follow consumer draining. macOS stages through explicit handoff; Windows install-on-quit is gated at final quit. Installer failure/deadline calls quit. `willQuit` stops timers/removes own presence and makes future controller work inert, without removing updater listeners.

WHEN generating runtime shims, the package shall reject unsafe path/comment values before writes, preserve positional arguments and run Electron as Node. Durable launch shall atomically replace each of three shims with owner-only bin/file modes; transient launch shall reuse an existing durable launcher or return null without writing. Environment names must be valid and distinct. No all-three-file transaction or PATH update is provided.

WHEN registering speech IPC, the package shall require a trust predicate, verify sender frame before rate/sample access, require whole-Hz rates 8000–192000 inclusive and reject malformed/nonfinite/sparse samples before allocation. Default maximum is 14,400,000 samples, a count rather than a duration at every rate. WAV encoder shall clamp to signed mono 16-bit PCM, use a 44-byte header and preserve supplied rate; direct encoder helpers have no IPC validation guards.

WHEN selecting transcription, unsupported platforms shall return an unavailable port without constructing the native one. macOS adapter shall reuse an existing binary, otherwise compile with caller compiler/source; scratch WAV removal shall run after write/recognition failures too. Native helper check shall not prompt, transcription can request authorization, and recognition shall require on-device execution with 15-second authorization wait and 30-second recognition wait. Adapter compilation/process calls have no independent timeout.

## Deliberate exclusions and evidence

The package does not choose application identity, URLs, updater feeds, installer release policy, trust predicates, credentials, renderer UI, microphone capture or global lifecycle orchestration. Bridge updater availability is an optional consumer extension; the separate updates subpath does supply generic controller mechanics. Logging defaults to console echo, best-effort synchronous JSON-line append, no directory creation, rotation or secret redaction. Fatal handlers preserve process crash behavior rather than converting it into recoverable errors.

Evidence: [root tests](../../src/__tests__/index.test.ts), [render tests](../../src/electron/__tests__/electron-render-service.test.ts), [shutdown](../../src/__tests__/shutdown-tracker.test.ts), [update policy](../../src/__tests__/update-policy.test.ts), [speech IPC](../../src/speech/__tests__/speech-ipc.test.ts), [native adapter](../../src/speech/macos/__tests__/mac-on-device-transcriber.test.ts), [usability](../../src/electron/usability/__tests__/host-ports.test.ts). Tests were read, not executed.
