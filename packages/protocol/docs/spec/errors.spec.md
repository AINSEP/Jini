Spec ID: SPEC-JINI-PROTOCOL-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b6b6b3f857c1a092900135a2f542995d358b487f2cb23022c126f744393a2889
spec_mode: reverse_spec


# Protocol error contract

## Error payloads

No package-owned error class is exported. `ApiError` is data:

```ts
type ApiError = { code: ApiErrorCode; message: string; details?: JsonValue;
  retryable?: boolean; requestId?: string };
type ApiErrorResponse = { error: ApiError };
type ApiValidationIssue = { path: string; message: string; code?: string };
type ApiValidationErrorDetails = { kind: 'validation'; issues: ApiValidationIssue[] };
type RunErrorPayload = { message: string; error?: ApiError };
```

`LegacyErrorResponse` permits `{error:string}` or `{code:string,error:string}`. `CompatibleErrorResponse` permits a legacy shape or `ApiErrorResponse`. `ApiErrorCode` remains open to consumer-defined strings.

## Generic vocabulary

| Codes | Meaning for a consumer that selects the code | Caller response |
|---|---|---|
| `BAD_REQUEST`, `VALIDATION_FAILED` | Request or field validation failure | Correct input; show issues when supplied |
| `UNAUTHORIZED`, `FORBIDDEN` | Missing authentication or denied access | Establish identity or request an authorized action |
| `NOT_FOUND`, `CONFLICT` | Missing entity or state conflict | Refresh state and reconcile the request |
| `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Size or format refusal | Reduce or reformat payload |
| `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` | Capacity or upstream failure | Retry according to host policy and supplied retryable metadata |
| `TOOL_TOKEN_MISSING`, `TOOL_TOKEN_INVALID`, `TOOL_TOKEN_EXPIRED` | Tool credential failure | Acquire a valid credential |
| `TOOL_ENDPOINT_DENIED`, `TOOL_OPERATION_DENIED`, `TOOL_NOT_AVAILABLE` | Tool boundary refusal | Select an available, authorized operation |
| `INTERNAL_ERROR` | Internal failure | Surface requestId and use host recovery policy |

These constants never trigger errors by themselves. No HTTP status mapping or automatic retry is supplied. `retryable` is optional, with no implied default.

## Actual failures and non-error outcomes

| Surface | Outcome | Caller response |
|---|---|---|
| Zod `parse` | `ZodError` on schema violations | Treat as input failure; use issue paths without retrying identical input |
| Zod `safeParse` | Failure union instead of throw | Branch on success before using data |
| `encodeRunContextRef` | Native JSON serialization error for values outside the declared JSON contract, such as cycles or BigInt | Supply serializable data |
| `decodeRunContextRef` | `undefined` for unowned or malformed encoding | Use another host decoder or reject input; no exception is promised for these cases |
| `EventLog.replay` | unknown-run, invalid-cursor, replay-gap union | Follow [state.spec.md](state.spec.md); these are results, not exported exceptions |
| Host port implementation | Adapter-specific rejection | Apply adapter's error contract; this package does not wrap it |

Source: `src/errors.ts`, `registry.ts`, `run-context.ts`, `event-log.ts`; static evidence in `src/__tests__/index.test.ts` and `registry.test.ts`. No tests were run.
