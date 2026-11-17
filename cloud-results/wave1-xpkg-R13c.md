# wave1 / xpkg-R13c: DONE

Sheet: `R13-hosts.md` sub-sheet R13c (plan branch `plan/xpkg-lane-sheets-2026-11-16`), `COMMON.md` rev 3.
Repo changed: **Jini only** (branch `wave1/xpkg-R13c`). Tovu not changed (no importer of `createFrontendControl` from `@jini-ai/server`; every Tovu file imports it from `@jini-ai/daemon/http`).
Base: Jini `65d73b0d` (`integ/merge-final-2026-11-16`); Tovu `232764af` (tip of the same branch, contains `a28cb1bf`).

## Prechecks and baseline
- `merge-base --is-ancestor` ok in both repos; both `rg` prechecks printed nothing.
- Node 24.11.1, pnpm 10.33.2; `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`: green.
- Baseline on the unmodified tree: `pnpm guard` exit 0 (saved), `@jini-ai/server` 505 passed/1 skipped, `@jini-ai/cli` 591 passed.
- Not run on the base: Tovu typecheck on the unmodified pair; it was run after the change instead (below, green).

## Steps
| # | Commit | What |
|---|---|---|
| R13c.1 | `4f4c4f7f` | Deleted `export { createFrontendControl }` and the 4-type `export type` (the "second daemon site", `index.ts:95`) from `packages/server/src/index.ts`. Only importer: `examples/reference-web/src/daemon.ts` now imports it from `@jini-ai/daemon/http`. `packages/server/docs/spec/api.spec.md` paragraph rewritten (it wrongly said "re-exported from http-kit"). `api-baseline/jini-ai__server.json` regenerated. |
| R13c.2 | `8a1e6df3` | Removed `@jini-ai/platform` from `packages/cli/package.json` (it was in `dependencies` and `devDependencies`), 3 lines from `pnpm-lock.yaml`. cli README + API spec said the loopback classifier is `platform/net`; it is `core/net` (`daemon-url.ts:1`), fixed. `cli -> sidecar` untouched (allowed preset edge). |

## Tests first (S2)
- R13c.1: `packages/server/src/__tests__/index.test.ts` gained two cases (exact sorted runtime export list; `createFrontendControl` absent + source has no `FrontendControl*`/`@jini-ai/daemon/http`). RED before the deletion (2 failed / 3 passed), GREEN after (507 passed / 1 skipped = 505 + 2).
- R13c.2: `packages/cli/src/__tests__/integration-surface.test.ts` gained a manifest-vs-production-imports test (declared `@jini-ai/*` in both `dependencies` and `devDependencies` must equal the set imported by non-test src). RED while `platform` was declared, GREEN after (592 passed = 591 + 1). A first version failed typecheck (`match[1]` possibly undefined); fixed with a destructure and an `undefined` guard, no cast.

## Gates
- Per commit / final: `pnpm --filter <pkg> build`, package tests, `pnpm guard`, `pnpm typecheck` all green (exit 0).
- S14: `diff guard-before guard-after` identical (no finding appeared or disappeared).
- Tovu linked to Jini `8a1e6df3` (`link-jini.mjs`, contracts + sdk built): `npm run typecheck` exit 0.
- S3, S4, S6, S9, S10, S11, S13: print nothing.
- S5: `pnpm check:hooks` exits 1 **on the base too** (identical output at `65d73b0d` and HEAD; 32 pre-existing "new" entries in `packages/ui` etc.). PRE-EXISTING, not lane-caused. The two diff `rg` checks print nothing.
- S7: the only comment that vanished is the two-line comment above the deleted export ("Frontend control belongs to the daemon HTTP surface ... keeps its existing public export"). Its content is now the why-comment above the new export-list test in `index.test.ts` ("owned by `@jini-ai/daemon/http`: the preset is wiring only and must not re-export another package's API").
- S8: changed production source is only `packages/server/src/index.ts`; the 50/10/500 eslint loop printed nothing. `check:size` and `check:complexity` ratchets pass.
- S12 / S15: not applicable (no port binding, no security path touched).
- Census re-run (`census.mjs`, R13 rows): only differences are the 2 `index.ts` rows removed by R13c.1 (expected), `kernel-base.ts` line-count shift 268 -> 257, and the fix/lane metadata columns. No new or missing edge kind. `R13 work: 0`.
- `scripts/injection-debt.json`: no keys involved; none retired.

## STOPs hit
None. (`check:hooks` failure is pre-existing and identical at base, so it is not a STOP for this lane.)

## Deviations / notes
- `pnpm api:update` rewrote 11 baselines; the other 10 differ only because the baseline files on the base were already out of date with the source (not touched by this lane). I committed only `jini-ai__server.json`. Its diff also carries pre-existing drift (`BuiltInFeatureOptions`, `ComposeJiniKernelConfig`, `CreateLocalNodeDaemonConfig`, `FeatureBuildContext` hashes, the `./adapters/node-pty` subpath) next to the 5 removed frontend-control entries. `api:update` reads `dist`, so `@jini-ai/server` has to be rebuilt first (the first run did not drop the entries).
- `pnpm install --no-frozen-lockfile` fails here (minimumReleaseAge on `undici`), so the three lockfile lines were removed by hand; `pnpm install --frozen-lockfile` then accepts the lockfile.
- The sheet's R13c.1 "pair if Tovu has one": Tovu has none, so no Tovu commit.

## Next step
R13b (G-SERVER-LOGIC) waits on this lane per INDEX wave order; R13a and R13d are separate sub-sheets, not run here.
