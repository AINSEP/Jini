# Progress Ledger

- workstream: design-systems-barrel-refactor
- scope_type: direct-run
- owner: Coordinator (Claude Opus 4.8)
- started_at: 2026-07-02T00:00:00Z
- last_updated_at: 2026-07-03T00:28:39Z
- related_state_file: N/A
- active_spec_hash: N/A
- evaluator_mode: not-needed
- evaluator_contract: N/A

## Current Objective

Core work is COMPLETE. The design-systems module was refactored into a machine-enforced
"capability barrel" layout as the reference implementation / template for a planned site-wide
daemon refactor, and an RFC was filed upstream. Remaining objective is to await maintainer
feedback on the RFC and, if invited, open the narrow design-systems extraction PR.

## Last Verified Good State

- `pnpm guard` capability-barrel check: PASS on real tree.
- `scripts/check-barrel-imports.test.ts`: 25/25 pass.
- design-systems vitest suite: 216/216 pass.
- `pnpm --filter @open-design/daemon typecheck`: clean for design-systems (only pre-existing,
  unrelated errors in untracked `tests/chat-run-sse-shapes.test.ts`).
- Runtime smoke test on `pnpm tools-dev run web` (ports 17456/17573): daemon booted, all
  `/api/design-systems/*` endpoints 200, user-DS create→read→list→delete round-trip green.
- RFC filed: https://github.com/nexu-io/open-design/issues/5087

## Recent Progress

- Refactored `apps/daemon/src/design-systems/` from 13 flat files into `core/catalog/user/import/tokens/jobs` subdirs with per-subdir barrels + `@module` docblocks (strangler-fig, no logic change).
- Relocated `readUserMetadata`/`cleanProjectIdForMetadata`/`normalizeArtifactMode` into `core/metadata.ts` to break a real `catalog ↔ user` cycle.
- Built `scripts/check-barrel-imports.ts` guard (foundation kernel + acyclic `allowedEdges`, TS-AST scan of static/dynamic/require/re-export imports, in-process cycle validation), wired into `pnpm guard`.
- Ran `/audit-work`: internal Claude subagent + codex(GPT) independently converged on ONE blocker — dynamic `import()`/`require` was unscanned. Fixed + regression-tested. (agy/Gemini failed ×3 — CLI/backend issue in this env.)
- Ran a Fable review → found + fixed a second real gap: domain-root straggler files (e.g. `server-services.ts`) bypassed the guard entirely. Added Rule 6 (domain-root files must use subdir barrels) + Rule 7 (no `export *` in root barrel); converted all `export *` barrels to named; fixed `server-services.ts` to import types from `core` instead of redeclaring them.
- Documented the pattern in `apps/daemon/AGENTS.md` and rewrote `apps/daemon/src/design-systems/README.md` (RFC-style: What changed → Why this shape (debate) → Import conventions → Known limitations & staged migration → reference tables).
- Filed RFC #5087 upstream (issue-first, per maintainer Discord guidance).

## Next Actions

1. Await maintainer response on RFC #5087; help draft replies to the 3 open questions (bespoke guard vs dep-cruiser; which module first; direction alignment).
2. If invited: fork `nexu-io/open-design`, carve a CLEAN branch containing ONLY the design-systems refactor + guard + docs (the working tree is messy — see blockers), push, open the narrow PR.
3. Optional follow-ups (separate PRs): move generic `frontmatter.ts`/`rename-args.ts` out of `core/`; split 1,183-line `core/body.ts`; apply the full pattern to `media/` (currently only `@module` docblocks).

## Blockers Or Open Questions

- No fork exists yet; `origin` points at upstream `nexu-io/open-design` (no push access). A PR needs a fork first.
- Working tree is heavily mixed: the design-systems change sits alongside unrelated untracked content (AI-Dev-Shop toolkit, scratch dirs, `server-old.ts`, `server.ts`/`tools/release` edits). Any PR requires carefully carving out just our files.
- RFC open questions are maintainer decisions (guard tooling choice, next module).

## Artifact References

- `apps/daemon/src/design-systems/` — the refactored module (reference implementation).
- `apps/daemon/src/design-systems/README.md` — architecture writeup + debate reasoning + known limitations.
- `scripts/check-barrel-imports.ts` + `scripts/check-barrel-imports.test.ts` — the guard + 25 tests.
- `apps/daemon/AGENTS.md` → "Capability Barrel Pattern" — the documented precedent.
- `ADS-project-knowledge/.local-artifacts/swarm-consensus/runs/2026-07-02-design-systems-debate/` — the 3-model architecture debate (F+G, 8.3/10).
- `ADS-project-knowledge/.local-artifacts/external-audit/` — the `/audit-work` packet, offloads, internal-verification.
- RFC: https://github.com/nexu-io/open-design/issues/5087

## Failure Cluster History

| Cluster | Retry Count | Files Touched | Current Hypothesis | Next Different Approach |
|---|---:|---|---|---|
| guard-import-form-gaps | 0 (resolved) | scripts/check-barrel-imports.ts | Scanner missed dynamic import/require, then missed domain-root stragglers | Both fixed + regression tests; no recurrence |
| agy/Gemini audit dispatch | 3 (abandoned) | N/A (external CLI) | agy CLI resolves to wrong model / times out — backend/env issue, not code | Left as degraded coverage; codex + internal gave independent convergence |
| tmpfs ENOSPC on task output | recurring (env) | N/A | Harness task-output dir hits a small quota; starves bash output capture | Workaround: `find /private/tmp/claude-501 -type f -delete`, redirect to repo-disk logs + Read tool |

## Resume Instructions

Read this ledger, then `apps/daemon/src/design-systems/README.md` for the full rationale. The code
work is DONE and verified — do NOT re-run the whole refactor. To confirm state quickly:
`node --import tsx --test scripts/check-barrel-imports.test.ts` (expect 25/25) and the real-tree
guard check. The live next step is maintainer-gated (RFC #5087) — do not open a PR until a
maintainer asks, and when you do, branch-carve cleanly (the working tree is mixed). Beware the
tmpfs ENOSPC issue: purge `/private/tmp/claude-501` and use repo-disk logs if bash output vanishes.
