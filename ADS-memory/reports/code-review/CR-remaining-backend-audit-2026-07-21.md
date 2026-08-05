# Code Review: remaining backend package audit (2026-07-21)

## Review target and verdict

- Target package state reviewed: `c781c4abf3` on `fix/stage-0-hardening-review-fixes`. Current HEAD became `4619baa2b` while the audit was running because the unrelated platform-test edit was committed; none of the seven target packages changed, so the source evidence remains valid.
- Scope: the complete current production source, package metadata/configuration, provenance notes, and tests in `packages/sqlite`, `packages/cli`, `packages/mcp`, `packages/registry`, `packages/memory`, `packages/media`, and `packages/capability-providers`—not only git changes.
- Inventory: 142 package files, including 116 `src/**` files and 48 test files. The reviewed package suites contain 701 tests.
- Architecture status: `sqlite` and `cli` are in the locked package set. `mcp`, `registry`, `memory`, `media`, and `capability-providers` are not in the locked architecture. The latter four are explicitly recorded as awaiting Coordinator/Software-Architect sign-off; `mcp` is absent from both the locked list and the root package-status list, so its architectural status is not even tracked consistently.
- Mode: advisory whole-package review. There is no approved feature-spec ID/hash, completed governance contract, Programmer handoff/function-quality table, TestRunner certification packet tied to a spec, or Coordinator verification packet. The source and test runs can be assessed, but the AI Dev Shop release gate cannot be certified.
- Verdict: **NOT SHIP-READY**. Guard, typecheck, all 701 tests, and explicit package-wide V8 coverage pass. Nevertheless, the locked sqlite/CLI milestones are not implemented according to their architecture, and the reviewed code contains critical/high filesystem, OAuth, configuration-secret, registry-integrity, and contract-correctness defects. One hundred percent structural coverage is not semantic correctness.

## Required findings

### CR-001 — Critical: `@jini/sqlite` exports the product-shaped synchronous database surface that the locked architecture explicitly excludes

**Classification:** `ARCHITECTURE_REVIEW_REQUIRED` + `IMPLEMENTATION_FIX_REQUIRED`  
**Release blocker:** yes  
**Coordinator route:** Software Architect, then Programmer/TDD recertification

