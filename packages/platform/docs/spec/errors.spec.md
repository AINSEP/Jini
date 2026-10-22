Spec ID: SPEC-JINI-PLATFORM-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:ffa1f8ca55112419cfae2a7ef694f608646f773dd86814b849588396aaa6c256
spec_mode: reverse_spec

# Error Contract: @jini-ai/platform

## Exported error classes

No universal error envelope or HTTP middleware is supplied. Callers handle thrown classes, native codes, or returned outcome unions according to the entry used.

| Class | Current constructor / properties | Conditions and caller action |
|---|---|---|
| `FetchTimeoutError` | `(url: string, timeoutMs: number)`; url/timeoutMs | Timeout caused fetch rejection, or guarded total deadline expired without caller cancellation; retry only if the operation is safe |
| `AssetCacheError` | `(status: number, message: string)`; status | 400 invalid/unsafe/nonmedia URL or unsafe DNS, 413 oversize, 415 unsupported media type, 502 fetch/upstream failure; correct URL/policy or retry transient upstream failure |
| `ManagedDownloadError` | `(code: ManagedDownloadErrorCode, message: string, details?: unknown)`; code/details | See code table below; preserve store ownership and checksum invariants |
| `StorageError` | `(code: 'NOT_FOUND' | 'TRAVERSAL' | 'IO', message: string)`; code | Missing blob, unsafe path, configuration/upstream/IO failure; resolve missing/unsafe input, diagnose IO before retry |
| `EgressRefusedError` | `({ message }, { callerSafeMessage?, messages? } = {})`; callerSafeMessage | Scheme/URL credentials/private-address policy refuses target; surface callerSafeMessage and correct policy/target without bypassing pinning |
| `FsFilePathError` | `({ message })` | Guarded path/deny/symlink/missing/nonfile/size/binary/read violation; choose an admitted path or explicit new limits, not an unsafe fallback |
| `UnusableRootKeyError` | `({ source: 'env' | 'file', reason: RootKeyRejection, message })`; source/reason | Invalid configured material; preserve the existing key and ciphertext while investigating replacement/recovery |
| `RootKeyFileAlreadyExistsError` | `({ keyFilePath })` | Exclusive explicit key generation sees EEXIST/ELOOP; inspect existing material, do not overwrite it |

Most named errors set their `.name`; named domain errors are documented in their owning packages, so use instanceof. RootKeyRejection values are empty/not-hex/odd-length/too-short. Parsed key validation returns `{ ok: false, reason, hexDigits }` rather than throwing by itself.

## Managed download codes

| Code | Trigger | Caller action |
|---|---|---|
| `aborted` | Caller wait signal aborts | Stop waiting; shared transfer may still run |
| `checksum-mismatch` | Downloaded/copied bytes differ from expected digest | Reject bytes; verify URL/checksum before a new attempt |
| `invalid-target` | Invalid path segments/base/output/checksum/URL | Correct supplied target metadata |
| `network-exhausted` | Attempt loop exhausted (default 3) | Diagnose network/streaming cause; use a bounded fetch when retrying |
| `output-conflict` | Existing output contains different bytes | Select a different path or reconcile existing output |
| `store-corrupt` | Repeated state reset/unhashable or missing promoted data/invalid complete state | Inspect and repair the owned store; do not silently accept bytes |
| `store-not-owned` | Missing/invalid ownership sentinel or unsafe/nonempty unowned base | Select a new empty base or an already-owned store |
| `target-conflict` | Active same target has a different download identity | Await/reconcile active work or choose another target |
| `target-locked` | Another live lock/task holds the target | Wait for owner completion; never remove a live lock blindly |

`MANAGED_DOWNLOAD_ERROR_CODES` maps uppercase constant names to these strings. Native filesystem errors can also escape; prune reports per-target warnings, and copy-and-clear reports cleanupWarning with cleanup deferred.

## Mail failures and returned outcomes

Production notification readiness failure throws a plain Error prefixed `MAILER_SEND_REFUSED_NO_DURABLE_PATH`. No structured code property exists. Provide the durable path/readiness registration before sending; interactive lane is only for genuinely interactive consumer flows.

SMTP converts send/clock exceptions to `{ ok: false, retryable, errorCode, message }`. Numeric responseCode becomes `SMTP_<number>` and is retryable only for 400..499. Without numeric code, EAUTH/EENVELOPE/EMESSAGE are nonretryable; other string codes are retryable. Unknown errors become retryable SMTP_UNKNOWN_ERROR. The adapter itself never retries. Caller messages can contain original transport exception text and need boundary-level presentation policy.

## Other failures and nonthrowing cases

| Entry | Failure/outcome | Caller action |
|---|---|---|
| Guarded factory/send | TypeError for missing UA or invalid integer policy/request bounds | Correct configuration before dispatch |
| Guarded HTTP transport | Plain idle-timeout/absolute-size/decompression/network errors; caller abort preserved; empty DNS Error | Retry only admitted targets and safe operations; inspect original exception |
| guardedFetch | Plain Error on policy truncation; Response construction may reject unsupported status/body combinations | Increase an intentional cap or use a partial-result API; do not parse truncated credentials/documents |
| Native primitive copy | EEXIST for existing destination, native filesystem failures | Reconcile destination; enable overwrite only when intended |
| Atomic writer | RangeError unsafe temp segment; TypeError unserializable JSON; native stat/write/chmod/rename errors | Fix input/permissions; leave destination intact on pre-rename failure |
| Durable JSON | TypeError for invalid path/interval/wait/salvage bounds; caller-text lock timeout Error; native write/rename errors | Keep corrupt evidence; use synchronous locking and repair storage |
| Keyring/sealer | Missing host-option TypeError, unavailable-key Error, fixed-key parse Error, algorithm/tag errors or crypto failures | Supply valid stable keys/salt/AAD; never return unauthenticated plaintext |
| Paths/sandbox | Plain config/containment/writability/package-resolution Error | Correct configured roots/permissions/package name |
| Spawn/stop/snapshot | Native child-process/OS errors; missing PID Error | Inspect executable/permissions; stop reports only after successful signaling |

`removePathBestEffort` returns removed false/error; `readLogTail` returns [] on failures; process-stamp reading returns null on failed normalization. Terminal get/attach/write/resize/kill return null/status/false for absent or unusable sessions. Native PTY creation and sink callbacks can throw. Durable reads return missing/unreadable rather than raising; quarantine false signals move failure unless the reporting port throws.

Evidence: error/source declarations and corresponding tests listed in `api.spec.md`; no runtime validation performed.


`FileLockTimeoutError` reports lockPath/holder/waitedMs; `FileLockLostError` reports lockPath when assertHeld observes lost authority. Timeout construction takes `{lockPath,holder,waitedMs}` and optional `{message?,messages?}`; lost-lock construction takes `{lockPath}` and optional `{messages?}`. Neither accepts ErrorOptions. Atomic permission/symlink policy failures and fsync/native filesystem errors propagate. After rename, a directory-sync rejection does not imply old bytes remain.
