# import-cycle-a — Jini half of the run report (2026-11-16)

Unattended cloud build run. Design: Tovu `plan/import-cycle-design-2026-11-16` `designs/import-cycles/DESIGN.md` §5 (rev 2), `AMENDMENTS-A` A7, `SEQUENCE.md` H2.
Branch `refactor/import-cycle-a` from `origin/refactor/terra` `02edbb68`. No pull request opened. Nothing force-pushed.
The full report, with the Tovu steps, is `cloud-results/import-cycle-a.md` on Tovu `refactor/import-cycle-a`.

Status: **J1, J3, J4 done. J2 not started, by instruction** (it runs after daemon lane R8b).

## Commits

| Step | SHA | What |
|---|---|---|
| J1 | `8eb653a0` | `agent-runtime/src/json-event-stream-shared.ts` leaf (former lines 11-188, verbatim); 5 handlers repointed; changeset |
| J3 (test) | `2b502ead` | 3 characterization tests for the comment queue's actions column |
| J3 | `ff4d9323` | `QueueActionsCell.tsx` + `QueueActionsCell.hooks.ts`; changeset |
| J4 | `c56f73eb` | guard rule R14: `scripts/check-runtime-cycles.ts`, `runtime-cycles.depcruise.mjs`, `runtime-cycle-debt.json`, fixtures |
| J4 (test) | `0a1b2dc0` | two guard-drift stub lists gain the new modules |

## Runtime module cycles after each step

Measured with the design's `edges.mjs` (transpile emit, 41 projects) + `graph.mjs summary`, and the J4 prototype on the pinned dependency-cruiser 18.1.0.

| After | Runtime file cycles | J4 rows | Package edges / cycles |
|---|---|---|---|
| base `02edbb68` | 3 (6, 4, 2 files) | 9 | 82 / 0 |
| J1 | 2 (4, 2) | 4 | 82 / 0 |
| J3 | 1 (4) | 3 | 82 / 0 |

The one left: `daemon/src/agent-executor/mcp-bridge.ts` with `claude/config-dir.ts`, `claude/mcp-delivery.ts`, `opencode/mcp-config.ts` (J2).

## Pins and mutation proof

Green on the unmodified tree first; each mutation was local and reverted.

- J1: agent-runtime parser and defs suites (49 files, 857 tests). `pickUsage` copies nothing → 10 red; a todo status rule lost → 2 red; `dispatchFrame` finds no handler → 108 red. The leaf written with an inline `import { type CodexStreamState }` → the gate reports the cycle again.
- J3: the 3 new tests. Hook ignores the filter status → 1 red; column passes empty permissions → 2 red; cell never renders the menu → 2 red; menu button rendered with no items → 1 red.
- J4: `runRuntimeCycleSelfTest`, 8 expectations. Imports read before compilation → 4 fail; no tsconfig → 4 fail; stale debt ignored → 1 fail; partial debt accepted → 1 fail; tests not excluded → 4 fail.

## Gates on `0a1b2dc0`

- `pnpm guard`: exit 0. `pnpm guard:drift`: exit 0, 0 new violations. `pnpm check:size`, `pnpm check:complexity`: pass.
- `pnpm -r --no-bail typecheck`: exit 0. `tsc -p scripts/tsconfig.json --noEmit`: 0 errors.
- `@jini-ai/agent-runtime`: 187 files, 4489 passed, 1 skipped, before and after J1.
- `@jini-ai/admin` after J3: 212 files, 2856 passed (3 new).
- `scripts/__tests__`: 835 passed, 7 failed, 33 skipped. The 7 (`coupling-isolation` ×5, `optional-peer-contract` ×2, and `extract-s3-source-contracts` failing to load) fail the same way on `02edbb68` in this container; one needs commit `35c4961af`, absent from a shallow clone.

## Deviations, for the owner

1. **J4 has a debt list.** The design adds the gate at error after J1–J3 with nothing left; the sequence moves J2 behind R8b. `scripts/runtime-cycle-debt.json` lists the four daemon files. Shrink-only: a cycle with any member outside the list fails, and an entry whose file left its cycle fails. Please ratify, or tell the J2 executor to change it.
2. **J4 is a guard check** (`guard.ts` and `check-guard-drift.ts`), not a `quality:depcruise` rule, because that config is report-only and counts type edges. It also scans `packages/cms/forms/src`, which the prototype's glob missed. About 16 s added to the guard.
3. **J3's prerequisite was not checked.** The design says to run J3 after untangle R1 is closed for `QueueSection.tsx` and `QueueSection.hooks.ts`; the sequence lists J3 as runnable now. If R1 still edits those files, expect a merge conflict.
4. J1 and J3 change no public surface. They carry patch changesets anyway, following the repo's precedent for internal changes.

## Next step

J2, after R8b: leaf `agent-executor/mcp-json-file.ts` per A7.4 (`McpJsonServerEntry` moves into the leaf; every consumer of the five names repointed), then delete the four entries in `scripts/runtime-cycle-debt.json`.
