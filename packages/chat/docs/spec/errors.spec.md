Spec ID: SPEC-JINI-CHAT-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:e5548730f48d5d7af5f43c2de93146d7326f9f63fb37755137cc41277e4222ea
spec_mode: reverse_spec


# Error contract: @jini-ai/chat

## Structured storage errors

`ChatStoreError({code}, options?: ErrorOptions)` extends Error; name is `ChatStoreError`, code is stable and cause preserves the underlying failure. The required code is in an object. Public messages omit owner IDs, cursor values and SQL details.

| Code | Message | Trigger | Caller response |
|---|---|---|---|
| `invalid-input` | Invalid chat store input. | Invalid owner scope, mismatched kernel dialect/transport, invalid page limit, nonfinite sweep time or invalid sweep limit | Correct wiring/input; do not retry unchanged |
| `invalid-cursor` | Invalid chat page cursor. | Empty/oversize/non-base64url/malformed cursor; wrong version, owner, read kind or conversation; invalid anchor | Restart pagination without the cursor |
| `conflict` | Chat store conflict. | Unique violation while creating a conversation | Reconcile identity; do not treat as successful idempotent create |
| `unavailable` | Chat store unavailable. | Other operation/driver/serialization failure at the store boundary | Inspect cause privately; retry only after establishing a transient cause and mutation outcome |

`MessageConversationMismatchError({messageId, actualConversationId, requestedConversationId})` is exported from `/store/legacy/sqlite`. It has those three fields and no stable code. Legacy upsert throws it when a globally existing ID is presented for a different conversation. Correct the caller's identity mapping; never retry it against another owner. Raw SQLite and serialization errors otherwise propagate from legacy methods/schema helpers.

Missing/foreign-owned records use null/empty/no-op results rather than structured authorization errors. SQL factories do not supply HTTP status mappings; the host selects the public error envelope.

## UI and transport failures

| Surface | Failure representation | Caller response |
|---|---|---|
| `useChatTransport` without provider | Ordinary Error identifying missing JiniChatProvider | Supply transport or pass it directly to the hook/pane |
| `useRunStream` | Error in state; start failure can return null; stopRun teardown errors reported to console | Display state error; make an explicit retry/cancel decision |
| Attachment uploader | Ordinary Error for quotas, response failure/missing attachment; abort/timeout rejection | Reduce batch or retry after cleanup/outcome reconciliation |
| `createMcpUiToolCaller` | Ordinary Error with server message; optional `error.data = {code}` from response; AbortError becomes timeout message | Handle server code; do not redeem an expired/single-use confirmation again |
| Frontend bridge | ready rejection and onError callback; failed actions answered through respondError | Restore stream/credentials and rebind a new ready session |
| `ExtEventErrorBoundary` | Contained renderer fallback | Repair custom renderer; keep other message content usable |
| Pure parsers | null, empty result, repair attempt, or HTML validation union, depending on helper | Treat absence as unrecognized/incomplete data; do not convert it into a successful artifact |

There is no package-wide HTTP error class or catch-all retry policy. Consumer transport exceptions retain their native shape unless a named helper wraps them. Evidence: [store errors](../../src/store/errors.ts), [legacy messages](../../src/store/legacy/sqlite/messages.ts), [context hooks](../../src/react/hooks/context.ts), browser helper implementations and their tests.

## Dedicated entry failures

Session storage configuration errors throw Error; corrupted/oversized data, serialization and storage failures otherwise return empty/no-op outcomes. Invalid page-action cleanup deadline throws Error. Fetch-SSE HTTP/missing-body/frame-mapping failures reach RunHandlers/onLifecycle; abort/end settle once. Finalizer adapter failures are reported to the supplied onError boundary; that reporter must be safe. Terminal failure helpers return Error or null; these errors are not HTTP envelopes. Host ports remain responsible for authorization, retry policy and durable settlement.
