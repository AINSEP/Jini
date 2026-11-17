# wave1-merge (Jini): integ/wave1-merge-2026-11-17

Base: `origin/refactor/terra` = `integ/merge-final-2026-11-16`, Jini `65d73b0d5`. Branch `integ/wave1-merge-2026-11-17` (only this branch pushed). Node 24.22.3, pnpm 10.33.2. Setup: `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (exit 0 on the unmodified base, 2m26s).

## Merged (one `--no-ff` merge each, in the requested order). All 8 merged, none skipped.
| # | Branch | Merge SHA | Notes |
|---|---|---|---|
| 1 | wave1/xpkg-N1 | a1dddfd4 | new `@jini-ai/node-adapters` package; clean merge |
| 2 | wave1/xpkg-R13a | a0165406 | clean |
| 3 | wave1/xpkg-R13c | 0c1a9cfd | clean |
| 4 | wave1/tc-S10 | c767d334 | clean |
| 5 | wave1/tc-S14a | 3df908a3 | clean |
| 6 | wave1/tc-S15 | 47976e0f | clean |
| 7 | wave1/xpkg-G-STALE-DEPS | 0bb37b6d | squashed c4567c13+20c8d04c (see below); one conflict resolved |
| 8 | wave1/notes-waveA | bfb64d55 | clean; whole branch (see "left out") |

Report commit (this file) comes after `bfb64d55`; its SHA is in the final message.

### xpkg-G-STALE-DEPS squash
Built a temp branch from `65d73b0d`, cherry-picked the 11 commits before the pair, squashed `c4567c13` (red alone: the package-surface test still named db as an optional peer) and `20c8d04c` (its fix) into one commit (`git cherry-pick -n` both, one commit), then cherry-picked the last 3. `git diff` between the temp branch tip and `origin/wave1/xpkg-G-STALE-DEPS` was empty (identical tree), 15 commits instead of 16. The temp branch was merged, then deleted (never pushed).

### Conflict (the only one in either repo): `scripts/injection-debt.json`
R13a deleted the 20 `packages/sqlite|infra` keys; G-STALE-DEPS deleted the `http-kit/package.json`, `integrations/package.json` (db), and three `ui/package.json` keys. Each side kept the other's deleted lines, so git showed two conflict blocks. Resolution is certain: both blocks drop every line (each line was deleted by exactly one side). Verified: JSON parses, zero `packages/sqlite|infra|http-kit/package.json|ui/package.json` keys remain, `pnpm guard` 0, injection tests 56/56.

### notes-waveA: what was left out
Nothing in the branch needed leaving out: the unfinished N2 web half was never committed upstream (`examples/notes-web` does not exist on the branch; the run was blocked by pnpm `minimumReleaseAge` on `undici@7.30.2` when adding a workspace package to the lockfile). Merged: N0, GA, N1, N2 server half (`f22ca5c2`, `89bc01b5`). **Not in the tree (left undone upstream): N2 steps 1-5 and 7 (notes-web scaffold, T1-T4, styles, README) and all of N3.** Unblocks on 2026-11-19 or an owner `minimumReleaseAgeExclude`.

## Gates
After each merge (`install --frozen-lockfile`, then `pnpm --filter "...[HEAD~1]"` = changed packages + dependents: build, `typecheck`; then `tsc -p scripts/tsconfig.json`, `pnpm run check:size`, `pnpm run check:complexity`, `pnpm run guard`): all green after merges 2-8; after merge 1 the full `pnpm --no-bail -r build` + `pnpm typecheck` + same ratchets + guard were run. Base before any merge: size/complexity/guard/api:check exit 0.
Changed-file/package tests (`npm --prefix packages/<pkg> run test -- --minWorkers=1 --maxWorkers=2`; root `npx vitest run --minWorkers=1 --maxWorkers=2 <files>`; note `--maxWorkers=2` alone makes this repo's vitest config error with "minThreads and maxThreads must not conflict"):
- N1: node-adapters 11 pass; platform secrets 487 pass; `scripts/__tests__/check-package-layers.injection.test.ts` 47 pass.
- R13a: `injection-exceptions.q2.test.ts` + injection test 56 pass; sqlite 10 pass.
- R13c: server 507 pass / 1 skipped; cli 592 pass.
- S10: core 199 files / 2946 tests pass.
- S14a: diagnostics 61 files / 997 tests pass.
- S15: mcp 1805 pass; daemon 4729 pass / 1 skipped.
- G-STALE-DEPS: plugins 1011, user-management 1233, chat 4434 (+1 skipped), injection + q2 tests 56 pass. (Counts equal the branch report's.)
- notes-waveA: admin 219 files / 2871 pass; notes-app `node --test 'src/**/*.test.ts'` 112 pass, `node scripts/smoke.ts` PASS, `pnpm run gaps` ok (7 files).
Final full tree (`bfb64d55`): `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0 (no ELIFECYCLE), `pnpm typecheck` 0, `check:size` pass (157 debt entries, 8 accepted exceptions: same as base), `check:complexity` pass (17 entries: same as base), `pnpm guard` 0.
- `pnpm run api:check`: exit 0 (it printed drift, as on the base, but does not fail). Its gate did not say to regenerate, so **no api baseline was regenerated**. The new core/diagnostics subpaths and admin type changes show as "added/changed", the same informational drift each branch report noted.
- `pnpm check:hooks` exits 1 on the unmodified base (`useT` direct calls in `packages/ui`, pre-existing); not run per merge, not made worse by these merges (no branch touched those files except notes-waveA's admin hook-injection commit, which its report says lowered the count).
- `pnpm check:errors` (WARN mode, exit 0) reported "18 new or worse" on the base; not re-run after merges.
- Not run: whole-repo test suites; full per-package tests for the 13 packages G-STALE-DEPS touched beyond the ones listed (manifest-only change, build + typecheck + guard green).

## Next step
Review the pushed `integ/wave1-merge-2026-11-17` and fast-forward/merge it into `refactor/terra` when ready; open owner decision remains on xpkg-G-STALE-DEPS row 1 (`agent-plugins -> commerce`), and notes-web waits for the undici release-age window.
