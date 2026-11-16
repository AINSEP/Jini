# API-surface check (`pnpm api:check`)

## Tool comparison (evaluated by inspection of docs/known behavior; only the chosen option was run)
| Tool | Fit | Verdict |
|---|---|---|
| `@microsoft/api-extractor` | Maintained, excellent `.api.md` reports, but one config + run **per entry point**, and it rolls up one `.d.ts`; this repo has 39 packages / 547 `exports` entries (many subpaths, conditional + CJS/ESM objects, CSS/JSON assets). Needs generated per-entry configs, bundler-package metadata, and is noisy on `skipLibCheck`/unresolved workspace deps (4 packages already fail `tsc`). | Too heavy for the benefit; revisit if signature-level (referenced-type) fidelity is needed. |
| `@arethetypeswrong/cli` | Checks that types/ESM/CJS resolution of a *packed* package is correct. Does not diff API across versions. | Complementary, not a diff tool. |
| `publint` | Lints package.json/exports correctness. No API diff. | Complementary, not a diff tool. |
| Custom: TS compiler API over `exports` | Needs no new dependency (`typescript` already a devDep), ~150 lines, handles every exports shape. | **Chosen.** |

Note: no maintained tool does "diff exports subpaths + exported symbols across the whole workspace and require a changeset" out of the box, hence the thin custom layer (unit-tested).

## Design
- `scripts/lib/api-surface.ts` (pure logic) + `scripts/check-api-surface.ts` (CLI). No runtime package code touched; no new dependency.
- For each non-private package in `packages/*` with `exports`: every subpath is recorded. If it resolves to a `.d.ts` (via `types` condition, or `import/default` `.js` -> sibling `.d.ts`), every exported symbol (re-exports resolved through aliases) is recorded as `kind:sha1(comment/whitespace-stripped declaration text)`.
- Baselines: `api-baseline/<scope>__<name>.json`, committed, generated from `refactor/terra` (post-build).
- **Rule:** exit 1 iff a package REMOVED an `exports` subpath or an exported symbol (rename = remove + add) AND no pending `.changeset/*.md` bumps *that package* `major` or `minor` (0.x: minor is the breaking bump). Added exports and changed declarations are printed, never fail.

## Commands
```
pnpm -r build          # dist/ required
pnpm api:check         # diff vs baseline; rule above
pnpm api:update        # regenerate baselines after an intentional change; commit api-baseline/
pnpm exec vitest run scripts/__tests__/api-surface.test.ts   # 8 tests (also in test:scripts)
```
CI: new step `api surface` in `.github/workflows/ci.yml` (`quality-gates` job) right after `pnpm -r run build`, before guard. It is blocking only under the rule above (so report-only for everything else).

## Baseline summary
39 published packages, 547 export entries (111 asset/no-types entries: css/json/swift/min.js/wildcards, tracked by subpath only), 16,156 symbols; 900 KB. Re-running on the unmodified tree reports no diff (deterministic). Negative check: deleting one export from `packages/memory/dist/index.d.ts` produced `BREAKING, NO major/minor changeset` and exit 1 (dist restored).

## Known limits
- A changed declaration is detected only on the exported symbol's own text; a change inside a *referenced* non-exported or separately exported type is not seen on the referrer (the referenced type is flagged if it is itself exported). Narrowed/widened parameter types in an unexported alias are missed.
- "Changed" is report-only; no breaking/non-breaking classification of signature changes.
- Wildcard subpaths (`./x/*`) and asset subpaths are tracked by key only; JS-only entries (no `.d.ts`) have no symbols.
- Baseline reflects build output: 4 packages (`daemon`, `ui`, `desktop-host`, `user-management`) fail `tsc` on the unmodified tree (pre-existing); their `dist` d.ts is still emitted so they are baselined, but fix those errors and run `pnpm api:update` if symbols appear/disappear.
- Changeset coverage is "any pending changeset for the package", not tied to the specific diff; `fixed: [@jini-ai/*]` means one minor bumps all anyway.
- Symbol-kind/hash of unresolved external re-exports is by kind only.
- `.changeset` entries are consumed on release, so after a release run `pnpm api:update` in the version PR (baseline must follow the published state).
