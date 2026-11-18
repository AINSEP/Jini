# xpkg-wave1d — C9c DONE (step 4 STOPPED), C12-OBS SKIPPED (STOP rules hit before any commit)

Branch `wave1/xpkg-C9c-C12OBS` in Jini and Tovu. Base: Jini `65d73b0d`, Tovu `232764af5` (both `origin/refactor/terra`; the two `merge-base --is-ancestor` lines printed `ok`, both `rg` prerequisite lines printed nothing).
Node 24.22.3, pnpm 10.33.2 (via corepack), Jini `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build` green, Tovu `npm ci` (root + apps/admin), link step against `/home/user/Jini/packages`, `packages/contracts` + `packages/sdk` built.

## Commits
| Repo | SHA | What |
|---|---|---|
| Jini | `3dae173e` | C9c: `user-management/react/kit` contract: 4 component slots, 5 hook slots, provider, typed missing-provider error, fake, probe test |
| Tovu | `331d9388` | C9c pair: `userManagementKit` in `jini-kits.ts`, `UserManagementKitProvider` mounted in `main.tsx`, host integration test over the real implementations. Checked against Jini `3dae173e` |

## C9c
Done: sheet items 1, 2, 3, 5.
- `packages/user-management/src/react/kit.tsx` (110 lines), `src/react/__tests__/{fake-um-kit.tsx,kit.unit.test.tsx}` (13 tests), `package.json` `./react/kit` export + `jini.entries` line, README row, `api-baseline/jini-ai__user-management.json` (regenerated; the other 11 baselines `api:update` also rewrote were reverted: pre-existing drift on the base, `pnpm api:check` exits 0 before and after).
- Tests first: `kit.unit.test.tsx` RED (`Failed to load url ../kit.js`) before `kit.tsx` existed, then 13/13 green. Mutations that turn it red: `requireUserManagementKit` returns a stub instead of throwing -> 6 red; provider without keep-first-kit -> 1 red; InfoTip slot resolving RowMenu's implementation -> 5 red. Tovu: swapping `ConfirmDialog` for the ui-kit one turns the host test red.
- Slot bodies read React's `useContext` and pass the value to the plain `requireUserManagementKit`; `pnpm check:hooks` findings before/after are identical (the base is already red with 32 findings in `packages/ui`, none touch user-management) and `scripts/hook-injection-debt.json` is untouched.
- (d) type-level case uses `expectTypeOf(...).not.toMatchTypeOf<UserManagementKit>()`, not `@ts-expect-error` (S10 bans it).
- The three non-listed source-reading tests had to change (run ALL package tests caught them): `package-entries.test.ts` and `user-management-rename.contract.test.ts` hard-coded a `.ts` source for every entry (now `.ts` or `.tsx`; still requires the file to exist), and `public-args.test.ts` rejects zero-parameter exported functions, so `useUserManagementKit` and the error constructor take `(_required: Record<string, never> = {}, ...)`. Rename-contract expected-entries list gained `./react/kit`. No test removed or weakened.
- Judgment calls: `RowMenu`, `ConfirmDialog`, `InfoTip` slots are plain function components, not `forwardRef` (the real components take no ref; only `SecretInput` forwards one). `QueryKey`/`FetchQueryAdapter` come from `@jini-ai/core/fetch` (base package) instead of being restated; R3b can import `QueryKey` from core. I did not add the provider to Tovu's `__tests__/render-with-jini-kits.tsx` (not in the sheet; R3b must add it there, it documents "same tree as main.tsx").
- **STOPPED: item 4 (`*KitNeeds` deletion).** `rg "(roles|users|members|auth)KitNeeds"` has readers: 5 user-management test files (`RolesPage.pins`, `UsersPage.pins`, `people-hooks`, `UsersTab.hooks.pins`, `MemberRow.pins`) and the public `kitNeeds` property each `users()/members()/auth()/roles()` module returns (`PORT.md` tells hosts to read `feature.kitNeeds`). Tovu has none. Per the sheet: STOP. The `needs` import in `admin/react/index.ts` and its debt key are untouched. Next step: owner decides whether `kitNeeds` is dropped from the public module surface (then the 5 tests move to the provider the pages really need).

