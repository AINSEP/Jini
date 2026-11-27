# bugd-rerrj — Jini handoff

Scope: sheet 3, then sheet 4b only. Both sheets explicitly require no Jini changes.

## Completed design commits

None. No Jini work; no production or test files changed.

## Sheet disposition (design order)

1. Sheet 3 — no Jini work. Failure reporter wiring and legacy sink removal belong entirely to the named host repository files. Regression test and mutation `restore-unbound-legacy-sink` remain for that repository; neither was implemented or run here.
2. Sheet 4b — no Jini work. BYOK composition split and size test belong entirely to the named host repository files and follow sheet 3 there. Mutation `rejoin-byok-composition` remains for that repository; neither the test nor the move was implemented or run here.

## Files touched

- COMMIT-PLAN.md — uncommitted coordinator handoff only.

## Verification and remaining scope

- Read the dispatched programmer instructions.
- Confirmed branch codex/bugd-rerrj tracks origin/codex/y5-bugsj; initial working tree was clean.
- No installs, builds, tests, typechecks, linters, commits, pushes, or subagents.
- Sheets 1, 2, and 4a are outside this dispatch and owned by another job.
- No new package subpaths, exports, changesets, version bumps, or release steps required.
- Diff review: only this handoff file was added; no deletions required.
