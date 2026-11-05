# Characterization Tests — Golden-Master Methodology

Use this reference during Phase 1b (Pass 1) to produce executable evidence from the running source system.

## Purpose

Prose requirements are ambiguous. Characterization tests give the rewrite something objective to pass: exact inputs → exact outputs captured from the real system. They are the ultimate "did we get it right?" oracle.

## What to Capture

For every **critical** entrypoint (defined as: touches money, touches PII, has > 1000 daily calls, has known-fragile clients, or is in the security/auth path):

### Happy Path Samples
- Representative request (method, path, headers, body, auth)
- Exact response (status, headers, body — byte-for-byte where feasible)
- Database state before and after (relevant tables only, not full dump)
- Side effects triggered (job payloads, event payloads, email trigger data)

### Failure Path Samples
- Invalid input → exact error response
- Unauthenticated → exact 401 shape
- Unauthorized → exact 403 shape
- Not found → exact 404 shape
- Conflict/duplicate → exact response
- Rate limited → exact 429 + Retry-After
- Dependency failure → exact degraded response or error

### Edge Cases
- Null/empty/missing optional fields
- Maximum payload size
- Unicode in all string fields
- Duplicate submission (idempotency behavior)
- Concurrent identical requests (race behavior)
- Expired/invalid auth tokens
- Enum values at boundary (legacy values, unknown values)

## Capture Sources

Ordered by reliability:

1. **Replay from production traffic** (redacted) — most accurate but requires access and PII handling
2. **Integration test fixtures** — pre-built realistic scenarios
3. **Manual capture from staging** — run the endpoint, save request/response
4. **Factory-generated samples** — synthetic but schema-correct
5. **API documentation examples** — least reliable (may be outdated)

## Redaction Rules

Before storing:
- Replace real PII with stable fake data (same format, consistent across samples)
- Replace secrets/tokens with `REDACTED_<type>`
- Preserve data relationships (user_id references must still be internally consistent)
- Keep field types, lengths, and special characters intact
- Document redaction method in `redaction-log.md`

**Dynamic crypto exception:** Tokens, signatures, session hashes, and encrypted values that are the *direct output* of the logic under test must NOT be redacted to static placeholders. A static `REDACTED_TOKEN` would let a broken implementation pass tests by hardcoding the string. Instead, apply the `format_only` nondeterminism comparison mode: store a representative value and assert on entropy, length, format pattern, and structural validity — not literal equality.

## Storage Structure

```
characterization-tests/
├── <module>/
│   ├── <endpoint-slug>/
│   │   ├── happy-path-001.json    (request + response + side-effects)
│   │   ├── error-invalid-001.json
│   │   ├── error-unauth-001.json
│   │   └── edge-null-fields-001.json
│   └── ...
├── golden-fixtures/
│   ├── users-sample.json          (representative entity shapes)
│   ├── orders-sample.json
│   └── ...
├── equivalence-matrix.md          (old-system-vs-new-system test plan)
└── redaction-log.md               (what was redacted and how)
```

## Nondeterminism Normalization

Golden-master tests become flaky or accidentally preserve irrelevant randomness unless dynamic fields are classified and normalized before comparison.

**Dynamic field categories:**

- Timestamps (`created_at`, `updated_at`, JWT `exp`/`iat` claims, relative age calculations)
- Generated IDs (auto-increment, UUIDs, ULIDs, random tokens)
- Signed URLs (S3 presigned, CloudFront signed, webhook signature headers)
- Pagination cursors (opaque, base64-encoded, offset-based)
- Request/trace IDs (`X-Request-Id`, correlation IDs, span IDs)
- Temporary filenames (upload paths, cache keys with timestamps)
- Unordered collections (arrays where order is not contractually guaranteed)
- Floating-point/decimal outputs (platform-dependent rounding)
- Third-party provider IDs (Stripe charge IDs, SendGrid message IDs)
- Localized date/number formatting

**Comparison modes per field:**

| Field Type | Comparison Mode | Rule |
|---|---|---|
| Timestamps | `semantic_time` | Must be valid ISO-8601; within allowed window of test execution |
| Generated IDs | `format_only` | Must match external ID format/prefix; exact value ignored |
| Unordered arrays | `unordered_set` | Compare by stable key (e.g., `id`); ignore ordering |
| Signed URLs | `structure_only` | Host/path pattern valid; signature/expiry params ignored |
| Monetary amounts | `exact_decimal` | Exact precision and rounding required — no tolerance |
| Trace/request IDs | `presence_only` | Must be present and non-empty; value ignored |
| Pagination cursors | `format_only` | Must be decodable/valid format; exact value ignored |

**Temporal normalization rule:** For any time-dependent field (age calculations, expiration checks, relative timestamps), either:
1. Flag with `[DYNAMIC_TIME]` placeholder in the golden fixture and document the expected computation, OR
2. Require the test harness to execute with a frozen system clock set to the ISO-8601 timestamp recorded in the Extraction Manifest.

**For each characterized endpoint, produce a normalization table** listing which response fields are dynamic and their comparison mode. This table ships alongside the golden fixture file.

## Equivalence Matrix

For each characterized endpoint:

| Endpoint | Sample Count | Confidence | Parity Test Strategy | Notes |
|----------|-------------|-----------|---------------------|-------|
| POST /users | 5 happy, 4 error | tested | replay against both, diff response | ignore timestamps, compare structure |
| GET /invoices/:id | 3 happy, 2 error | observed | replay, compare body shape | amount precision critical |

## When Characterization Tests Are Mandatory

- Any endpoint handling money/payments
- Authentication/authorization flows
- Data export/deletion (compliance)
- Endpoints with known-fragile consumers (mobile apps, partner integrations)
- Behavior where prose spec is ambiguous

## When They're Optional

- Internal admin endpoints with single human consumer
- Read-only list endpoints with no pagination quirks
- Recently-written endpoints with comprehensive behavior tests

## Relationship to Other Evidence

Characterization tests do NOT replace behavioral specs. They complement them:
- Spec says "returns 201 with user object" (the contract)
- Characterization test shows `{"id": 42, "email": "...", "created_at": "2026-..."}` with exact shape (the evidence)

Both are needed. The spec is what the rewrite targets. The characterization test is how you verify you hit it.
