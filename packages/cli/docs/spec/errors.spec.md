Spec ID: SPEC-JINI-CLI-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:5724b339075fd52d22ac9e0b99d6457c315039d1a891f4c7c33cd9cd166cf47f
spec_mode: reverse_spec


# CLI error contract

## Process exits

`exitWithStructuredError({code,message}, {data?,exitCodes?,write?,exit?})` writes one JSON envelope plus newline and invokes exit. Default envelope is `{error:{code,message,data:{}}}`. Caller-supplied exit must never return. This primitive does not itself sanitize message/data.

| Code | Default exit | Trigger and caller response |
|---|---:|---|
| invalid-flag | 2 | Explicit command usage failure; binary also maps raw dispatch exceptions here. Fix invocation; this binary mapping can include non-input failures |
| daemon-not-running | 64 | Fetch connection failure; watch stream failure; unusable version response; structuredHttpFailure default fallback. Resolve URL/connectivity or inspect the daemon |
| missing-input | 67 | Required context-ref or run id absent. Supply required value |
| Consumer-defined code | Override table or 1 | Table entries override defaults; select recovery from the consumer's error contract |

JSON HTTP failures use one structured envelope. Recognized codes keep their mapped exits; unknown daemon codes are sanitized and otherwise default to exit 1, absent codes use `http-error`. Response-size failures use `response-too-large`, body-read failures use `request-failed`, both defaulting to exit 1. Network diagnostics are included in envelope data; the standalone `surfaceFetchError` helper still writes human-readable lines.

`structuredHttpFailure` accepts structured `{error:{code,message,data,details,retryable}}` and flat `{error:string}`. It strips controls from code, sanitizes message/data/details and otherwise uses HTTP status plus a bounded rawExcerpt. Its own text() read is not bounded. Explicit caller options can override its computed data.

## Exceptions and returned failures

| Surface | Type/outcome | Trigger | Caller response |
|---|---|---|---|
| Default text readers | `PayloadTooLargeError({message})` | File/stdin exceeds configured cap | Reduce input or deliberately increase cap |
| File/default stdin | Native I/O/abort rejection | Missing/inaccessible file, cancellation, stream error | Fix path/access or stop cancelled work |
| parseFlags | Plain Error | Unknown declared flag or absent trailing string value | Correct arguments; library callers catch it |
| resolveDaemonUrl | Plain Error | All URL sources exhausted | Supply flag/env/discovery/default |
| createLocalDaemonDiscovery | Plain Error synchronously | Neither path nor dataDir supplied | Fix composition |
| registry.add | Plain Error | Duplicate name without override | Choose unique name or explicitly override |
| registry.dispatch | Handler rejection | Registered handler throws | Host error boundary handles it |
| JSON HTTP body read | Structured exit (`request-failed`, default 1) | Body fails after fetch; size failures use `response-too-large` | Inspect the redacted envelope and retry only after resolving the underlying failure |
| watch initial fetch | Native fetch rejection | Failure occurs before its stream try/catch | Binary maps it; library caller must catch |
| introspection/rendering/serialization | Native exception | Invalid structural port or unserializable payload | Correct host input; no package-specific wrapping |

The internal ResponseTooLargeError is not exported and does not escape JSON HTTP's size-error branch. No other package error class exists. Successful HTTP data is `unknown` and must be validated by the consumer.

Evidence: `src/errors.ts`, `http.ts`, `prompt.ts`, `flags.ts`, `run-command.ts`, `main.ts`; static tests `errors.test.ts`, `http.test.ts`, `prompt.test.ts`. Tests were not executed.