## C12-OBS: SKIPPED (STOP, nothing pushed from it)
Prerequisites re-run on the base:
- 7 of 8 guard blobs match (`ports.ts 176e9848dee5`, `noop.ts 195da886c3d8`, `analytics product/index.ts a8b747389984`, `browser.ts bb36f5fe158c`, daemon `tool-recovery/observability.ts 009d368dc51d`, http-kit `observability.ts 53efb9b78a27`, provider-plugins `contract.ts c3b9898ac004`). **Mismatch: `packages/core/package.json` is `788ea195acca`, sheet says `cb0e21d24eb2`** (merge-a commits `3cafc12f`, `321608d9`, `172f9b4c`, `988221a2` touched it after the sheet's integ-view).
- Census drift, applier dry-run: `rows 165; applied 146, already 2, keep 1, manual 13, STALE 2`.
  - Row 152 (Tovu `modules/assistant-run-finalizer.ts`) is gone: the file was split into `modules/run-finalizer/*` by another lane.
  - Row 12 (analytics `product/index.ts` `import('./browser.js')`) only goes stale because I had already applied step 2 by hand (expected).
  - **Importers of moved names that no row lists** (same edge kind, new files): Jini `packages/diagnostics/src/observability/__tests__/tracker-metric-rejection.unit.test.ts` (`../noop.js` -> `createNoopObservabilityPort`); Tovu `apps/website/src/server/runtime/composition/modules/run-finalizer/entry.ts` (`ObservabilityPort`, `createNoopObservabilityPort`), `.../modules/run-daemon-http-client.ts` (`ObservabilityPort`), `apps/website/src/server/__tests__/assistant-run-finalizer.characterization.unit.test.ts` (`createNoopObservabilityPort`).
- COMMON: "A new or missing row ... in a file your sheet does not list: STOP", and the Jini commit cannot ship without the Tovu repoint (Tovu would be red against it), so I pushed nothing for C12-OBS.
- STOP check on identity: no caller mutates or compares the noop port (all use `{ ...noop, x }` spreads); `isNoopObservabilityPort` only gets `===` against the one frozen port.

Prepared and verified so far (not applied, not committed): `cloud-results/xpkg-wave1d-C12-OBS-prepared-jini-hand-edits.patch` (`git apply` on `65d73b0d`): new `core/src/contracts/observability.ts` (163 lines: 27 + 7 names moved verbatim with their comments, L6 fix as one frozen `NOOP_PORT`), `ports.ts`/`noop.ts`(deleted)/analytics edits, `package.json` export + `jini.entries` + README row, and the moved noop test with two new cases. Verified: test RED first (`Failed to load url ../observability.js`), core `tsc` clean, core build ok, core vitest 198 files / 2940 tests green; mutations (fresh object per call, structural noop check, unfrozen port) each turn 1-2 of the new cases red. NOT done: applier pass on the 126 files, the 3 restatement deletions (daemon, http-kit, provider-plugins), the 13 MANUAL rows, changeset, injection-debt keys, diagnostics/analytics/daemon/http-kit/provider-plugins tests, Tovu typecheck.
Next step: owner (or the plan branch) adds the 5 rows above to `C12-OBS.repoint.tsv`, refreshes the `core/package.json` guard, drops row 12; then re-dispatch C12-OBS and apply the patch first.

## Gates (Jini, at `3dae173e`; BASE=65d73b0d)
| Command | Result |
|---|---|
| `pnpm --filter @jini-ai/user-management build` | ok |
| `cd packages/user-management && npx vitest run --maxWorkers=2` | 104 files / **1246 passed** (baseline 1233; +13 new, 0 removed) |
| `pnpm guard` | exit 0; diff of before/after capture is empty |
| `pnpm typecheck` | exit 0 |
| `pnpm check:hooks` | 32 pre-existing findings, before/after output identical, no new `hook-injection-debt.json` key |
| `pnpm check:size` / `pnpm check:complexity` | both passed (ratchets unchanged) |
| `pnpm api:check` | exit 0 before and after |
| S8 eslint 50/10/500 block on `kit.tsx` | prints nothing |
| S3, S4, S6, S10, S11, S7 `rg`/`comm` blocks | print nothing |
| S9 | lists: `fakeUmKit`, `renderWithUmKit` (test helpers), `UserManagementKitProvider(required, _optional = {})`, `useUserManagementKit(_required = {}, _optional = {})`, slot components `RowMenu/ConfirmDialog/InfoTip(props)` (React component props object, not a forwarder: each resolves the slot implementation from context and renders it) |
| S5 import rg (Jini) | prints nothing |

## Gates (Tovu, at `331d9388`, linked to Jini `3dae173e`)
| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (baseline also exit 0); `satisfies UserManagementKit` compiles with no cast |
| `npm run check:size`, `check:complexity`, `check:architecture` | exit 1 on the base and **byte-identical output after** (no worse; base red as the brief said) |
| `npm run check:hooks` | exit 0, identical |
| `npm run check:errors` | exit 0 (WARN mode; not compared with a baseline, my diff has no catch blocks) |
| `npx vitest run --maxWorkers=2` in apps/admin: new host test + `credential-input-autocomplete`, `login-default-credential`, `forms-swap`, `widgets-swap` | 5 files / 48 passed. The full admin suite was NOT run |
| S3, S4, S6, S10, S11 blocks | print nothing. S5 import rg lists `useAsyncAction` added to `jini-kits.ts` (the host supplying the real hook to the kit, same as the existing `adminKit` lines) and the wrapper hooks imported by the host test |

## Overlaps with parallel runs
Jini: `packages/user-management/{package.json,README.md}`, `api-baseline/jini-ai__user-management.json` (R3b later). Tovu: `apps/admin/src/integrations/jini-kits.ts` and `main.tsx` (INDEX §4: R1c, R2a rebase additive lines on top). No other file touched. Pre-push: Jini hooks were not bypassed; no `--no-verify` used on either repo.
