# Pass 3: Boundaries, Failures, and Compliance

Load this file when executing Pass 3. Reads `artifact-1-core-logic.md` and `artifact-2-data-access.md`. Produces `artifact-3-boundaries.md`.

## References to Load

- `references/extraction-layers.md` — output schema for all requirements produced in this pass

## Phase 7: Failure Matrix

For each entrypoint, extract ALL error behaviors systematically:

| Error Case | Status | Response Shape | Client-Facing Message | Headers | Evidence |
|------------|--------|---------------|----------------------|---------|----------|
| Invalid input | 422 | `{errors: [{field, message}]}` | Yes | — | test/request_spec |
| Unauthenticated | 401 | `{error: "unauthorized"}` | Yes | WWW-Authenticate | middleware |
| Unauthorized | 403 | `{error: "forbidden"}` | Yes | — | policy |
| Not found | 404 | `{error: "not found"}` | Yes | — | controller |
| Conflict/duplicate | 409 or 422 | varies | Yes | — | validation |
| Rate limited | 429 | `{error, retry_after}` | Yes | Retry-After | middleware |
| Payload too large | 413 | varies | Yes | — | config |
| Dependency failure | 503 or degraded | varies | Maybe | Retry-After | integration |
| Validation error detail | 422 | exact field-error shape | Yes | — | model/form |

### Protocol-Level Exactness

**Middleware inheritance:** For every endpoint, trace the entire middleware execution chain from routing layer to handler. Headers (security, CORS, caching, custom), status code overrides, and response mutations applied by global middleware, reverse proxies, or base controllers are part of the endpoint's contract — even if the handler never explicitly sets them. Cross-reference middleware identified in Pass 1 Phase 2.

Extract precise HTTP semantics that clients depend on:
- 204 vs 200 for empty success responses
- Empty body vs `{}` vs `null` vs `[]`
- Unknown/extra field tolerance (are unknown params silently ignored or rejected?)
- Accepted-but-ignored parameters ("no-op" compatibility)
- Multipart/form-data field names and file disposition
- Content-Type negotiation behavior
- Compression/encoding (gzip, chunked transfer)
- Streaming/chunked response behavior
- Redirect chains and their status codes (301 vs 302 vs 307)
- Cookie set/clear behavior per endpoint
- Idempotency header handling

### Dynamic Return Type Discovery

For dynamically-typed source languages, document the full union of possible return shapes per endpoint/function. A handler that returns different shapes depending on path (success object, error array, boolean, nil) must have ALL shapes documented so strictly-typed targets can handle each.

## Phase 8: Integration Boundary Extraction

For every external dependency:

- What it does (sends email, charges payment, fetches data)
- Contract: request/response format, auth mechanism, timeout
- Failure behavior: what happens when integration is down (error, fallback, degrade)
- Retry policy: count, backoff strategy, DLQ equivalent
- Rate limits imposed by external service
- Webhook/callback contracts (what we receive, what we send)

### Rate Limit Propagation

Bridge the failure matrix (Phase 7) with integration boundaries: when an external dependency hits its rate limit, document exactly what the calling entrypoint returns to the client. Map: "When Dependency X rate-limits → Entrypoint Y returns Status Z with Shape W." This may be a pass-through 429, an internal queue with delayed retry, a degraded response, or an unhandled 500.

### Silent Drop Detection

If a webhook or event consumer acknowledges receipt (returns 200) but triggers zero state mutations, zero side effects, and returns no data: flag as `[LIKELY DEAD CODE]` with subtype "silent drop." The target architecture needs to know it can safely black-hole this event without building domain logic.

### Async Job/Event Semantics (depth)

For each job, event, or queue consumer:
- Trigger condition and payload shape
- **Serialization wire-format:** Distinguish between the application-level arguments passed to a job (`ProcessInvoiceJob.perform_later(@invoice)`) and the actual serialized wire-format payload that passes over the queue (`{"args": [42]}`). If a framework implicitly converts complex objects into primitives (database IDs, strings, JSON subsets), the contract MUST record the primitive shape as the true input contract. The target must deserialize from primitives, not expect full domain objects. For typed binary wire formats (protobuf, Avro, MessagePack), record the schema definition or `.proto`/`.avsc` file reference as the contract.
- Ordering guarantee (FIFO, per-key, none)
- Retry count and backoff strategy
- Idempotency key and dedup window
- Timeout and DLQ behavior
- Concurrency limit (max parallel workers)
- Poison-message handling
- Scheduling delay (why wait N seconds between steps?)

### Third-Party API Versioning

External APIs (billing, identity, search) tie payload structures to the account's pinned API version, not the latest docs. Extract:
- Account API version for each external provider
- Payload shapes matching THAT version, not "current latest"
- Mark as `[HUMAN DATA REQUEST]` if version is dashboard-only and not accessible

### Client State Invalidation Contracts

- WebSocket/SSE broadcast events: event names, payload shapes, trigger conditions
- Long-polling release mechanisms and timing
- Cache-Control / ETag / Last-Modified headers per endpoint
- Push notification triggers (what server event → what mobile push)
- Stale-while-revalidate semantics

## Phase 9: Privacy, Compliance, and Security Primitives

### Privacy and Compliance

- Data export endpoints (GDPR right of access)
- Deletion/anonymization flows (right to be forgotten)
- Retention policies and automated purging
- Consent flags and enforcement points
- PII redaction in logs, exports, and API responses
- Audit event generation (what, when, who, what changed)
- Legal holds and their interaction with deletion
- Admin override and break-glass flows

### Security Primitive Extraction

Extract the exact mechanisms (target must implement equivalent security, even if mechanism changes):

- Password hashing algorithm and parameters (bcrypt cost, argon2 memory/iterations)
- Token signing algorithm, issuer, audience, expiration
- Session cookie: name, flags (HttpOnly, Secure, SameSite), domain, TTL, rotation
- Refresh token rotation and revocation behavior
- API key format, hashing/storage, and lookup mechanism
- Webhook signature verification (algorithm, header name, secret rotation)
- CSRF mechanism and token lifecycle
- CORS allowed origins, methods, headers, credentials behavior
- Field-level encryption (which fields, what algorithm, key management)
- Secret lookup and rotation behavior

### Performance Envelopes (from runtime evidence)

When runtime evidence is accessible, capture:
- Latency per endpoint: p50, p95, p99 (from APM/traces/logs)
- Throughput baselines (RPS, concurrent connections)
- Payload size limits (request body, response, uploads)
- Startup/warmup time (if autoscaled or serverless)
- Client-side timeout values that depend on server latency

These are not aspirational SLOs — they are the current envelope. Clients with hardcoded timeouts will break if the rewrite is significantly slower.

### Observability Contracts

Only extract observability output with known downstream consumers:
- Metric names and label schemas wired to alerts
- Structured log fields consumed by SIEM or dashboards
- Trace span names wired to latency SLO monitors
- Health-check endpoint response shape and expected timing

## Handoff Artifact: artifact-3-boundaries.md

Produce:
- Failure matrix per entrypoint
- Protocol-level exactness notes
- Integration inventory with contracts, retry, and failure behavior
- Async job/event semantics table
- Client state invalidation contracts
- Security primitives inventory
- Privacy/compliance behavior inventory
- Performance envelopes (when available)
- Observability contracts
- Open questions from this pass
- Amendments to earlier pass findings
