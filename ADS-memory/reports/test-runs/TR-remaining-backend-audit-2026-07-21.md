# TestRunner report — remaining backend package audit

Date: 2026-07-21  
Agent: TestRunner (AI Dev Shop pipeline)  
Scope: packages/sqlite, packages/cli, packages/mcp, packages/registry, packages/memory, packages/media, packages/capability-providers

## Executive verdict

Observed execution is green: root guard and typecheck passed, all 48 package test files passed all 701 tests, and an explicit V8 run over src/** reported 100% statements, branches, functions, and lines for every executable production file.

Release/test certification is nevertheless **BLOCKED**. The green result proves the current implemented primitives execute as asserted; it does not prove release completeness or protocol conformance:

1. No approved feature spec, spec hash, test certification, test-file hash inventory, expected runnable-test count, tasks.md coverage profile, or acceptance matrix exists. Formal certification and convergence are unavailable.
2. The 48 tests use generic *.test.ts names in undifferentiated __tests__ directories. Unit and integration evidence cannot be routed or gated independently, and no documented project convention override exists.
3. @jini/mcp has no MCP stdio server, framing, tool-dispatch, authorization, cancellation, or unknown-method implementation. Its 100% result covers config/OAuth/token/install/planner utilities only.
4. @jini/cli has no runnable CLI bootstrap or registered pack. Its tests do not exercise a process-level CLI/daemon journey, HTTP cancellation/timeout, bounded stdin/file input, or redaction behavior.
5. @jini/media deliberately omits the live vendor dispatch engine. Its 100% result covers catalogues, request shaping, staging, policy, and an in-memory task store, not media generation.
6. High-priority persistence/filesystem assertions remain absent: true multi-connection SQLite contention/idempotency, atomic concurrent note writes, symlink/race containment, and strict task-transition invariants.
7. @jini/mcp, @jini/registry, @jini/memory, @jini/media, and @jini/capability-providers are outside extraction-plan.md section 3's locked package set and have no Coordinator/Software-Architect sign-off.

Coverage gate status: **PASS for the combined package test runs used as a strict 98% proxy; no executable coverage gaps.**  
Overall package release-readiness status: **FAIL / COVERAGE_TRIAGE_REQUIRED and TDD_RECERTIFICATION_REQUIRED before a release claim.**

## Inputs and audit boundary

Read before execution:

- AGENTS.md
- AI-Dev-Shop/AGENTS.md
- AI-Dev-Shop/agents/testrunner/skills.md
- activated general-behavior, code-navigation, codebase-graph, test-design, verification-before-completion, and architecture-decisions guidance
- ADS-memory/reports/jini-port/START-HERE.md
- ADS-memory/reports/jini-port/extraction-plan.md
- ADS-memory/.local-artifacts/handoff/20260721T160145Z-handoff.md
- governance contracts: architecture-fitness, computational-controls, runtime-validation, specs-as-built-freshness
- ADS-memory/governance/adrs/ADR-INDEX.md
- every target package manifest, tsconfig, coverage config, source-map, production source file, and test file

The governance command contracts are still DRAFT placeholders and the ADR index has no entries. No feature certification or expected-count inventory was found.

No source, test, or package configuration was changed during this audit.

## Revision and concurrent-work note

- Audit-start HEAD: c781c4abf3afbe454d4d2a431a62853678ed1120
- Final HEAD: 4619baa2b62c
- The only concurrent code change was packages/platform/src/__tests__/download.test.ts, committed as 4619baa2b while this audit was running.
- Root guard/typecheck observed the same platform test content before it was committed. All target package trees are unchanged between the two revisions; git diff over the seven target paths is empty.
- At the final revision check before report writes, the worktree had only the unrelated untracked session handoff artifact; this report and the concurrently produced review reports are expected new audit outputs.

## Discovery and denominator

Codebase Memory MCP capability validation reported enabled. The MCP connector transport itself returned Transport closed, so discovery used the validated local Codebase Memory CLI with CBM_CACHE_DIR pointing at the project-owned cache. Its index was ready at audit-start HEAD with 52,950 nodes and 129,394 edges. Graph file inventory was then validated on disk.

| Package | Production source | Test files | Total src files |
|---|---:|---:|---:|
| sqlite | 21 | 5 | 26 |
| cli | 9 | 9 | 18 |
| mcp | 10 | 7 | 17 |
| registry | 5 | 5 | 10 |
| memory | 6 | 6 | 12 |
| media | 10 | 9 | 19 |
| capability-providers | 7 | 7 | 14 |
| **Total** | **68** | **48** | **116** |

Of 68 production files, 66 contain executable JavaScript after TypeScript erasure. packages/sqlite/src/db/core/types.ts and packages/media/src/types.ts are type/interface-only and are classified as exempt, not silently removed from the package denominator.

## Fresh root checks

| Check | Result | Evidence |
|---|---|---|
| pnpm guard | PASS | exit 0; 4.62s; self-test passed and zero violations in packages |
| pnpm typecheck | PASS | exit 0; 89.12s; all workspace typechecks and scripts tsconfig completed |

Guard caveat: its own success output states that vocabulary-firewall and residual-JS-allowlist checks are still TODO. A green guard result does not prove those unimplemented checks.

## Full package suite matrix

Commands: pnpm --filter @jini/PKG test, run fresh for each package.

| Package | Test files | Tests passed | Failed | Skipped | Vitest duration | Evidence class |
|---|---:|---:|---:|---:|---:|---|
| sqlite | 5 | 117 | 0 | 0 | 11.89s | mixed: real temp-file SQLite plus unit/fake-driver cases |
| cli | 9 | 110 | 0 | 0 | 11.40s | mixed: unit/fake fetch plus limited real file/stdin I/O |
| mcp | 7 | 132 | 0 | 0 | 10.40s | mixed: real config/token files; mocked network; no MCP server |
| registry | 5 | 64 | 0 | 0 | 9.76s | mixed: in-memory better-sqlite3; injected fake GitHub client |
| memory | 6 | 100 | 0 | 0 | 8.91s | mixed: real filesystem note store plus pure logic |
| media | 9 | 126 | 0 | 0 | 11.37s | mixed: real filesystem staging plus in-memory/pure logic |
| capability-providers | 7 | 52 | 0 | 0 | 8.58s | in-memory reference implementations only |
| **Total** | **48** | **701** | **0** | **0** | package runs overlap | |

Observed pass rate: 701/701 = 100%.  
Certified pass rate: unavailable because expected certified tests and spec mappings do not exist.

No .skip, .todo, or .only declarations were found. No known-flaky registry was found. This run observed no nondeterministic failure, so no flaky retry protocol was triggered.

## Test-type gate status

Active defaults supplied by the Coordinator:

- unit: 98% statements / branches / functions / lines
- integration: 90% statements / branches / functions / lines
- E2E: N/A unless a genuine user journey exists

The repository does not expose separate unit and integration commands for these packages. Generic filenames and mixed suites prevent an independent integration coverage artifact.

| Gate | Status | Reason |
|---|---|---|
| Combined package tests, evaluated against stricter unit 98% proxy | PASS | Every package is 100/100/100/100 |
| Independently routed unit suite | UNAVAILABLE | No unit directory/suffix or command |
| Independently routed integration suite | UNAVAILABLE — escalated | Real I/O tests exist but are mixed into the default suite |
| E2E | N/A | No runnable CLI/MCP/media user journey exists in these package fragments; that implementation absence is itself a release blocker |
| Acceptance | UNAVAILABLE | No approved spec or acceptance matrix |
| Mutation | N/A | computational-controls mutation command is an unconfigured placeholder |

## Honest V8 coverage

Each package was rerun with:

pnpm --filter @jini/PKG exec vitest run --coverage --coverage.include='src/**' --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.reportsDirectory='/tmp/jini-tr-coverage.nmDp8j/PKG'

The coverage root was newly created and empty before execution. Package artifacts are isolated under /tmp/jini-tr-coverage.nmDp8j/PKG/coverage-summary.json and coverage-final.json. json-summary was parsed directly for gate evaluation.

Big Four order below is statements / branches / functions / lines.

| Package | Executable totals: statements / branches / functions / lines | Big Four | 98% proxy |
|---|---:|---:|---|
| sqlite | 903 / 369 / 62 / 903 | 100 / 100 / 100 / 100 | PASS |
| cli | 316 / 196 / 22 / 316 | 100 / 100 / 100 / 100 | PASS |
| mcp | 1350 / 548 / 85 / 1350 | 100 / 100 / 100 / 100 | PASS |
| registry | 424 / 235 / 29 / 424 | 100 / 100 / 100 / 100 | PASS |
| memory | 590 / 253 / 57 / 590 | 100 / 100 / 100 / 100 | PASS |
| media | 656 / 255 / 33 / 656 | 100 / 100 / 100 / 100 | PASS |
| capability-providers | 201 / 73 / 26 / 201 | 100 / 100 / 100 / 100 | PASS |

### Per-file coverage table

Metric order is statements / branches / functions / lines. The 98% status is a strict proxy for the combined mixed suite, not certification that a file has both unit and integration evidence.

| Path | Class | Big Four | Status |
|---|---|---:|---|
| packages/sqlite/src/backend-config.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db-inspect.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/event-log.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/agent-sessions/agent-sessions.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/agent-sessions/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/connection/connection.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/connection/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/conversations/conversations.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/conversations/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/core/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/core/json.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/core/rows.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/core/types.ts | type-only | 0 executable totals | Exempt |
| packages/sqlite/src/db/messages/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/messages/messages.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/projects/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/projects/projects.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/sqlite/src/db/schema/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/sqlite/src/db/schema/migrate.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/cli/src/command-registry.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/daemon-url.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/errors.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/flags.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/http.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/cli/src/prompt.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/cli/src/tokens.ts | runtime / token | 100/100/100/100 | Above |
| packages/cli/src/usage.ts | runtime / transport primitive | 100/100/100/100 | Above |
| packages/mcp/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/mcp/src/agent-install/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/mcp/src/agent-install/install.ts | runtime / MCP utility | 100/100/100/100 | Above |
| packages/mcp/src/client/client.ts | runtime / MCP utility | 100/100/100/100 | Above |
| packages/mcp/src/client/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/mcp/src/core/config.ts | runtime / MCP utility | 100/100/100/100 | Above |
| packages/mcp/src/core/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/mcp/src/core/install-info.ts | runtime / MCP utility | 100/100/100/100 | Above |
| packages/mcp/src/core/oauth.ts | runtime / OAuth adapter | 100/100/100/100 | Above |
| packages/mcp/src/core/tokens.ts | runtime / token storage | 100/100/100/100 | Above |
| packages/registry/src/database-backend.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/registry/src/github-backend.ts | runtime / infrastructure adapter | 100/100/100/100 | Above |
| packages/registry/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/registry/src/static-backend.ts | runtime / registry logic | 100/100/100/100 | Above |
| packages/registry/src/versioning.ts | runtime / registry logic | 100/100/100/100 | Above |
| packages/memory/src/entry-frontmatter.ts | runtime / parsing logic | 100/100/100/100 | Above |
| packages/memory/src/extraction-log.ts | runtime / log logic | 100/100/100/100 | Above |
| packages/memory/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/memory/src/note-store.ts | runtime / filesystem adapter | 100/100/100/100 | Above |
| packages/memory/src/rule-body.ts | runtime / parsing logic | 100/100/100/100 | Above |
| packages/memory/src/verify.ts | runtime / verification logic | 100/100/100/100 | Above |
| packages/media/src/capability-registry.ts | runtime / media logic | 100/100/100/100 | Above |
| packages/media/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/media/src/policy.ts | runtime / policy logic | 100/100/100/100 | Above |
| packages/media/src/providers.ts | runtime / provider catalogue | 100/100/100/100 | Above |
| packages/media/src/seed.ts | runtime / provider catalogue | 100/100/100/100 | Above |
| packages/media/src/staging.ts | runtime / filesystem adapter | 100/100/100/100 | Above |
| packages/media/src/task-store.ts | runtime / state logic | 100/100/100/100 | Above |
| packages/media/src/tokens.ts | runtime / token | 100/100/100/100 | Above |
| packages/media/src/video-request.ts | runtime / request builder | 100/100/100/100 | Above |
| packages/media/src/types.ts | type/interface-only | config exclusion verified against source | Exempt |
| packages/capability-providers/src/auth.ts | runtime / insecure reference stub | 100/100/100/100 | Above |
| packages/capability-providers/src/db.ts | runtime / reference stub | 100/100/100/100 | Above |
| packages/capability-providers/src/index.ts | runtime / barrel | 100/100/100/100 | Above |
| packages/capability-providers/src/payments.ts | runtime / insecure reference stub | 100/100/100/100 | Above |
| packages/capability-providers/src/realtime.ts | runtime / reference stub | 100/100/100/100 | Above |
| packages/capability-providers/src/storage.ts | runtime / reference stub | 100/100/100/100 | Above |
| packages/capability-providers/src/tokens.ts | runtime / token | 100/100/100/100 | Above |

Coverage Gap List: none for executable statements, branches, functions, or lines.  
Touched-file regression: unavailable; no baseline is declared in tasks.md.

Acceptable type-only justification: both exempt files erase completely at runtime and contain no executable declaration. There is no executable line to test.

## Coverage-configuration audit

| Package | Finding | Classification |
|---|---|---|
| sqlite | No vitest config, no test:coverage script, no include or thresholds. A default coverage run can measure only loaded files. | Release-control blocker |
| cli | Reporters are configured, but no src/** include and no thresholds. | Release-control blocker |
| mcp | No vitest config and no test:coverage script. | Release-control blocker |
| registry | Explicit src/** include and 99% thresholds; strongest current config. | Good |
| memory | Explicit src/** include and 99% thresholds; strongest current config. | Good |
| media | No src/** include or thresholds; types.ts is explicitly excluded with a valid type-only rationale. | Include/threshold recommendation; type exclusion accepted |
| capability-providers | No src/** include or thresholds. | Release-control blocker |

The audit command overrode the missing includes, which is why this report can make a package-wide coverage claim. Routine package commands cannot yet enforce that claim for sqlite, cli, mcp, media, or capability-providers.

## Test-quality findings

### Release blockers

#### TR-B1 — 100% @jini/mcp coverage does not test MCP protocol behavior

packages/mcp/source-map.md:36-47 explicitly records that runMcpStdio, TOOL_DEFS, handleMcpToolCall, all handlers, and the @modelcontextprotocol/sdk integration were dropped. Current tests cover config/OAuth/tokens, idle exit, relative-reference parsing, and agent-install planners. They cannot assert stdio framing, maximum frame/message size, schema validation, cancellation, tool authorization, error redaction, concurrency, protocol version negotiation, or unknown-method behavior.

No valid justification — the missing server must be implemented and covered by unit, protocol-conformance, and process-level integration tests before @jini/mcp can be released as an MCP transport package.

#### TR-B2 — Formal certification and independently gated suites are unavailable

No spec/test certification/hash inventory exists, and every target test uses a generic *.test.ts suffix instead of *.unit.test.ts or *.integration.test.ts. No project_memory.md override is recorded. The observed count therefore cannot be compared to a certified expected count, and real-I/O coverage cannot be evaluated separately against the 90% integration gate.

Required route: TDD Agent defines requirement-to-test matrices, certifies file hashes/counts, and classifies tests; Coordinator records any approved convention override.

#### TR-B3 — CLI transport safety/user-journey tests are missing

- packages/cli/src/index.ts:4-9 says this is only a first slice and no pack has registered.
- packages/cli/src/http.ts:69-119 accepts no AbortSignal or timeout and tests only injected/global mocked fetch.
- packages/cli/src/prompt.ts:62-74 and 113-118 buffer entire files/stdin with no limit.
- packages/cli/src/__tests__/errors.test.ts:138-163 explicitly pins raw response bodies into error messages rather than asserting secret redaction.

There is no process-level command test covering argv dispatch through HTTP, prompt-file/stdin, stable exit codes, timeout/cancellation, bounded input, or redacted failures.

No valid justification — additional implementation and integration tests are required before CLI transport release.

#### TR-B4 — Core SQLite assurance is line-complete but not concurrency/transaction complete

packages/sqlite/src/event-log.ts:144-173 implements dedupe, cursor allocation, insert, and eviction in one transaction, but tests use one adapter instance at a time. Missing high-priority scenarios include two connections appending the same run/dedupe key, write contention/busy handling, serialization failure rollback with cursor continuity, corrupt persisted JSON replay, and transaction failure during eviction.

The broader db barrel also lacks upgrade-from-old-schema tests: packages/sqlite/src/db/schema/migrate.ts:20-90 tests only create/idempotence, not migrations or corruption recovery.

No valid justification — persistence/data-integrity paths require real multi-connection and failure-injection integration tests.

#### TR-B5 — Five packages lack locked-architecture sign-off

@jini/mcp, @jini/registry, @jini/memory, @jini/media, and @jini/capability-providers are absent from extraction-plan.md section 3. Their green tests cannot substitute for the required Coordinator/Software-Architect decision, the two-consumer/experimental rule, or a release-surface contract.

### High-priority semantic gaps

| Priority | Package/location | Missing evidence | Next action |
|---|---|---|---|
| High | sqlite event-log.ts:144-173 | cross-connection idempotency, lock contention, rollback/cursor integrity | real multi-connection integration suite with injected failures |
| High | sqlite db/schema/migrate.ts:20-90 | migration from prior schemas and corrupted/partial schema | versioned migration fixtures and recovery assertions |
| High | cli http.ts:69-119 | timeout, AbortSignal propagation, response-size bound | add API contract then integration tests with a real local server |
| High | cli prompt.ts:62-74,113-118 | stdin/file size limits and stream cleanup/error behavior | bounded-reader contract and large/aborted stream tests |
| High | mcp source-map.md:36-47 | all MCP framing/authz/cancel/server behaviors | implement server then conformance/process tests |
| High | memory note-store.ts:196-217,324-353 | atomic rename/fsync, simultaneous writers, symlink replacement/escape | filesystem race/symlink integration suite |
| High | media staging.ts:70-114 | hostile stagingDirName, symlink swap/TOCTOU, cleanup containment | validate option and add adversarial filesystem tests |
| High | media task-store.ts:148-170 | legal transition matrix and duplicate create semantics | explicit state-machine invariant/property tests |
| High | capability-providers auth.ts:8-11 and payments.ts:8-11 | real security/payment adapter contracts | keep experimental; add adapter conformance only after approved consumers |
| Medium | registry github-backend.ts:75-79 | actual GitHub transport, pagination/rate-limit/retry/token-redaction behavior | host-client contract/integration tests; fake client alone is insufficient |
| Medium | registry database-backend.test.ts | reopen durability, malformed persisted JSON, shared conformance across backends | reusable backend conformance suite and file-backed SQLite fixture |

### Tests that overstate behavioral assurance

packages/sqlite/source-map.md:309-329 documents coverage-only fake-driver Proxy tests for states SQLite/schema invariants make unreachable. Concrete cases are packages/sqlite/src/db/__tests__/db.test.ts:423-458 and 680-698. These tests raise branch coverage to 100% by pinning defensive implementation details; they are not user-visible or database-boundary evidence. Keep only if the defensive contracts are intentional, but do not count them as a substitute for the missing contention/rollback tests.

packages/capability-providers tests intentionally prove plaintext-password/non-cryptographic auth and always-successful payments reference stubs. The source labels them insecure, but the tests do not mechanically prevent a host from wiring them as production adapters. Their 100% coverage must never be cited as auth/payment security assurance.

### Flake and determinism risks

- packages/memory/src/__tests__/note-store.test.ts:213-218 uses a real 5ms sleep to force mtime ordering. It passed twice in this audit, so it is not classified as flaky, but it is vulnerable to filesystem timestamp resolution/load. Prefer an injected clock or explicit utimes.
- capability-providers auth tests compare against live Date.now at lines 24 and 80. The assertions have broad margins and passed, but the already-supported injected clock should be used consistently.
- Several suites mutate process.stdin, process.stderr, process.exit, or global fetch. Current tests restore them with finally blocks; running these files concurrently with future same-process tests will need isolation discipline.

## Package-by-package evidence summary

| Package | Strong current evidence | What 100% does not prove |
|---|---|---|
| sqlite | real temp-file EventLog restart/replay; real schema/CRUD/integrity checks | multi-writer behavior, rollback, upgrade migration, corrupt event payload recovery |
| cli | parsers, registry, exit mapping, fake-fetch behavior, limited real file/stdin | runnable CLI, daemon integration, cancellation, limits, redaction |
| mcp | config/token atomic-file paths, OAuth algorithms with mocked fetch, planners | any MCP server/protocol behavior |
| registry | semantic version logic, static backend, in-memory SQLite backend, fake GitHub mutation planning | real GitHub I/O, shared backend conformance, restart/corruption/resource controls |
| memory | real filesystem CRUD and parser/verifier branches | atomic concurrent writes, symlink/race containment, hostile/oversized content bounds |
| media | catalogue/request builders, allowlist, real staging copies, in-memory tasks | vendor dispatch, credentials, polling/cancel, durable tasks, strict transitions |
| capability-providers | basic reference-port shape | production auth/storage/payment/db/realtime behavior or security |

## Release blockers versus recommendations

### Release blockers

- TDD recertification/spec inventory is required; formal convergence is unavailable.
- Unit/integration routing and integration coverage artifacts are unavailable.
- MCP server, runnable CLI, and media dispatch behavior are absent but package names can imply them.
- SQLite, memory, and media lack the high-risk concurrency/filesystem/state assertions above.
- Outside-lock package sign-off is missing.
- Honest include/threshold enforcement is absent from sqlite, cli, mcp, and capability-providers; media also lacks thresholds.

### Recommendations

- Replace the memory test's 5ms sleep with deterministic time control.
- Add a shared RegistryBackend conformance suite rather than one ad hoc static-vs-database comparison.
- Keep barrel export tests, but do not count them as substantive behavior coverage.
- Classify zero-executable files explicitly in coverage tooling/reporting; never omit them from inventory.
- Add package scripts that always emit machine-readable coverage into isolated paths.
- Add real consumer contract tests before promoting capability-providers from experimental status.

## Coordinator classification and routing

- Current test failures: none.
- Current executable coverage gaps: none.
- Coverage configuration/certification gaps: COVERAGE_TRIAGE_REQUIRED.
- Missing runtime/protocol behavior: IMPLEMENTATION_FIX_REQUIRED after architecture/spec approval.
- Test design/certification: TDD_RECERTIFICATION_REQUIRED.
- Architecture status for outside-lock packages: Software Architect + Coordinator decision required.
- Suggested next assignees: Software Architect for package/sign-off and contract boundaries; Spec/TDD for certification and conformance matrices; Programmer only after those artifacts approve the missing implementation scope.

## Inputs / outputs / risks

Inputs used: locked architecture documents, governance placeholders, package source maps, all 68 production files, all 48 test files, manifests/configs, fresh graph/index evidence, fresh root commands, fresh package commands, and machine-readable isolated coverage.

Output: this report only. No implementation/test/config changes.

Primary risk: a reader may treat 100% line/branch coverage as proof that MCP, CLI, media dispatch, production auth/payment, or multi-process persistence is complete. It is not; coverage is complete only for the code that currently exists.
