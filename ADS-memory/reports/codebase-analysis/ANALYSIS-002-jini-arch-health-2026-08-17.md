> **CORRECTION (same-day, appended after initial publish):** Finding FLAW-004 below ("Exported
> surface: zero violations") is WRONG as originally stated for the Jini-internal half of its claim.
> It checked Jini-internal cross-package imports against each target's *declared `exports` map*
> (permissive), not against `guard`'s actually-enforced R2 rule (bare-specifier-only internally, 5
> named exceptions) — a check this analysis hadn't yet discovered existed at the time it was written
> (see [[project_jini_guard_architecture_gate]]). Against the real rule there are **8 already-known,
> baseline-tracked violations**: `admin`→`@jini-ai/ui/html-editor` (1) and
> `chat/react/features/chat-pane/**`→`@jini-ai/chat/core` (7, across 5 files, chat's own react
> subtree reaching its own core subtree via full specifier instead of relative import). These are
> tracked, accepted debt as of the 2026-08-16 guard baseline — not a clean result. The Tovu-consumer
> half of the finding (533 real imports, 12 packages, checked against declared `exports` keys, 0
> violations) stays valid as a separate, correct question — `guard` only scans `packages/**`, never
> external consumers, so "does Tovu reach past Jini's declared public surface" is a real gap `guard`
> doesn't cover and Tovu came back clean on it. Also see the Recommendation section's revision below:
> don't port a Tovu-style gate as a *replacement* — `guard`'s R2 already does deep-path/exported-
> surface enforcement more strictly than what was originally proposed. The genuine gap is general
> cross-package dependency-direction/cycle checking across the full 29-package DAG, which none of
> guard's 12 rules currently cover except for 2 of 29 packages (`protocol` purity, one `core/internal`
> leak) — Tovu's graph-metric approach would be a complementary addition there, not a duplicate.

# Codebase Analysis: Jini cross-package architecture health

- Analysis ID: ANALYSIS-002
- Date: 2026-08-17
- Jini revision: `f5d36aa102c13dccf52927e80ff4241bc88aae47` (branch `general-work`; 2 uncommitted files in `packages/sandbox/`, neither touches cross-package deps)
- Scope: `packages/*` (29 workspace packages)

**Dispatch mode:** Agent Direct Mode (CodeBase Analyzer persona), ad-hoc standalone health check —
not tied to a pending feature/spec. Analysis only, no migration plan, no production code changed.

**Note:** this agent's tool policy blocked writing its own report file mid-run, so its findings were
returned as a text message to the dispatching (Tovu-side) session and persisted to this file by that
session afterward, verbatim.

## Sampling Notice

Sampled: all 29 `package.json` manifests (deps/exports/main); full grep-verified extraction of every
real (non-comment) `@jini-ai/*` import in `packages/*/src` (258 statements) and in Tovu's `src/` (533
statements, only external consumer checked); source/test file counts for all 29 packages; targeted
hidden-I/O greps in `core`/`protocol`/`platform`/`daemon`/`http-kit`; the codebase-memory-mcp `Jini`
graph project (already indexed, fresh — head_sha matched live HEAD).

Excluded: line-by-line reads of `ui` (574 files), `admin`, `cms`, `chat`, `agent-runtime`, `daemon`
internals beyond targeted greps; `examples/*`/`foundry/`; runtime/route behavior (covered by
ANALYSIS-001, not duplicated); non-literal `import()`/`require()` forms (one instance manually
spot-checked).

Confidence: dependency direction (declared) High; dependency direction (actual imports) High for the
grep-captured set, Medium overall (dynamic imports not exhaustive); exported-surface discipline High;
testability signal Medium (targeted, not exhaustive); graph-tool reliability for this question
High-confidence-unreliable (see Finding 1).

## Executive Summary

- **Cross-package dependency graph is a clean DAG** — zero cycles, confirmed three independent ways
  (declared package.json, grep-verified real imports, manual path trace).
- **codebase-memory-mcp's `get_architecture` "boundaries" (CALLS-edge) output is misleading here**
  and reports two bidirectional package back-edges that don't exist as real imports
  (`http-kit↔agent-runtime`, `http-kit↔ui`) — verified false via direct IMPORTS-edge Cypher queries
  (0 rows both directions). Root cause: the graph's IMPORTS edges only resolve relative imports,
  never bare `@jini-ai/*` specifiers, so cross-package structure had to be reconstructed by grep
  instead of trusted from the graph.
- **Exported surface is well-disciplined: zero violations.** 258 real Jini-internal cross-package
  imports + 533 real Tovu-consumer imports (12 distinct packages) all resolve to a declared `exports`
  key. No deep-path `/src` or `/dist` reaches anywhere in the sample.
- **Testability of the foundational leaves (`core`/`protocol`/`platform`) is good** — I/O
  consistently injected via default params; `protocol` (906 lines) has zero I/O calls at all.
- Test/source file ratios are near 1:1 for the heavily-used packages; `sidecar` (0.20) and `sqlite`
  (0.27) are the lowest ratios among packages with real logic (not source-read this pass — best
  target for a follow-up).
- No architecture gate exists today (confirmed empty DRAFT template) — **worth porting**, and
  unusually it would start from a clean baseline instead of grandfathering violations.

## Findings

### FLAW-001 — Graph-tool caveat: CALLS "boundaries" produce false cross-package back-edges (Medium, methodological)

