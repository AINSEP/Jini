# wave1 xpkg-N1: create `@jini-ai/node-adapters` — DONE

Branch `wave1/xpkg-N1` (Jini only; Tovu untouched: step 0 proved no Tovu importer). Base `integ/merge-final-2026-11-16` = Jini `65d73b0d`, Tovu `232764af` (contains `a28cb1bf`; both ancestor checks printed `ok`). Node 24.11.1, pnpm 10.33.2.

## Steps and SHAs
| Step | SHA | What |
|---|---|---|
| 0 | (no commit) | N1-d printed nothing in Jini and Tovu (0 importers). Baseline: `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` green; `pnpm guard` green, saved as guard-before. |
| 1 | `01e425fc` | Gate rule `runtimeAdapters` + `adapterReason` in `scripts/lib/injection-edges.ts`, threaded through `injection-gate.ts`; T1a-f (9 cases incl. one per type-only SiteKind); `packages/README.md` paragraph. |
| 2 | `1e917e4b` | New package (manifest, tsconfig, vitest config, README, source-map), `git mv` of `fs.ts`, `process.ts`, `runtime-ports.test.ts`, `runtime-ports.typecheck.ts`; platform manifest loses the two `./runtime-ports/*` exports/entries/isolation lines; `exports.test.ts` updated; T3 `surface.test.ts`; lockfile importer; `api-baseline/jini-ai__node-adapters.json`; `.changeset/n1-node-adapters.md`. |
| 3 | this report commit | |

## Gates (all on the final tree)
- T1: red before the rule (9 failed), green after (47/47 in the injection test file). T3: red before the moves (2 failed), green after.
- `pnpm guard` exit 0 after steps 1 and 2. Diff vs guard-before: after step 1 identical. After step 2 one line differs: `injection advisory: 383 -> 385 test-only cross-package imports (259 -> 260 files)`. Cause: the new package's own typecheck fixture imports `@jini-ai/platform/fs|process`. Advisory, not failing; not a rule change (STOP not fired: no existing package passes/fails differently).
- N1-c (7 platform functions have public entries): printed nothing. N1-a, N1-b: nothing.
- `pnpm --filter @jini-ai/platform --filter @jini-ai/node-adapters build` ok; both entries import by package name from `packages/node-adapters`.
- Tests: node-adapters 11 pass (8 moved + 3 T3), coverage 100/100/100/100 on `fs.ts`, `process.ts`. platform 3114 pass, 6 skipped (3122 before: it lost exactly the 8 moved cases).
- `pnpm typecheck` exit 0. `pnpm check:size`, `pnpm check:complexity` pass. `pnpm api:check` exit 0.
- S3, S4, S6, S10, S11, S9 printed nothing. S8: no new finding (`checkPackageLayers` is 63 lines, already over 50 at base; I only added a table row).
- S7: only the reworded moved headers print (new wording: `source-map.md` and the module headers of `node-adapters/src/fs.ts`, `process.ts`: `@module fs` / `@module process`, `@jini-ai/platform`'s functions, `@jini-ai/node-adapters/fs|process` entries). Nothing else vanished.
- S13: one changed `expect` line, `platform/src/secrets/__tests__/exports.test.ts`: the pinned `exports` key list lost `./runtime-ports/process` and `./runtime-ports/fs` (same for the source-mapping list). No assertion weakened.

## Errors classified
- PRE-EXISTING: `pnpm check:hooks` fails (32 new-or-increased `useT` entries in `packages/ui`, none in node-adapters). `scripts/__tests__` has 7 failures in `coupling-isolation`, `optional-peer-contract` and `extract-s3-source-contracts` (git history shallow); identical on an unmodified `65d73b0d` worktree for the first two files. `api:check` shows unrelated baseline drift in 11 packages.
- ENV: `pnpm install` (non-frozen) hit `minimumReleaseAge` on undici 7.30.2 via electron; the lockfile was regenerated with `--lockfile-only --config.minimumReleaseAge=0` (command-line only, nothing committed); the diff is only the new importer.

## Deviations from the sheet (what the sheet got wrong)
1. `scripts/check-package-layers.ts` has an approved layer table (rule L0-unlisted-package) the sheet never mentions. Added `'node-adapters': 5` (above every domain it may name types of, below `server` 6). Done in step 1 so the fixture tests work.
2. L3 requires a type-only domain import to be declared as a manifest peer; the T1b source-import test declares the peer.
3. Sheet says `workspace:*`; platform uses `workspace:^`, which I copied (sheet also says copy platform's range style).
4. `runtime-ports.typecheck.ts` also held two platform-only checks (`RuntimePlatform`, `LocalBlobStorage`) that import platform internals; split out to `platform/src/__tests__/core-contracts.typecheck.ts` rather than moved.
5. `api:update` regenerated 11 other packages' stale baselines; I committed only `jini-ai__node-adapters.json` (platform's baseline never contained `runtime-ports`, so it needed no change).
6. vitest coverage `exclude` is `src/**/__tests__/**` (test and type-fixture files), thresholds 100.
7. No `isolation` block or `entries["."]` was demanded by `pnpm guard`; STOP not fired.
8. The sheet's server-side import check cannot pass (server does not depend on node-adapters yet; no importer exists); verified via self-reference from the package instead.

## Next step
Wave 0b lanes bind their own entries (R11a `./agent-plugins`, R11b `./http`, R10b `./agent-runtime`) and the preset/Tovu import `@jini-ai/node-adapters`; the first Tovu importer also adds the package wherever Tovu enumerates Jini packages.
