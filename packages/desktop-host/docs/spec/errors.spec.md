Spec ID: SPEC-JINI-DESKTOP-HOST-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d8f2c213cbcdfc1608cd7df198e554c89e1ae5f13982aff81003ae4dcffe6db5
spec_mode: reverse_spec


# Error Contract: desktop-host

## Exported error classes

| Class / code | Emission condition | Caller action |
|---|---|---|
| `DesktopHostPathError` | Data override is relative or names a different namespace | Fix configuration before opening stores |
| `ShellError` | Electron `openPath` resolves a nonempty native error message | Present/report path-open failure |
| `RenderServiceError`, `timeout` | Explicit render deadline elapsed | Reduce work or change explicit deadline |
| `RenderServiceError`, `aborted` | Signal already aborted or aborts during rendering | Treat as cancellation; window is destroyed |
| `RenderServiceError`, `load-failed` | Native render document load failure | Inspect load diagnostics/HTML/resources |
| `RenderServiceError`, `not-implemented` | Electron `exportArtifact` | Supply another render provider |
| `RenderServiceError`, `navigation-blocked` | Declared code only; current adapters do not throw it | Do not infer that navigation prevention rejects rendering |
| `NotImplementedError` from `/tauri` | Scheme registration, PDF/capture/artifact, or recent directories | Feature-detect/override provider before offering capability |

Constructors take one required object: `DesktopHostPathError({message})`, `ShellError({message})`, `NotImplementedError({message})`, `RenderServiceError({message,code})`. Each sets its class name; only `RenderServiceError` has a package code. Native print/capture/factory errors are not universally wrapped.

## Returned failures and transport errors

| Surface | Failure shape / condition | Caller action |
|---|---|---|
| Bridge validation/lookup | false/null; unavailable client becomes `web` | Hide native-only actions |
| Bridge action/update wrappers | `{ok:false,reason}` for absent bridge/extension or thrown/rejected action | Branch on `ok`; surface consumer wording |
| Protocol proxy | HTTP 502 JSON `{error:'JINI_PROTOCOL_PROXY_FAILED',message,target,code?}` for caught fetch/Request failure | Inspect connection/config; body includes host error detail |
| Protocol URL construction | Uncaught URL `TypeError` before proxy catch | Validate URLs before registration/request |
| Single-instance claim | false after app quit | End second instance bootstrap |
| Config loading | Message-only `Error` for explicit missing/null config; JSON `SyntaxError` or native read failure | Correct config; no fallback after explicit failure |
| Sidecar launch | Native spawn/filesystem rejection | Correct binary/permissions and release host resources |
| Sidecar readiness | Message-only `Error` for observed early exit or exhausted loop budget | Inspect logs/probe; clean up launched process |
| Windows registry sync | false for non-Windows, blank version or query failure; update write rejection propagates | Skip false results; report rejected registry update |

Node sidecar launch currently leaves an opened log descriptor unclosed on spawn failure. Sidecar shutdown can resolve after a failed final exit wait; successful resolution does not prove process death. Consumers requiring stronger cleanup must supply another launcher/provider.

## Guards and injected errors

Invalid quit phase throws `TypeError`. Guest preload validation and toolchain name/path/comment guards throw message-only `Error`. Toolchain filesystem writes propagate original errors after best-effort temporary cleanup. Presence writes propagate; reads tolerate inaccessible/malformed records; liveness treats `EPERM` as alive. Bounds reads return null on failure; bounds writes propagate.

Speech registration rejects missing guard with host-owned `Error` and invalid sample budget with `RangeError`. Speech calls reject untrusted/missing frame with host-owned `Error`, invalid rate/oversized recording with `RangeError`, malformed/nonfinite samples with `TypeError`; port rejection propagates. Direct encoder helpers can emit native Buffer/allocation errors and are not guarded like IPC.

Compilation returns `{ok:false,error}` for missing compiler/nonzero status. Availability converts that to `{available:false,reason}`; transcription throws host-formatted `Error`. Malformed helper JSON/fields and recognition failure use host messages. Filesystem/process/cleanup errors can propagate, and scratch removal errors in `finally` can replace a recognition error. There is no package transcription code taxonomy; consumers own wording and logs.

## Logging and fatal behavior

`appendLogLine` returns false on append failure; logger writes continue and console echo is enabled by default. Metadata serialization failure produces a fallback record. Lifecycle-log append failure is swallowed after successful parent creation; parent creation can reject.

Fatal process handlers swallow only the supplied harmless predicate (default matching `setTypeOfService` and authoritative `EINVAL` code). Other exceptions/rejections are logged and rethrown via `setImmediate`. Each handler removes only its own event listener before rethrow; the companion listener remains until the returned disposer runs. Do not treat these handlers as a recoverable error boundary.

Sources: [render](../../src/render-service.ts), [proxy](../../src/protocol.ts), [paths](../../src/paths.ts), [sidecar](../../src/sidecar.ts), [logging](../../src/logging.ts), [speech](../../src/speech/speech-ipc.ts).
