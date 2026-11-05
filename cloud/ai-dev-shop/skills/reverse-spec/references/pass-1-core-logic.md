# Pass 1: Core Logic Extraction

Load this file when executing Pass 1 of the reverse-spec DAG. Produces `artifact-1-core-logic.md`.

## References to Load

- `references/extraction-layers.md` — output schema for all requirements produced in this pass
- `references/characterization-tests.md` — capture methodology for Phase 1b

## Phase 0: Inventory Reconciliation

Load the CodeBase Analyzer inventory from `inventory.md` (produced in Step 1). Confirm each entrypoint exists by verifying route registration, job scheduling, or event binding. Augment with any entrypoints visible from test files, factory definitions, or route discovery during this pass.

Entrypoint types to verify/discover:

- HTTP routes (REST, GraphQL, WebSocket, server-rendered pages)
- Background jobs and scheduled tasks
- CLI commands and management tasks
- Event consumers (queue subscribers, webhook receivers)
- File import/export interfaces
- Admin-only workflows and generated admin endpoints
- External service integrations (APIs called, webhooks sent)
- Data stores and their schemas
- OS-level subprocess dependencies (media processors, PDF generators, system binaries)

Produce an updated **entrypoint map** with type, path, initial confidence, and discovery method.

**Reconciliation rules:**
- Entrypoints in the analyzer inventory that you can confirm → keep, mark `confirmed`
- Entrypoints in the analyzer inventory that you cannot reach from any code path → flag as `[AMENDMENT: inventory false-positive, unreachable]`
- Entrypoints you discover that the analyzer missed → add with note `discovered during Pass 1`

**Inventory feedback rule:** If later phases discover entrypoints missed here, update the inventory and note the addition. Inventory is a living artifact.

## Phase 1: Test-First Extraction

Tests are the most reliable behavioral evidence when they test behavior (not implementation).

1. Request/integration/system tests → endpoint contracts (inputs, outputs, status codes, auth)
2. Model/domain tests → business rules, validations, state transitions
3. Service/interactor tests → orchestration behavior and side effects
4. Factory/fixture definitions → valid entity shapes and relationships (confidence: `observed`)
5. Test helpers/shared contexts → cross-cutting behavior (auth, scoping, pagination)

**Test quality gate:** Before assigning confidence, classify each test:
- Does it assert on externally observable outcomes through public boundaries? → `tested`
- Does it assert on internal method calls, mock interactions, or private state? → `implementation-tested`
- Is it skipped, quarantined, flaky, or snapshot-only? → `test-claimed`

Factories and fixtures are `observed` shape evidence (kept green → reliable indicators).

## Phase 1b: Characterization Evidence Pack

For every critical entrypoint, state transition, job, and integration boundary:

1. Capture representative happy-path inputs and exact outputs
2. Capture representative failure inputs and exact error responses
3. Capture exact response shapes: status, headers, cookies, body
4. Capture database before/after state where safe
5. Capture emitted side effects: jobs enqueued, events published, webhooks sent, emails triggered
6. Capture edge cases: nulls, empty collections, bad auth, duplicate submit, large payload, invalid enum
7. Redact PII/secrets and store sanitized fixtures
8. Mark each sample with source (test fixture, runtime capture, manual), confidence, and date

**Output:** `characterization-tests/` directory with executable contract tests and `golden-fixtures/` with sanitized samples.

**Rule:** Critical behavior must have `tested`, `runtime-observed`, `contractual`, OR `characterized` evidence. Prose-only requirements are insufficient for critical paths.

## Phase 2: Code Extraction

Read implementation to discover behavior not covered by tests:

1. Route definitions → confirm endpoint inventory
2. Controllers/handlers → request validation, response shaping, error handling
3. Models/entities → validations, associations, lifecycle hooks, scopes/queries
4. Services/interactors → orchestration logic, external calls, side effects
5. Background jobs → trigger conditions, retry behavior, failure handling
6. Middleware/interceptors → cross-cutting concerns (auth, logging, rate limiting, CORS)
7. Configuration → feature flags, env-driven behavior, per-environment differences

**Exhaustive return type discovery (critical for dynamically-typed sources):**
For each public function/method, trace ALL return paths. Extract the union of possible return shapes. A function that returns `User | false | nil | [String]` depending on path must have all four shapes documented — strictly-typed targets will need explicit handling for each.

In languages with implicit returns (Ruby, Elixir, Kotlin expression bodies, etc.), evaluate the *last expression of every branch* — including nested conditionals, case/match arms, and rescue/catch blocks. Also scan for internal exception raising (`raise`, `throw`, `panic`) within called methods and treat propagated exceptions as alternative return shapes in the union.