`get_architecture(aspects=["boundaries"])` reported `agent-runtime→http-kit:36` /
`http-kit→agent-runtime:24` and `ui→http-kit:37` / `http-kit→ui:18` — read as circular deps. Both
directions verified false: `MATCH (a:File)-[:IMPORTS]->(b:Module) WHERE a.file_path CONTAINS
'packages/agent-runtime/' AND b.file_path CONTAINS 'packages/http-kit/'` → 0 rows; same for
http-kit→ui → 0 rows. Cause: `IMPORTS` edges never resolve bare workspace specifiers (confirmed: a
project-wide query for IMPORTS from any packages/* file to a target outside packages/ returned zero
rows), so the graph is blind to real cross-package structure; `CALLS` instead does name-based
heuristic resolution and this repo has widely-reused short names (`ok`, `err`, `t`, `useT`) that
collide across packages, producing spurious edges. **For future analysis on this repo: don't trust
`boundaries`/`layers` for dependency-direction questions — reconstruct from package.json +
grep-verified imports.**

### FLAW-002 — Real cross-package dependency graph (ground truth, informational)

Declared (`workspace:*`) and grep-verified-real edges agree except for Finding 3. Clean 5-layer DAG:

```
{core, protocol, platform}                                        (pure leaves, zero internal deps)
  → {agentic, sidecar, artifacts, cms, desktop-host,
     capability-providers, integrations, registry, agent-runtime}
    → {ui, cli}
      → {admin, chat, mcp, sqlite, daemon}
        → {devops, http-kit}
          → {server}
```
`server` (top) has zero inbound internal dependents — confirmed composition root. No back-edges found
by grep in either direction.

### FLAW-003 — One real layering inversion: http-kit/sqlite import types from chat (Low)

Real, verified `import type` statements: `packages/http-kit/src/__tests__/attachments.test.ts:35` and
`packages/sqlite/src/db/chat-history/store.ts:31`, both `from "@jini-ai/chat"`. `http-kit`/`sqlite`
are meant to be infra that `chat` depends on (and does, one direction). Here two type-only imports
invert that. Zero runtime risk (erased at build), low volume (2 occurrences), but the shared
vocabulary (`ChatAttachment`, chat-history row shapes) arguably belongs in `protocol`/`core`. Worth a
one-line ADR note, not urgent.

### FLAW-004 — Exported surface: zero violations (positive finding)

All 29 packages declare `exports` or `main`+`types`; several are intentionally subpath-only with no
root `.` (`infra`, `plugins`, `integrations`, `sandbox` — consistent with the already-recorded
npm-subpaths-over-separate-packages decision). Checked every real cross-package import against
target's declared `exports` keys: Jini-internal 258/258 compliant, Tovu-consumer 533/533 compliant
across 12 packages including deep subpaths like `ui/mcp-ui/surfaces`, `chat/core`,
`cms/identity/hasher`, `devops/deploy` — all declared keys, never raw `/src` or `/dist` reaches. One
dynamic `require.resolve("@jini-ai/mcp")` spot-checked, also compliant.

Side artifact found (not a violation, just cruft): `node_modules/@jini-ai/chat-core` and
`node_modules/@jini-ai/renderers-react` are dangling symlinks to package directories deleted in the
prior restructure — harmless (nothing imports through them) but exactly what an exported-surface gate
would have caught at deletion time.

### FLAW-005 — Testability: foundational leaves clean; two lower test ratios (Low)

`core`/`protocol`/`platform`: every `process.env` read is a default param (`env: NodeJS.ProcessEnv =
process.env`), every `new Date()` is either defaulted or documented as clock-injectable. `protocol`
has zero I/O in 906 lines (pure types/schemas). One minor exception: `platform/src/fs.ts:103` builds
a temp-file suffix directly from `Date.now()`/`Math.random()`, not injected (low risk,
uniqueness-only).

Test/source ratios (all 29 packages) — full table available on request; notable: `ui` 428/574 (0.75),
`agent-runtime` 102/110 (0.93), `http-kit` 39/40 (0.98), `daemon` 31/32 (0.97) — strong TDD signal.
Lowest among packages with real logic: `sidecar` 2/10 (0.20), `sqlite` 7/26 (0.27), `admin` 14/43
(0.33) — `protocol`/`core`'s lower ratios (0.30/0.43) are benign given the I/O-injection finding
above. No module-level singleton state (`const x = new Map()` at module scope) found in `daemon` or
`http-kit` via targeted grep.

## Recommendation: port a Tovu-style gate?

**Yes**, narrow first cut, starting green (no grandfathering needed):

1. **Exported-surface gate** (highest value): fail CI if any tracked source imports a
   `@jini-ai/<pkg>/<subpath>` not in that package's declared `exports` map. Exactly the check done
   manually above — a grep+JSON-diff script, no graph backend needed.
2. **Dependency-direction gate** pinned to the Finding 2 DAG: fail if `core`/`protocol`/`platform`
   ever gain a `@jini-ai/*` import; explicitly flag or allow-list the one existing inversion
   (Finding 3).
3. Build both on **static import extraction**, not on codebase-memory-mcp's CALLS-based
   `boundaries`/`layers` — Finding 1 showed that signal false-positives on this repo and would poison
   a gate wired to it directly.

Not recommended yet: a general cycle detector or fan-in/complexity gate — no cycles exist to guard,
and the graph's `hotspots` (e.g. `http-kit.ok`/`err` at fan-in 87–105) are intentional
shared-result-type helpers, not accidental god functions.

Severity summary: Critical: 0 | High: 0 | Medium: 1 (tooling caveat) | Low: 3 | Informational/positive: 2
