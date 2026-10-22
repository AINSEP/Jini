Spec ID: SPEC-JINI-HTTP-KIT-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1f93012fe22452dc6ecb81674f88a33b8af603f86c3e2098d2a9bc0d517b39ec
spec_mode: reverse_spec


# HTTP-kit failures and recovery

## Exceptions

| Class/failure | Trigger | Consumer response |
|---|---|---|
| `ClientFacingError` | Caller explicitly constructs `{apiError}` for a nested, safe-to-disclose route failure | Adapter sends its code/message/metadata; choose safe text deliberately. |
| `InsecureOriginSourceError` | HTTP origin evidence without `source:'dev-capability'`; constructor `{message}` | Correct persisted evidence; do not reinterpret as trusted HTTPS. |
| `OriginNotVerifiedError` | Missing canonical repository evidence; constructor `{message}` | Register trusted evidence. Redirect/egress checks catch it and return false. |
| `TypeError` | Limiter check key absent/non-string/empty | Supply a nonempty identity key before retry. |
| Plain `Error` | Invalid boot origin config; duplicate guarded route registration | Fix configuration/composition before serving requests. |
| Raw adapter/OS/serialization errors | Counter store, scheduler, sink, serialization and native response operations can fail | Handle at the host boundary; no universal exception normalization exists outside mounted JSON routes. |

## JSON envelope and status mapping

Mounted JSON errors use `{error: ApiError}`. `ApiError` includes required `code`, `message`, optional protocol metadata such as `details`, `issues`, `requestId`. Unknown exceptions become `INTERNAL_ERROR`, message `an internal error occurred`, with random correlation id in `requestId`; raw exceptions reach the private sink. Most sinks must not throw. Explicit safe errors and Result failures are preserved.

| Code(s) | HTTP | When produced / caller action |
|---|---:|---|
| `BAD_REQUEST` | 400 | Shared parser validation, route/input semantics, invalid stream cursor, caller-safe delegated validation failure; inspect validation details and correct request |
| `UNAUTHORIZED` | 401 | Generic protocol authentication failure; authenticate |
| `FORBIDDEN` | 403 | Origin/local-peer/policy refusal; satisfy the required policy |
| `NOT_FOUND` | 404 | Unknown run/catalog/resource/terminal/task/storage/payment/record; correct id or refresh inventory |
| `CONFLICT` | 409 | Replay gap, terminal remote-run ingestion, unavailable installed editor; refresh state or resolve conflict |
| `PAYLOAD_TOO_LARGE` | 413 | Attachment/file/batch/storage quota; reduce payload or clean storage |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Supported protocol classification; use accepted content type |
| `VALIDATION_FAILED` | 422 | Explicit protocol classification; inspect supplied metadata and correct input. The current shared parser helper uses BAD_REQUEST instead. |
| `RATE_LIMITED` | 429 | Attachment concurrency rejection or caller-selected protocol error; retry when budget permits |
| `INTERNAL_ERROR` | 500 | Unexpected route/dependency failure; correlate with operator logs |
| `UPSTREAM_UNAVAILABLE` | 502 | Upstream classification; diagnose dependency |
| `SERVICE_UNAVAILABLE`, `NOT_CONFIGURED` | 503 | Readiness false or missing connector/research/xAI capability; configure/wait |
| `TOOL_TOKEN_MISSING`, `TOOL_TOKEN_INVALID`, `TOOL_TOKEN_EXPIRED` | 401 | Tool credential policy failures; obtain a valid credential |
| `TOOL_ENDPOINT_DENIED`, `TOOL_OPERATION_DENIED` | 403 | Executor/read-only/confirmation policy refusal; obtain permission or select an allowed operation |
| `TOOL_NOT_AVAILABLE` | 503 | Executor dependency unavailable; configure the capability |
| `TOOL_EXECUTION_FAILED` | 422 | Delegated failed result explicitly vouched model-safe by the host; act on the disclosed message |
| `REMOTE_TOOL_BRIDGE_NOT_CONFIGURED` | 503 | Dedicated bridge token absent; configure the host secret |
| `REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED` | 401 | Bridge bearer missing/malformed/wrong; supply the correct secret |
| `OAUTH_FLOW_IN_PROGRESS` | 409 | xAI callback listener already in use by an authorization; complete/cancel before restarting |
| Any unmapped ApiError code | 500 | No status entry exists; caller must not infer a client status from the name |


The fixed-window limiter returns a decision, not an error or HTTP response. Rejections include `retryAfterSeconds`; the host owns 429 and Retry-After wiring. Parsed JSON middleware sends the consumer's factory envelope at 413. Neither installs a global error vocabulary.

## Other middleware and stream shapes

Strict bearer uses `{error:{code:'API_TOKEN_NOT_CONFIGURED',message}}` at 503 or `API_TOKEN_REQUIRED` at 401. Optional bearer returns 401 `{error:'Unauthorized'}`. API-origin middleware returns 403 `{error:string}`. These handcrafted responses do not use the generic map.


## Ownership

Domain run/tool/attachment response behavior is owned by `@jini-ai/daemon/http`; settings errors are owned by `@jini-ai/cms/http/settings`. The generic status mapper still recognizes their protocol codes. Source evidence: adapter.ts, response.ts, request.ts, api-security-middleware.ts, rate-limit.ts and verified-origin errors.