**OS-level coupling scan:**
Search for subprocess calls (`exec`, `system`, `spawn`, backticks, `Process`, `subprocess.run`, `child_process`), library wrappers over system binaries (image processing, PDF generation, video transcoding, encryption CLI tools). Mark as `[ENVIRONMENTAL CONTRACT]` — target must provision the underlying dependency.

**Reachability verification:**
For each extracted behavior, record the call path from entrypoint to handler. Code that exists but is unreachable (no route, no caller, no job registration) is `[LIKELY DEAD CODE]`, not a requirement.

Mark requirements from code without tests as `observed`.

## Phase 2b: Inline Documentation Extraction

- **JSDoc/TypeDoc/YARD/RDoc/docstrings**: parameter types, return types, thrown exceptions, deprecation notices, access modifiers
- **OpenAPI/Swagger annotations**: inline route documentation (often more accurate than separate spec files)
- **Type annotations with runtime enforcement** (TypeScript strict, Pydantic, Sorbet): confidence `observed`
- **Type annotations without enforcement** (JSDoc only, Python hints without runtime check): confidence `documented-only`
- **Deprecation annotations** (`@deprecated`): mark requirement `status: deprecated`
- **TODO/FIXME/HACK comments**: known issues affecting migration decisions
- **Magic number comments**: business rules explained inline ("30-day grace period", "max 5 retries per spec")
- **Git history for business rationale**: when a requirement has a non-obvious constraint, check `git log -L` or `git blame` for the originating change, linked tickets, or PR descriptions explaining WHY

Comments explaining WHAT (redundant with code) → ignore. Comments explaining WHY (business rationale) → preserve as requirement context.

## Phase 3: Convention Scanner

Scan for implicit behaviors encoded by framework conventions:

**Lifecycle and persistence:**
- Auto-timestamps, soft deletes, default scopes, callbacks/signals, observers, versioning/audit

**Request/response:**
- Serialization rules, content negotiation, API versioning, pagination defaults, CSRF, CORS, sessions/flash/redirects

**Auth and access:**
- Authentication middleware, authorization policies, tenant scoping, policy scopes

**Framework magic:**
- Dynamic route generation, metaprogramming, monkey patches, service container/DI bindings, decorators/concerns/mixins, generated admin endpoints

**File and media:**
- Upload processing, limits, MIME validation, derivatives, signed URLs, storage lifecycle

**Server-rendered UI (when applicable):**
- Page routes, HTML forms (field names, validations, error display), redirects, flash messages, view-conditional rendering, template-driven behavior

**Internationalization/localization (when applicable):**
- Locale detection mechanism (header, cookie, URL prefix, user setting)
- String externalization (i18n key files, translation tables)
- Localized error messages, validation messages, email templates
- Currency/number/date formatting per locale
- RTL handling
- Pluralization rules
- Locale fallback chain
- Address/phone validation rules per region

Mark convention-based discoveries as `inferred` with the convention cited.

## Phase 3b: Numerical, String, and Semantic Precision

These cause silent data corruption that passes all tests. Extract explicitly:

**Numerical:**
- Decimal precision and storage (2, 4, or 8 places? float or decimal/integer-cents?)
- Rounding mode (banker's/half-to-even vs half-up vs truncation)
- Integer overflow behavior (wrap, arbitrary precision, exception, panic)
- Division by zero (NaN, Infinity, exception)
- Accumulation precision (running totals over millions of operations)

**String:**
- Unicode normalization (NFC vs NFD — affects equality, uniqueness, search)
- Case folding (locale-aware vs ASCII-only, Turkish İ/i)
- String length semantics (grapheme clusters vs codepoints vs bytes)
- Encoding assumptions and legacy data encoding

**Regex:**
- Engine semantics differences (PCRE backrefs/lookbehind vs RE2 limitations)
- Named capture syntax variations
- Unicode property support availability

**Ordering and comparison:**
- Default sort stability and engine-specific behavior
- Null ordering (nulls first/last, engine-dependent)
- Cursor pagination stability across ID strategies (autoincrement vs UUID)
- Collation rules (database vs application)

Mark as `[PRECISION CONTRACT]` — target must preserve exact semantics.

## Handoff Artifact: artifact-1-core-logic.md

Produce a structured artifact containing:
- Entrypoint map (with updates from extraction)
- Reachability graph (entrypoint → handler → services → side effects)
- Extracted requirements with confidence labels
- Characterization test references
- Precision contracts
- Environmental contracts
- Open questions discovered in this pass
