---
name: codebase-analysis
version: 1.3.0
last_updated: 2026-08-28
description: Use when analyzing an existing codebase for architectural flaws, coupling issues, missing abstractions, code quality problems, or security surface before starting a new pipeline run. Produces a structured findings report using token-efficient phased analysis that scales to large codebases. Phase 2 measures structure with three shipped scripts — afferent/efferent coupling, instability, abstractness, distance from the main sequence, Zone of Pain (Martin's package-design/JDepend metrics); class and module cohesion (LCOM4 and intra-module linkage); and public API surface per module with growth against a baseline.
---

# Skill: Codebase Analysis

Analyzing an existing codebase requires token discipline. Reading every file is not viable for production codebases. This skill uses a three-phase approach that builds a complete picture through targeted reads rather than exhaustive ones.

Reports are saved to `<ADS_MEMORY_ROOT>/reports/codebase-analysis/` — not kept in context. This makes findings persistent and loadable by the `architecture-migration` skill in a separate session.

## Token Budget Before You Start

Estimate codebase size before any reads. Count files with a bounded file list
that excludes generated/vendor folders before sampling. Prefer:
`rg --files -g '!node_modules/**' -g '!vendor/**' -g '!dist/**' -g '!build/**' -g '!.git/**'`.
Use the host's closest equivalent if `rg` is unavailable.

| Codebase Size | File Count | Approach |
|---|---|---|
| Small | < 50 files | Full analysis, single report |
| Medium | 50–500 files | Phased analysis, single report |
| Large | 500–5,000 files | Phased analysis, report split by module |
| Very large | 5,000+ files | Ask user which modules to focus on |

For very large codebases, stop and ask: *"This codebase has approximately [N] files. Should I analyze by module (multiple sessions) or focus on a specific area first?"*

**Always exclude**: `node_modules/`, `vendor/`, `dist/`, `build/`, `.git/`, generated files, lock files.

## Phase 1 — Discovery (Minimal Tokens)

Goal: understand the codebase shape without reading code.

1. Directory tree to depth 3 (excluding dirs above)
2. Read: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`
3. Read: `tsconfig.json`, `eslint.config.*` if present
4. Read: `README.md` (first 80 lines only if large)
5. Read: `ARCHITECTURE.md`, `DESIGN.md`, or `docs/` index if present

**Output of Phase 1:**
- Detected language(s) and framework(s)
- Apparent architectural intent
- Module/folder map with file count per module
- Red flags visible from structure alone (no `domain/` folder in a claimed DDD project, no test files anywhere, all code in root directory)

## Phase 2 — Architecture Scan (Targeted Reads)

Goal: identify structural violations and dependency direction problems.

1. Read entry points in full (main.ts, index.ts, app.py — usually short)
2. For each top-level module folder: read its index file or first 50 lines of the largest file
3. Compute the coupling numbers rather than sampling them (**Python only**):
   `python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/main_sequence.py <SOURCE_ROOT> --sort ca`
   — afferent/efferent coupling, instability, abstractness and distance from the
   main sequence, per component. Load
   `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/references/component-coupling-metrics.md`
   to read the output; it also gives the two zone names, what each one implies,
   and the cases where a number means less than it looks like. On other
   languages, or when the script cannot resolve the tree, fall back to grepping
   import patterns (`import.*from`, `require(`) and say in the Sampling Notice
   that hotspots were sampled rather than counted.
4. Measure cohesion rather than eyeballing it (**Python only**):
   `python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/cohesion.py <SOURCE_ROOT> --top 20`
   — per-class LCOM4 and per-module file linkage, both counted as independent
   groups. This answers a question coupling cannot: whether a module should have
   been one module. Load
   `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/references/cohesion-and-api-surface.md`
   to read the output. **A split is a candidate boundary, not a defect** —
   facades, protocol classes and namespace directories score high and are often
   correct as written.
5. Measure public API surface per module (**Python only**):
   `python3 <AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/api_surface.py <SOURCE_ROOT> --top 20`
   — public names per module, what the package front door declares, and how much
   sits outside it. If a prior run's `--json` output is available, pass it as
   `--baseline` to get growth; a single run is a level, not a trend, and the
   script says so.
6. Check dependency direction: does `domain/` import from `infrastructure/`? Does `routes/` contain business logic?
7. Check for circular dependency indicators

On non-Python trees, steps 3–5 do not run. Say so in the Sampling Notice rather
than reporting the absence as a clean result.

**Output of Phase 2:**
- Layer map: what layers exist vs what the apparent pattern requires
- Dependency direction violations (with file and line locations)
- Coupling hotspots: the components with the highest `Ca`. A hotspot that is
  also concrete (low `A`) **and stable** (low `I`) is the Zone of Pain — the
  expensive kind, because every dependent is bound to an implementation. All
  three coordinates matter: a concrete component that also depends outward
  heavily is a hub, reported as `far`, not `pain`. Cite the numbers as evidence;
  severity still comes from the Flaw Categories table below, never from a
  distance band.
- Cohesion splits: classes with `LCOM4 >= 2` and modules whose files form more
  than one group. Report the group membership, not just the count — the groups
  are the proposed boundary. The combination that carries the most signal is
  **high `Ca` with high group count**: many dependents on something that is not
  one thing.
- API surface: the modules with the largest `public` count, any multi-file
  module flagged `no front door`, and — when a baseline exists — which modules
  grew. **High `Ca` with a large surface is the expensive pair**, because every
  dependent is bound to a wide interface.
- Missing layers (no service layer, no repository interfaces, no domain folder)

## Phase 3 — Code Sampling (Controlled Reads)

Goal: quality indicators, naming, missing abstractions, security surface.

Rules:
- One representative file per module/layer, maximum 100 lines each
- For test coverage: check test-file existence and declared test commands only
  — do not read test files during Phase 3. Label this as a coverage signal, not
  a coverage measurement. A declared test command is not coverage evidence by
  itself; flag placeholder commands such as `echo "Error: no test specified"`
  as no usable test command. Do not claim module coverage exists unless a test
  command actually targets that module or an existing coverage artifact shows
  nonzero coverage for it. Do not claim "zero coverage" unless both no matching
  test files and no usable configured test command/coverage artifact are found
  for the module.
- For security: grep for risk patterns rather than reading full files

Security grep patterns (flag, do not diagnose):
- Hardcoded strings matching key/secret patterns: `(?i)(api_?key|secret|password|token)\s*=\s*['"][^'"]{8,}`
- Direct SQL strings: `SELECT.*FROM`, `INSERT INTO`, `UPDATE.*SET`
- Dangerous evals: `eval(`, `exec(`, `Function(`
- Direct filesystem access in unexpected layers
- Unvalidated env vars: `process\.env\.\w+` used without null check or fallback
- CORS wildcard: `cors\(\)` with no config, or `origin: '*'` in production code
- Missing auth middleware: routes defined without any auth/middleware reference

**Frontend-specific grep patterns** (apply when React/Vue/Svelte detected in Phase 1):
- Client-side DB calls: `supabase\.from(`, `firebase\.firestore(`, `db\.collection(` inside `components/`, `pages/`, `src/` (outside `lib/` or `services/`)
- TypeScript `any` abuse: `:\s*any\b` — count occurrences, flag if >10
- Unhandled async in components: `useEffect.*async` without cleanup or error boundary
- N+1 indicators: DB/API calls inside `.map(`, `.forEach(`, `.filter(` — flag for review

**Output of Phase 3:**
- Code quality indicators (oversized files/functions, naming drift, missing types, `any` count)
- Missing abstractions (no interfaces for external dependencies)
- Test coverage signal: which modules have test files, which don't
- Security surface flags (for Security Agent to review — not a full audit)
- Dead code indicators (unreferenced exports, commented-out blocks)
- Frontend-specific findings (if applicable): client-side DB boundary violations, N+1 candidates, missing error/loading states
- Env var handling: whether `.env` is validated at startup or used raw throughout

## Phase 4 — Testability Assessment (Conditional)

Run only when: (a) one or more modules have zero test coverage, AND (b) a full migration plan is not requested or is premature.

Goal: identify the minimum structural changes that unlock unit and integration testing for untested modules — without requiring full architectural migration.

For each untested module from Phase 3:
1. **Identify hard dependencies**: direct instantiation (`new X()` inline), module-level singletons, static method calls on concrete classes
2. **Identify I/O coupling**: database, filesystem, or network calls with no abstraction layer between the call site and the caller
3. **Identify buried logic**: business rules or computations mixed into functions that also perform I/O or framework operations

For each dependency found, determine the minimum change to make it injectable or substitutable:
- **Constructor/parameter injection**: pass the dependency in rather than instantiate it; provide production default at the call site
- **Extract interface**: add a thin interface over an existing concrete class so a fake can be substituted in tests
- **Extract pure function**: pull the computation out of the impure function so it can be tested in isolation
- **Wrap external call**: add a one-method adapter over a raw DB/HTTP/filesystem call

**Characterization test targets**: rank untested modules by risk (change likelihood × failure impact). The highest-risk module must have characterization tests written against current behavior before any seam is introduced.

**Output of Phase 4:**
- Ranked list of seam candidates (location, hard dependency type, recommended technique, effort, risk)
- Characterization test targets in priority order with rationale
- Minimal change sequence: ordered steps that yield the most testability improvement per change, without triggering a full architectural migration

## Findings Report Format

**Small/medium codebases:** Save as `<ADS_MEMORY_ROOT>/reports/codebase-analysis/ANALYSIS-<id>-<YYYY-MM-DD>.md`

**Large codebases:** Split into named parts:
- `ANALYSIS-<id>-<date>-part1-structure.md`
- `ANALYSIS-<id>-<date>-part2-dependencies.md`
- `ANALYSIS-<id>-<date>-part3-quality.md`

Each part is self-contained. `architecture-migration` can load individual parts without loading all.

```markdown
# Codebase Analysis: <project-name>

- Analysis ID: ANALYSIS-001
- Date: <ISO-8601 UTC>
- Analyst: CodeBase Analyzer Agent
- Parts: 1 of 1

## Executive Summary

- Language/Framework: <detected language / framework>
- Apparent Pattern Intent: Layered Architecture
- Files Analyzed: 47 of 312 total (excluded: node_modules, dist)
- Severity Counts: Critical: 2 | High: 5 | Medium: 8 | Low: 4
- Current State Classification: Layered (degraded)

## Sampling Notice

Files sampled: <list or description of files read>
Files excluded: <list or description of skipped files and why>

Confidence levels by finding category:
- Architecture structure: High / Medium / Low
- Dependency direction: High / Medium / Low
- Test coverage signal: High / Medium / Low
- Security surface: High / Medium / Low
- Code quality indicators: High / Medium / Low

Note: Confidence reflects sample coverage, not model certainty. A
High-confidence finding means the sample was broad enough to support the
conclusion. A Low-confidence finding is a hypothesis requiring human
verification.

## Findings

### FLAW-001
- Severity: Critical
- Category: Architecture Violation
- Location: `src/routes/invoice.ts:89–120`

Business logic (invoice total calculation, tax computation) implemented directly
in route handler. Cannot unit-test business rules without spinning up HTTP server.
Any reuse requires copy-paste duplication.

Evidence: Lines 89–120 perform calculations and apply business rules inline.
These have zero test coverage outside integration tests.

---

### FLAW-002
...

## What Was Not Analyzed

Due to token budget, the following were sampled but not fully read:
- `src/legacy/` (14 files — no test coverage detected)
- `src/integrations/` (8 files — entry points only)

## Recommended Next Step

State which option applies:
- If a Critical/High module has no detected test files and no configured test
  command/coverage artifact, and full migration is premature: generate a
  Testability Remediation Plan using Phase 4 of
  `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/SKILL.md`
- If architecture overhaul is warranted: load this report into `<AI_DEV_SHOP_ROOT>/skills/architecture-migration/SKILL.md` to generate a migration plan
- If structural issues are minor: route findings to Refactor Agent via Coordinator
```

## Testability Remediation Plan Format

Save to `<ADS_MEMORY_ROOT>/reports/codebase-analysis/TESTABILITY-<id>-<YYYY-MM-DD>.md`

Only produce this when Phase 4 is run.

```markdown
# Testability Remediation Plan: <project-name>

- Plan ID: TESTABILITY-001
- Analysis Source: ANALYSIS-001
- Date: <ISO-8601 UTC>
- Scope: Modules with zero or near-zero test coverage

## Coverage Caveat

This plan is based on sampled files. Seams and dependencies not visible in the sample may exist.
Validate each seam against the actual source before making any changes.

## Characterization Test Targets

Write tests against current behavior BEFORE introducing any seam. These lock in existing behavior
so restructuring cannot silently break it.

| Module | Risk | Reason |
|---|---|---|
| `src/payments/` | Critical | Revenue path, zero coverage, scheduled for change |
| `src/invoicing/` | High | Zero coverage, called from 4 modules |

## Priority Seam Map

### SEAM-001
- File: `src/routes/invoice.ts:89`
- Hard dependency: `new InvoiceCalculator()` instantiated inline
- Technique: Constructor/parameter injection
- Change: Add `calculator` param to function; default to `new InvoiceCalculator()` at call site
- Unlocks: Unit tests for invoice logic without HTTP server
- Effort: Low | Risk: Low

---

### SEAM-002
- File: `src/services/email.ts:34`
- Hard dependency: `nodemailer.createTransport()` called directly
- Technique: Extract interface + inject
- Change: Define `EmailSender` interface; inject via constructor; wire real transport in production entry point
- Unlocks: Unit tests for any service that sends email
- Effort: Low | Risk: Low

---

## Minimal Change Sequence

Ordered steps — complete in sequence to progressively unlock testing without breaking production:

1. Write characterization tests for `src/payments/` against current behavior (no code changes)
2. Apply SEAM-001 — extract `InvoiceCalculator` injection point
3. Write unit tests for invoice calculation logic
4. Apply SEAM-002 — extract `EmailSender` interface
5. Write unit tests for order confirmation flow

## What This Plan Does NOT Cover

- Full architectural migration (see MIGRATION-*.md if that is needed)
- Security findings (route to Security Agent)
- New feature implementation
- Performance issues
```

## Flaw Categories and Severity

**Critical** — Structural problems that block testability, safety, or extensibility:
- Business logic in route handlers or controllers
- Direct database access with no abstraction layer
- No separation between external dependencies and core logic
- Circular module dependencies
- Client-side DB calls in UI components (Supabase/Firebase/Drizzle called directly inside React/Vue components — data access has no server boundary)

**High** — Significant debt with clear negative impact:
- Missing interfaces for external dependencies (database, email, payment providers)
- God files (single file > 500 lines with mixed responsibilities)
- No test files in any module
- Hardcoded credentials or config values
- No input validation on external data (user input, API responses used directly)
- CORS misconfigured (wildcard origin in non-dev context)
- N+1 query patterns (DB/API calls inside loops or array operations)
- Unvalidated environment variables (used without null checks or startup validation)

**Medium** — Accumulating debt that will slow future work:
- Naming that doesn't match domain language
- Logic duplicated across 3+ files
- Functions > 50 lines with multiple responsibilities
- Missing error handling on external calls
- No loading or error states in UI components that perform async operations
- `any` used as a type annotation more than 10 times in a TypeScript project
- No pagination on list endpoints or queries that could return unbounded results
- Missing auth middleware on routes that should be protected

**Low** — Quality issues that don't block but degrade maintainability:
- Dead code (unreferenced exports, commented-out blocks)
- Naming drift (names that no longer match what the code does)
- Missing type annotations in typed languages
- Debug statements or console.log in production paths
- Outdated or unpinned dependencies (check `package.json` for `*` or very old major versions)

## Analysis Anti-Patterns

**Reading too much**: Full file reads for every file defeats the purpose. Use the phase structure.

**Symptom counting over root causes**: "47 problems" is less useful than "one Critical structural violation causing most of the other issues." Identify roots.

**Judging without context**: A 500-line file may be appropriate for a configuration registry. Understand intent before classifying.

**Skipping the executive summary**: The summary is what `architecture-migration` uses as primary input. Make it precise — current state classification and severity counts are mandatory.

**Underreporting sampling limits**: Phase 3 reads one file per module. In large vibecoded repos, real issues exist outside sampled files. Always include a "What Was Not Analyzed" section and explicitly note which modules were sampled vs skipped. Do not imply findings are exhaustive — they are representative.