The locked plan says the kernel surface has no projects or conversations, persistence ports are async-only, and `@jini/sqlite` is the default adapter behind core/daemon ports—not a home for a lifted application database ([extraction-plan.md](../../../ADS-memory/reports/jini-port/extraction-plan.md#L21), [async rule](../../../ADS-memory/reports/jini-port/extraction-plan.md#L76), [task-8 gate](../../../ADS-memory/reports/jini-port/extraction-plan.md#L149)).

The package barrel instead re-exports `db/index.ts` ([index.ts](../../../packages/sqlite/src/index.ts#L7)), which publicly exposes a synchronous singleton connection, raw `better-sqlite3` handles/`any` rows, schema migration, and direct projects/conversations/messages/agent-session CRUD ([db/index.ts](../../../packages/sqlite/src/db/index.ts#L1)). The schema contains `projects`, `conversations`, `pending_prompt`, chat/design/plan session modes, UI run status, and message payloads ([migrate.ts](../../../packages/sqlite/src/db/schema/migrate.ts#L18)). `projects.ts` even quotes the locked exclusion and then overrides it locally without an approved ADR ([projects.ts](../../../packages/sqlite/src/db/projects/projects.ts#L7)).

This is not an async adapter behind a port. Most methods are synchronous functions taking a driver handle, and `openDatabase` maintains a process-wide singleton that closes the prior caller's connection when a different path is opened ([connection.ts](../../../packages/sqlite/src/db/connection/connection.ts#L15)). The suite named as the package conformance suite is dominated by precisely the schema nouns the task-8 gate forbids ([db.test.ts](../../../packages/sqlite/src/db/__tests__/db.test.ts#L1)). There is also no compiling Postgres adapter stub, cancellation conformance, or versioned migration system; `migrate()` is only `CREATE TABLE IF NOT EXISTS`, so it cannot evolve an existing column layout.

Required resolution: remove the product database from the public engine adapter surface or obtain an explicit architecture change through the ADR/sign-off process. Keep only implementations of approved async ports, add real migration versioning and the full conformance gate, and relocate consumer-owned project/chat persistence to the consumer adapter.

### CR-002 — High: sqlite message writes are not ownership-scoped or atomic and can update one conversation while bumping another

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

`upsertMessage(db, conversationId, message)` detects an existing row solely by globally supplied message id, then updates it solely by id; it never verifies that the row belongs to `conversationId` ([messages.ts](../../../packages/sqlite/src/db/messages/messages.ts#L55)). It subsequently bumps the separately supplied conversation id ([messages.ts](../../../packages/sqlite/src/db/messages/messages.ts#L133)). A caller presenting message id `A/m1` with conversation id `B` modifies A's message and marks B active. In a multi-tenant or merely buggy host this is a cross-scope integrity failure.

The operation is also split across several statements without a transaction. New positions use `MAX(position)+1`; event appenders perform read/modify/write of `events_json`; concurrent connections can choose the same position or lose streamed events ([messages.ts](../../../packages/sqlite/src/db/messages/messages.ts#L92), [event append](../../../packages/sqlite/src/db/messages/messages.ts#L178)). The schema has no uniqueness constraint on `(conversation_id, position)`.

Required fix: scope every update/read by both owning context and id, make message insert/update/activity bump and event append atomic, and add adversarial tests using two conversations and two database connections.

### CR-003 — High: the CLI is a utility slice, not the locked HTTP-client transport, and its dispatcher misidentifies string flag values as commands

**Classification:** `ARCHITECTURE_REVIEW_REQUIRED` + `IMPLEMENTATION_FIX_REQUIRED`  
**Release blocker:** yes

The package itself states that no pack is registered and no HTTP-client-mode pack exists ([cli/index.ts](../../../packages/cli/src/index.ts#L4)). It has no executable/bootstrap, no service-principal path, and cannot satisfy the locked gate that the same fixture work via HTTP and CLI `--json --prompt-file` ([extraction-plan.md](../../../ADS-memory/reports/jini-port/extraction-plan.md#L150)).

Even the dispatcher is not safe for advertised global string flags: it picks the first non-dash token without knowing which preceding flag consumes a value ([command-registry.ts](../../../packages/cli/src/command-registry.ts#L55)). Thus `--daemon-url http://127.0.0.1:4111 run` attempts to dispatch `http://127.0.0.1:4111`. Tests cover only a boolean flag before the command, so they do not detect this failure ([command-registry.test.ts](../../../packages/cli/src/__tests__/command-registry.test.ts#L26)).

Required resolution: complete the approved CLI transport/bootstrap and use one parser/grammar to identify the subcommand after consuming global option values; certify it end-to-end against the same app-service/principal path as HTTP.

### CR-004 — High: CLI network and long-text paths are unbounded and error fallbacks disclose arbitrary daemon/network content

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

`postJsonToDaemon` provides no timeout, deadline, or caller `AbortSignal`, and buffers the entire JSON response ([http.ts](../../../packages/cli/src/http.ts#L69)). Prompt/body helpers read whole files and concatenate stdin until EOF with no size limit or cancellation ([prompt.ts](../../../packages/cli/src/prompt.ts#L43), [body reader](../../../packages/cli/src/prompt.ts#L98)). A stalled daemon or pipe can hang forever; a very large response/file/stdin can exhaust memory.

Error fallbacks print raw fetch-cause messages, arbitrary daemon JSON, or the complete non-JSON response body ([http.ts](../../../packages/cli/src/http.ts#L24), [http fallback](../../../packages/cli/src/http.ts#L99), [errors.ts](../../../packages/cli/src/errors.ts#L110)). Current tests affirm this behavior instead of checking redaction and bounds. These bodies may contain internal paths, provider errors, tokens, or echoed request data.

Required fix: add architect-approved cancellation/deadline and maximum request/response/text sizes, stream or reject oversized inputs, and map/redact untrusted error details before terminal output.

### CR-005 — Critical: MCP OAuth discovery and token flows permit SSRF, issuer mix-up, arbitrary schemes/endpoints, redirects, and unbounded responses

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

The OAuth chain fetches a caller-provided MCP resource URL, trusts its first advertised authorization server, discovers endpoints from that issuer, dynamically registers a client, and later calls its token endpoint ([oauth.ts](../../../packages/mcp/src/core/oauth.ts#L145), [beginAuth](../../../packages/mcp/src/core/oauth.ts#L604)). None of these hops restrict schemes to HTTPS, block loopback/private/link-local destinations, bind redirects, validate DNS after connection, cap response bytes, or apply a deadline. `fetchJson` simply calls injected/global fetch and `res.json()` ([oauth.ts](../../../packages/mcp/src/core/oauth.ts#L203)); DCR and token requests do the same ([oauth.ts](../../../packages/mcp/src/core/oauth.ts#L269), [token request](../../../packages/mcp/src/core/oauth.ts#L452)). `safeText` slices only after buffering the full response.

Discovery also accepts metadata whose `issuer` differs from the issuer queried and accepts arbitrary authorization/registration/token endpoint schemes. A hostile MCP URL or metadata document can therefore probe cloud metadata/internal services, redirect credentials, or mix one issuer's authorization with another issuer's token endpoint. The test suite explicitly preserves an issuer mismatch rather than rejecting it.

Required fix: define a single hardened outbound-fetch policy for every OAuth hop (scheme, destination/DNS, redirect, byte, time, and cancellation limits); validate RFC issuer/resource relationships and endpoint origins; validate response schemas; and add malicious metadata, redirect, rebinding/private-address, oversized, timeout, and cancellation cases.

### CR-006 — High: MCP writes API keys/client secrets with unsafe modes and uses lexical-only managed-project containment

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

`mcp-config.json` may contain arbitrary environment variables and headers, including API keys and Authorization values ([config.ts](../../../packages/mcp/src/core/config.ts#L33)), but its atomic temp/final writes never request owner-only permissions ([config.ts](../../../packages/mcp/src/core/config.ts#L247)). The OAuth client cache may contain `clientSecret` and is written the same way ([oauth.ts](../../../packages/mcp/src/core/oauth.ts#L253)). The token store writes the temp file with default permissions and chmods only after rename; it deliberately continues on `EPERM`/`ENOTSUP`, leaving a possible world/group-readable secret and a pre-rename exposure window ([tokens.ts](../../../packages/mcp/src/core/tokens.ts#L188)).

`isManagedProjectCwd` claims it is safe to authorize `.mcp.json` writes but performs only string-prefix containment ([config.ts](../../../packages/mcp/src/core/config.ts#L275)). A symlink under the managed projects root can resolve into an arbitrary user repository and cause a config write outside the managed tree.

Required fix: create secret-bearing temp files as `0600` atomically, define fail-closed/platform policy, validate final permissions, clean temp files on failure, and use realpath/descriptor-safe containment before any managed-project write.

### CR-007 — High: exported MCP JSON install helpers accept prototype-polluting paths

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

`applyJsonInstall` and `removeJsonInstall` are public functions accepting a public `JsonInstallPlan`. They traverse and assign arbitrary `keyPath` and `serverKey` values into normal JavaScript objects without rejecting `__proto__`, `prototype`, or `constructor` ([install.ts](../../../packages/mcp/src/agent-install/install.ts#L361)). A crafted plan can mutate prototypes, traverse inherited objects, corrupt subsequent operations, or delete inherited-looking keys. Internal planners currently use constants, but the exported runtime boundary does not enforce that assumption.

Required fix: runtime-validate plans, reject dangerous segments, use own-property checks and null-prototype records (or immutable safe merge), and add adversarial public-API tests.

### CR-008 — High: registry version resolution can claim a nonexistent exact/dist-tag version using unrelated top-level source and integrity

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes

For an exact request or dist-tag, `resolveRequestedVersion` returns the requested/tagged string without proving it exists in `entry.versions` ([versioning.ts](../../../packages/registry/src/versioning.ts#L93)). The caller then allows a missing version record and falls back to the top-level entry's source/ref/integrity while retaining the nonexistent requested version number ([versioning.ts](../../../packages/registry/src/versioning.ts#L65)). This can resolve/install bytes and integrity metadata for version X while reporting nonexistent version Y—a supply-chain identity failure.

Tests cover an unsatisfied caret range but not a missing exact version or a dist-tag pointing at a missing/yanked record. Required fix: require a matching, non-yanked version record whenever `versions` is authoritative, define legacy top-level-only behavior explicitly, and test exact/tag/yanked/integrity mismatch cases.

### CR-009 — High: registry backends do not enforce their protocol contracts at runtime and may mutate on dry-run, path-traverse, or report false success

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED` + `ARCHITECTURE_REVIEW_REQUIRED`  
**Release blocker:** yes

This is a cluster of boundary failures caused by trusting TypeScript types instead of parsing unknown/runtime input:

- `StaticRegistryBackend.list(filter?)` omits the filter parameter entirely and always drops yanked entries, ignoring the protocol's query/tags/publisher/includeYanked contract ([static-backend.ts](../../../packages/registry/src/static-backend.ts#L47)). `search` therefore cannot honor include-yanked behavior either.
- `DatabaseRegistryBackend.publish` ignores `request.dryRun` and always writes, yet reports `dryRun: false` ([database-backend.ts](../../../packages/registry/src/database-backend.ts#L37)). `yank` returns success when the requested version never existed ([database-backend.ts](../../../packages/registry/src/database-backend.ts#L51)).
- Database JSON is parsed without `RegistryEntrySchema`; malformed rows can crash every operation ([database-backend.ts](../../../packages/registry/src/database-backend.ts#L113)). Static/GitHub constructors similarly retain raw manifests; `doctor` directly dereferences malformed entries even though its purpose is to diagnose them ([static-backend.ts](../../../packages/registry/src/static-backend.ts#L119)).
- GitHub publish/yank build file and branch paths directly from unparsed `name`/`version`, permitting traversal/branch injection from an untyped JS caller ([github-backend.ts](../../../packages/registry/src/github-backend.ts#L82)). Its constructor also marks every configured repository `official` with no allowlist/signature proof ([github-backend.ts](../../../packages/registry/src/github-backend.ts#L56)), turning connection configuration into executable-content trust.
- GitHub yank reports `ok: true` when mutation support is unavailable; unlike publish, the outcome has no dry-run signal ([github-backend.ts](../../../packages/registry/src/github-backend.ts#L116)).

Required fix: parse every public request and every external/storage manifest with protocol schemas, implement list/dry-run/yank semantics exactly, reject unsafe path segments, and derive trust from approved provenance/signature policy rather than backend kind.

### CR-010 — High: the memory note store allows configured path escape and produces ambiguous partial success after writes

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes if this unapproved package is promoted

`createNoteStore` joins the public `subdir` option directly under each caller-provided `dataDir` without validating that it is contained ([note-store.ts](../../../packages/memory/src/note-store.ts#L136)). A `../` subdirectory can move the entire store, config, index, deletes, and note writes outside the intended root. Note names/descriptions are also inserted into the human-editable Markdown index without escaping; embedded newlines/link syntax can inject active-set bullets ([note-store.ts](../../../packages/memory/src/note-store.ts#L287)).

Writes are multi-file and non-atomic (`entry` then `INDEX.md`), and `emitChange` invokes user listeners synchronously after disk mutation without failure isolation ([note-store.ts](../../../packages/memory/src/note-store.ts#L142), [upsert](../../../packages/memory/src/note-store.ts#L324)). A throwing listener rejects the API even though the write already committed; an index failure leaves an unindexed entry. Broad catches also turn permission/corruption failures into default-enabled/default-index/not-found states.

Required fix: validate/realpath-contain the configured directory, escape or structurally render index entries, use atomic/serialized update semantics, isolate observer failures, and distinguish `ENOENT` from operational/corruption errors. Add traversal, symlink, listener-throw, and partial-write tests.

### CR-011 — High: memory's self-verification enforcer fails open for malformed or unknown scorecard statuses

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `TDD_RECERTIFICATION_REQUIRED`  
**Release blocker:** yes if this unapproved package is promoted

`VerifyScorecardRow.status` explicitly permits any string. `enforceVerify` counts only exact lowercase `'fail'` as a failure, so rows marked `error`, `unknown`, `FAIL`, or any malformed value pass if their text covers the rules ([verify.ts](../../../packages/memory/src/verify.ts#L132)). An enforcer consuming model-generated/extracted scorecards must not convert invalid output into success.

The tests cover only valid `pass`/`fail` values. Required fix: schema-validate the extractor result and fail closed (or return a distinct invalid/missing status) for unknown status, non-array rows, malformed row text, duplicates/ambiguous coverage, and extractor exceptions.

### CR-012 — Critical: media attachment staging can escape its root and prune/delete files through an arbitrary or symlinked staging directory

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED`  
**Release blocker:** yes if this unapproved package is promoted

`createFsAttachmentStaging` joins public `stagingDirName` directly under `cwd` and then creates, enumerates, stats, removes, and copies files there ([staging.ts](../../../packages/media/src/staging.ts#L69)). A `../outside` value or an existing symlink can redirect the pruning loop outside `cwd`. Because pruning deletes every file older than the configured TTL, this is a destructive path-escape primitive. A negative/non-finite `maxAgeMs` can also make every encountered file stale. The suite tests only a benign custom child directory.

The input list and copied file sizes are unbounded, and the realpath/stat/copy sequence has no descriptor-based race protection. Required fix: validate options, resolve and verify the final staging directory beneath a real root without following hostile symlinks, cap item count/bytes, and add traversal/symlink/negative-TTL/TOCTOU-oriented tests before exposing this implementation.

### CR-013 — High: media request/task primitives do not preserve policy and lifecycle invariants

**Classification:** `IMPLEMENTATION_FIX_REQUIRED` + `SECURITY_REVIEW_REQUIRED` + `TDD_RECERTIFICATION_REQUIRED`  
**Release blocker:** yes if this unapproved package is promoted

Two independent defects undermine the advertised ports:

- `buildVideoRequest` applies capability-supplied defaults and caller passthrough *after* constructing protected fields. If an externally registered capability allowlists `model`, `prompt`, `seconds`, `input_reference`, etc., passthrough overwrites the policy-resolved request ([video-request.ts](../../../packages/media/src/video-request.ts#L141)). A caller can be authorized for one model but dispatch another wire model/body. Tests prove filtering but never reserve core keys.
- `createInMemoryMediaTaskStore` claims a queued→running→terminal lifecycle but validates only enum membership, allowing terminal→running and arbitrary create states; duplicate ids silently overwrite tasks. It stores and returns live object/array references, so callers mutate state without `update`, and it accepts negative/non-finite TTLs ([task-store.ts](../../../packages/media/src/task-store.ts#L116)).

Required fix: reserve core request keys and bind policy evaluation to the final resolved request; validate capabilities/input at registration/build boundaries; enforce the documented task transition graph, duplicate policy, immutable snapshots, and numeric bounds.

### CR-014 — High: five reviewed packages have no locked-architecture approval, and speculative provider kinds violate the two-consumer/experimental gate

**Classification:** `ARCHITECTURE_REVIEW_REQUIRED`  
**Release blocker:** yes for any stable release/public contract

`registry`, `memory`, and `media` explicitly say they are outside the locked package set and await Coordinator/Architect approval ([registry source map](../../../packages/registry/source-map.md#L3), [memory source map](../../../packages/memory/source-map.md#L3), [media source map](../../../packages/media/source-map.md#L28)). `capability-providers` is greenfield, has no current consumer, and may never gain one ([capability source map](../../../packages/capability-providers/source-map.md#L72)). `mcp` is also absent from the locked set, but its source map does not identify an approval route.

The locked two-consumer rule requires two real consumers for a new provider kind or an `@experimental` tag blocking stable release ([extraction-plan.md](../../../ADS-memory/reports/jini-port/extraction-plan.md#L136)). `capability-providers` exports five new DI provider kinds with zero repo consumers and no experimental marker. Repository search likewise finds no production consumer for the media/memory primitives or CLI registry; MCP contains utilities but no generic MCP server consumer.

Required resolution: Coordinator/Software-Architect approval and ADR/API-snapshot review for each package; demonstrate two real consumers or mark/remove experimental surfaces. Do not infer maturity from 100% coverage. `mcp` must be described honestly as utilities only: its own source map says the stdio server/tool handlers were dropped ([mcp source map](../../../packages/mcp/source-map.md#L32)). Media similarly omits the actual multi-provider dispatch engine, and CLI labels itself a first slice.

### CR-015 — High: coverage is structurally complete but release evidence and behavioral risk coverage are incomplete

**Classification:** `TEST_EVIDENCE_INVALID` + `TDD_RECERTIFICATION_REQUIRED`  
**Release blocker:** yes for the AI Dev Shop pipeline gate

Fresh explicit `src/**` V8 runs show 100% statements/branches/functions/lines in all seven packages, with no executable file below 100%. This is useful evidence, but the checked-in gates are inconsistent: sqlite and MCP have no coverage configuration or script; CLI has no include/threshold; media and capability-providers have no explicit `src/**` include or threshold; only registry/memory set package-wide 99% thresholds. MCP's source-map coverage command is not present in its package scripts.

More importantly, tests chase branch coverage while missing the highest-risk semantics above: multi-connection ownership/concurrency, string-valued global flags, hung/oversized HTTP, OAuth SSRF/issuer mismatch rejection, secret modes/symlinks, prototype keys, exact-version mismatch, database dry-run/yank misses, note/staging traversal, malformed verify statuses, reserved media keys, and task transition/immutability. Several sqlite/memory tests manufacture driver/filesystem-impossible rows with proxies or `any` casts to hit defensive branches, while real adversarial boundaries remain absent.

Required fix: retain explicit package-wide V8 gates, but add risk-driven integration, mutation, concurrency, resource-bound, and security tests; provide a spec-linked certification packet and same-commit verification evidence before the pipeline can label the implementation releasable.

## Recommended findings

### CR-R01 — Tighten value validation and immutable reference behavior

- SQLite Postgres port parsing accepts `123junk`, negative, zero, and out-of-range ports via `parseInt(...) || 5432` ([backend-config.ts](../../../packages/sqlite/src/backend-config.ts#L48)); reject malformed values instead of silently changing configuration.
- Event-log options/cursors accept negative/fractional/non-finite retention or numeric cursor shapes; define the grammar and validate it at construction/replay.
- Capability-provider auth TTL accepts `NaN` (which makes expiry comparison fail open), payments accept `NaN`/`Infinity`/fractional cents and expose no idempotency key, and realtime stops delivery to later subscribers when one handler throws ([auth.ts](../../../packages/capability-providers/src/auth.ts#L57), [payments.ts](../../../packages/capability-providers/src/payments.ts#L41), [realtime.ts](../../../packages/capability-providers/src/realtime.ts#L39)). These speculative stubs should be unmistakably experimental/test-only, not production-looking defaults.
- Capability DB/media task/registry implementations return live nested references. Clone/freeze at in-memory adapter boundaries so test adapters do not teach behavior that durable adapters cannot reproduce.

### CR-R02 — Make persistence failure semantics explicit

MCP, memory, and registry frequently catch corrupted JSON or read errors and continue with an empty/default store. That is friendly for first run but dangerous for permissions/corruption: the next write can replace evidence or silently disable configuration/tokens. Distinguish not-found from malformed/unreadable state, retain recovery artifacts, and expose a typed diagnostic.

### CR-R03 — Add per-key single-flight and cleanup to OAuth client registration

`getOrRegisterClient` has no per-dataDir/issuer/redirect mutex, so concurrent first authorization flows can register multiple clients and lose a cache write ([oauth.ts](../../../packages/mcp/src/core/oauth.ts#L310)). Serialize registration and ensure temp files are removed after every error.

### CR-R04 — Align test organization and names with the pipeline test-design contract

All reviewed tests are in flat `src/__tests__` directories (with a few nested by source concern) and use generic `.test.ts` names. There is no documented project override for the required unit/integration/security organization and suffixes. Classify real SQLite/filesystem/process tests as integration, keep pure units separate, and make security/resource/concurrency suites independently runnable.

### CR-R05 — Correct stale/overconfident provenance documentation

Several source maps equate 100% branch coverage with completed quality and include historical assertions now false—for example `capability-providers/source-map.md` says `desktop-host` does not exist, while it is present in the current repository. SQLite calls projects/conversations "generic engine tables" despite the locked plan's explicit exclusion. Update provenance notes to distinguish port completeness, package completeness, architecture approval, and security readiness.

### CR-R06 — Reduce broad, loosely typed APIs and separate effects from policy

The implementations are generally readable at statement level, but several public APIs make invalid states easy and couple library logic to process/global effects:

- sqlite exports `DbRow = Record<string, any>`, inferred return objects, raw driver handles, and many unvalidated partial patches. This defeats compile-time contracts exactly where durable schema/API compatibility matters. Define domain-neutral port DTOs at approved boundaries and keep driver rows private.
- CLI's low-level HTTP helper owns terminal output and `process.exit` rather than returning a typed result/error to a bootstrap. That complicates embedding, composition, and cancellation. Move exit/render policy to the executable shell.
- MCP OAuth is one large module combining discovery, outbound HTTP, DCR caching, PKCE, token exchange, pending-flow lifecycle, and orchestration, with hidden global fetch/clock/filesystem effects. Split by trust boundary after defining shared validation and effect ports.
- memory requires `dataDir` on every store method despite `createNoteStore` already being a factory, and exposes untyped `EventEmitter`s. Binding the root and publishing typed subscription methods would remove repeated path authority and improve API ergonomics.
- media task `surface` is `string` even though the package defines `MediaSurface`; capability registry accepts only partially checked objects; registry backend methods accept compile-time-typed values but act as runtime boundaries. Parse once at ingress and keep inner code strongly typed.
- capability-provider methods use generic `Error` strings and offer no error codes, idempotency contract, cancellation, or transactional boundary. Resolve those API decisions with real consumers before stabilizing the interfaces.

### CR-R07 — Remove misleading claims and coverage-shaped branches/tests

- SQLite's source map says event retention defaults to 2,000 while the implementation and tests say omission is unbounded ([source-map.md](../../../packages/sqlite/source-map.md#L17), [event-log.ts](../../../packages/sqlite/src/event-log.ts#L24)). This changes durability/disk behavior and must have one authoritative contract.
- The registry test titled “does not contain every query term” supplies only one term, while implementation admits an entry when *any* term matches and calculates a fractional score ([static-backend.test.ts](../../../packages/registry/src/__tests__/static-backend.test.ts#L108), [static-backend.ts](../../../packages/registry/src/static-backend.ts#L73)). Decide and document AND-vs-OR semantics, then assert a genuine multi-term case.
- Multiple tests use proxy/fake driver rows specifically described as unreachable, or cast impossible input through `any`, to close coverage branches. Keep genuinely defensive parsing at unknown boundaries, but remove impossible inner branches or test the real ingress validator instead of inflating semantic confidence.

## Maintainability, readability, design, and API assessment

- **Readability:** most individual functions are small or well-commented, and the package/source maps provide unusually strong provenance. However, many comments narrate TypeScript control-flow proofs or defend contested architecture rather than documenting stable invariants. The sqlite project/conversation rationale is especially problematic because prose is being used as a local architecture waiver.
- **Maintainability:** risk is concentrated at composition seams: process-wide sqlite state, duplicated filesystem atomic-write patterns with different permission behavior, loosely typed `DbRow`/JSON shapes, and large multi-responsibility OAuth/registry classes. These make future Postgres, alternate hosts, and security hardening expensive.
- **Design quality:** the event-log transaction/cursor design, immutable storage byte copies, injected clocks in several stubs, media pure request shaping, and schema-based registry protocol are good foundations. Their value is undercut where concrete implementations bypass those abstractions or do not parse at runtime.
- **API ergonomics:** null/undefined conventions and error behavior vary across packages; some library calls throw, some return null, some silently ignore, and CLI helpers exit the process. Public factories often accept authority-bearing paths/options without validation. Stable APIs should use typed results/errors, explicit cancellation, immutable snapshots, and one clear ownership scope.
- **Race/resource/error handling:** sqlite read/modify/write flows, OAuth client registration, memory multi-file updates, and filesystem staging lack the required atomicity/single-flight/containment. CLI/OAuth/file paths lack consistent time/byte/item bounds. Broad catches frequently erase the difference between “not found” and “corrupt/unreadable.”
- **Dead/misleading code and docs:** coverage-driven impossible-state tests, stale source-map claims, inconsistent retention defaults, and package names that imply full CLI/MCP/media functionality make the implementation look more complete than it is. The code should retain honest “utility/substrate/experimental” naming and status until the missing runtime spine exists.

## Package-level code/test verdict

| Package | Architecture | Code/test verdict | Main blockers |
|---|---|---|---|
| `@jini/sqlite` | Locked | **Blocked** | CR-001/002: wrong public persistence shape, synchronous product schema, no versioned migrations/cancellation/Postgres conformance, cross-conversation non-atomic writes. |
| `@jini/cli` | Locked | **Blocked** | CR-003/004: first-slice utilities only, invalid command discovery with string flags, unbounded I/O, raw error disclosure. |
| `@jini/mcp` | Not locked/status inconsistently documented | **Blocked; utilities only** | CR-005/006/007/014: OAuth SSRF/mix-up, secret modes, symlink containment, prototype pollution, no generic stdio server/framing/tool authorization/cancellation. |
| `@jini/registry` | Not locked; sign-off pending | **Blocked** | CR-008/009/014: version/bytes mismatch, ignored filter/dry-run, false yank success, unvalidated manifests/paths, unjustified official trust. |
| `@jini/memory` | Not locked; sign-off pending | **Blocked** | CR-010/011/014: filesystem escape/partial write semantics and fail-open self-verification. |
| `@jini/media` | Not locked; sign-off pending | **Blocked; substrate only** | CR-012/013/014: destructive staging escape, policy-request override, unenforced task lifecycle; live dispatch engine is explicitly absent. |
| `@jini/capability-providers` | Not locked; speculative/no consumers | **Architecture-blocked** | CR-014 plus CR-R01: violates two-consumer/experimental gate; test stubs expose unsafe production-looking auth/payment semantics and reference aliasing. |

## Function Quality Assessment

- Status: **BLOCKED**.
- Missing required Programmer assessments/handoff rows: all materially reviewed units; there is no assessment inventory, score-skepticism evidence, or spec-to-function mapping.
- Lowest representative score: **40/100** — MCP `beginAuth` plus discovery/fetch chain (multi-hop untrusted outbound effects with no destination, issuer, time, byte, redirect, or cancellation policy).
- Critical units: sqlite public `db/` assembly (architecture), MCP OAuth chain (security), media filesystem staging (destructive containment).
- High-risk cross-item interactions: CLI error/body buffering; registry version-to-bytes identity; sqlite message ownership/activity; memory store+index+observer partial commits; media policy→capability→final request; capability-provider kinds→core DI tokens without consumers.

Representative reassessment:

| Unit | Score | Main reason below 100 |
|---|---:|---|
| sqlite public `db/` assembly / `openDatabase` | 45 | contradicts locked architecture; synchronous singleton and product schema escape the port boundary |
| `upsertMessage` / event append | 52 | cross-owner update and non-atomic ordering/event writes |
| `createSqliteEventLog` | 80 | sound transaction/cursor basis, but incomplete option/cursor validation and no cancellation/migration conformance evidence |
| `CommandRegistry.dispatch` | 65 | simple and readable, but command discovery ignores flag arity |
| `postJsonToDaemon` | 55 | no deadline/cancel/size/redaction contract at the primary CLI effect boundary |
| MCP OAuth discovery/`beginAuth` | 40 | critical SSRF/mix-up and unbounded multi-hop network trust |
| MCP config/token/client-cache writes | 55 | secret permission and realpath-containment invariants are not guaranteed |
| `applyJsonInstall` / `removeJsonInstall` | 55 | public unvalidated object-path mutation enables prototype pollution |
| `resolveRegistryEntryVersion` | 60 | version identity can detach from source/integrity bytes |
| registry backends | 55-68 | multiple protocol methods ignore runtime schemas and destructive/dry-run semantics |
| `createNoteStore` | 58 | path escape, multi-file partial commits, broad error swallowing, listener ambiguity |
| `enforceVerify` | 60 | malformed model output can become a passing verdict |
| `createFsAttachmentStaging` | 45 | destructive prune path is not contained against traversal/symlinks |
| `buildVideoRequest` / in-memory task store | 62 | protected fields are overrideable and lifecycle/immutability claims are unenforced |
| speculative auth/payment providers | 50 | intentionally insecure/non-idempotent stubs occupy production public names without experimental enforcement |

## Verification evidence and limitations

- `pnpm guard`: **PASS**, exit 0, 4.62s. Output still notes vocabulary-firewall/residual-JS allowlist TODOs.
- `pnpm typecheck`: **PASS**, exit 0, 89.12s.
- Package suites: **PASS, 48 files / 701 tests, no reported skips**:
  - sqlite: 5 files / 117 tests;
  - CLI: 9 / 110;
  - MCP: 7 / 132;
  - registry: 5 / 64;
  - memory: 6 / 100;
  - media: 9 / 126;
  - capability-providers: 7 / 52.
- Explicit V8 reruns used `--coverage.include='src/**'` with text/json-summary/json in isolated temp directories. All packages reported **100/100/100/100** statements/branches/functions/lines, with no executable file below 100:
  - sqlite: 903 statements / 369 branches / 62 functions / 903 lines;
  - CLI: 316 / 196 / 22 / 316;
  - MCP: 1,350 / 548 / 85 / 1,350;
  - registry: 424 / 235 / 29 / 424;
  - memory: 590 / 253 / 57 / 590;
  - media: 656 / 255 / 33 / 656;
  - capability-providers: 201 / 73 / 26 / 201.
- Type-only carve-outs: sqlite `src/db/core/types.ts` has a zero executable denominator; media `src/types.ts` is excluded and was verified to contain only erased type/interface declarations.
- Graph-first discovery was attempted as repository instructions require. The configured Codebase Memory MCP store for this agent did not contain a Jini project, so the review used the Coordinator's graph inventory/complexity results plus direct full-file inspection. No graph mutation/rebuild was attempted.
- No fixes or source/test edits were made during the audit. This report is the only file created by the Code Review agent.
- Active spec hash, completed governance contracts, test certification hash inventory, Programmer function-quality handoff, and Coordinator verification packet: **missing**. Therefore the release verdict remains advisory/blocked even though the executed commands are green.

## Security-review routing summary

Focused Security Agent review is required for CR-002, CR-004 through CR-010, CR-012, and CR-013. Highest priority: MCP's outbound OAuth chain; media staging deletion containment; MCP secret persistence and install-object mutation; registry version-to-bytes identity/trust; sqlite cross-context updates. Green unit tests and full line/branch execution do not establish these trust-boundary properties.
