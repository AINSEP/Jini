# wave1 xpkg-R13a — DONE (Jini only; Tovu untouched)

Base: Jini `65d73b0d` (merge-final, ancestor check ok). Tovu base `232764af` (contains `a28cb1bf`; ancestor ok, both `rg` checks printed nothing). Tovu was not changed, so no Tovu install/typecheck/push was done (sheet R13a lists Jini files only).
Branch: `wave1/xpkg-R13a` (Jini).

## Baseline (unmodified tree, Node 24.22.3)
`pnpm install --frozen-lockfile` ok; `pnpm --no-bail -r build` exit 0; `pnpm guard` exit 0 (`/tmp/guard-before.txt`); sqlite tests 9 pass; infra tests 155 pass.
Census re-run: sqlite/infra rows identical to `R13.sites.tsv`; the only diffs are `file_loc` of `server/src/kernel-base.ts` (257 vs 268) on 5 allowed-preset rows (same edge kind, file already listed; not R13a).

## Steps
1. `e9915e61` — Q2 exceptions + debt retirement, one commit:
   - `scripts/injection-exceptions.json`: 5 entries (`sqlite→chat|daemon|db|registry`, `infra→db`), `ownerQuestion: "Q2"`, `approved: "2026-11-15"`, `note` = "...removed at the next major" (schema has a `note` field, so no `_comment` workaround). `_comment` reworded: the "empty by owner rule / deleted in lane R13" sentence is replaced by the Q2 freeze statement; "never add one to silence the gate" kept.
   - `scripts/injection-debt.json`: deleted only the 20 `packages/sqlite|infra` keys (lane R13) by hand.
   - Tests first: new `scripts/__tests__/injection-exceptions.q2.test.ts` (9 tests). RED run with the old (empty) files: 9/9 failed. Green after the edit. Each exception is proven load-bearing by removal (5 cases surface that owner's edges).
   - Existing `check-package-layers.injection.test.ts` pinned `loadExceptions(...) toEqual([])`; changed to "no exception other than a Q2 sqlite/infra one" (exact list is pinned by the new test). This is a deliberate edit of an assertion made obsolete by the owner rule (S13 shows the 2 removed lines).
2. `c09f988f` — freeze test gap. Verified with throwaway exports: sqlite `export const` fails 2 tests; infra runtime + type-only additions fail `shim-surface` (2 tests). **Gap found:** a type alias/interface declared inside `sqlite/src/index.ts` passed all tests. Added test "declares no export of its own in index.ts" (`packages/sqlite/src/__tests__/surface.test.ts`): GREEN on current code; RED under `export type`, `export const`, `export default` mutations (run, reverted). sqlite tests 9 → 10. Infra needed no new pin (`shim-surface.test.ts` already compares sorted names via the TS checker for both db entries). `infra/events/outbox` is real code, not a Q2 forwarder, and is not part of this freeze.
3. GAPS Q-G2: not touched (keep the chat wrappers in sqlite).

## Gates (final tree)
- S1: `pnpm --filter @jini-ai/sqlite build` ok; sqlite tests 10/10; `pnpm guard` exit 0; `pnpm typecheck` exit 0. `diff guard-before guard-after` empty (S14: the frozen edges were already tolerated through the debt file; no new finding).
- S3, S4, S6, S7, S9, S10, S11: print nothing. S8: no production source file changed (tests/scripts only); `check:size` and `check:complexity` pass.
- S13: only the 2 removed lines above.
- S5: `pnpm check:hooks` exits 1 on the **unmodified base too** (32 new/increased entries in packages/ui, chat, admin, ...; none in files I touched). PRE-EXISTING; no new key added to `hook-injection-debt.json`.
- S2 RED outputs: see step 1 and 2 above.

## STOPs hit: none. Deviations: the edited gate assertion; the extra sqlite pin. What the sheet got wrong: it says "infra pin if missing" at `surface.test.ts`; it exists as `shim-surface.test.ts`. Next step: R13c (needs wave 1 order), then R13b in wave 2.
