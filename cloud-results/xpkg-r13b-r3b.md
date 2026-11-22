# xpkg-r13b-r3b: R13b STOPPED (sheet contradicts the code), R3b DONE

Branch `wave2/xpkg-r13b-r3b` in Jini and Tovu. Node 24.22.3, pnpm 10.33.2 (corepack), Vitest `--maxWorkers=2`.

## Bases (both merges are `--no-ff`)
- **Jini**: `origin/integ/wave1-merge-2026-11-17` (`9fe7d3d3`, contains R13c; `git merge-base --is-ancestor 65d73b0d HEAD` printed `ok`) + **one `--no-ff` merge of `origin/wave1/xpkg-C9c-C12OBS`** = `c481c01db`. All R3b work sits on it.
- **Tovu**: `origin/refactor/terra` (`232764af5`, ancestor check `ok`) + **one `--no-ff` merge of Tovu `origin/wave1/xpkg-C9c-C12OBS`** (`c92cc9d64`). The brief named only the Jini merge, but C9c is a pair: its Tovu half (`331d93883`, `userManagementKit` in `jini-kits.ts` + `UserManagementKitProvider` in `main.tsx`) is the "provider already mounted" that R3b's commits rely on, and it was not in `refactor/terra`. Without it every Tovu screen would throw "kit not provided". Say so if you want it handled differently.
- Baseline on the merged pair (before my first edit): Jini `pnpm guard` exit 0; `pnpm check:hooks` exit 1 (32 pre-existing findings, output saved); user-management vitest 104 files / 1246 tests green; Tovu `npm run typecheck` exit 0 (linked to Jini `c481c01db` tree).

## R13b: STOPPED before any commit (two STOP triggers; no redesign attempted)
The sheet's R13b STOP: "a vault function has a second owner already, or a characterization test cannot be made to fail under its mutation". Both hold.
1. **`owner-store/backup.ts` is not what the sheet describes.** The sheet says "passphrase re-encryption of vault exports", with tests (a) export->import round trip, (c) non-copyable kind absent from the export, (d) no plaintext in the export, and mutations "skip re-encryption", "copy all kinds", "write plaintext". The file has **no export, no seal and no re-encryption** (`rg "sealWithPassphrase|exportOwnerStore|restoreOwnerStore|encrypt" packages/server/src -g '!**/__tests__/**'` prints nothing). It is a read-only decoder of the legacy `jini-owner-store` v1/v2 backup (`readLegacyOwnerBackup`: `openWithPassphrase` then structural validation). `@jini-ai/db`'s CHANGELOG says the owner store became "a read-only legacy reader". Tests (a), (c), (d) and their mutations have nothing to run against. (b) wrong passphrase and the validation cases already exist in `owner-store/__tests__/backup.test.ts` (121 lines).
2. **A second owner exists in the folder the sheet names.** `packages/platform/src/secrets/credential-sets/vault-archive.ts` already owns the portable vault entry (`VaultArchiveEntry`, field-for-field the same shape as `LegacyOwnerEntry`), the portable-kind rule (`assertPortable`) and restore validation (`prepareVaultArchiveRestore`, `captureVaultArchive`). Moving the legacy decoder next to it would be a parallel owner unless the two are first reconciled, which is a design decision (and `LegacyOwnerSnapshot` also carries the owner store's grant/revocation concepts, which platform does not have).
3. The move would also break a public surface: `@jini-ai/server/owner-store` exports `readLegacyOwnerBackup`/`OwnerStoreBackupError` (api-baseline `jini-ai__server.json`) and Tovu imports them (`apps/website/src/cli/commands/owner-store.ts:11-12,222-265,375-376`). Tovu has no other importer.
`legacy.ts` (item 3) depends on `backup.ts`'s types and the same platform folder, so it is blocked with it.

### Inventory (sheet step 1, written before moving anything)
| file | exports | importers (Jini / Tovu) | tests | module-level values |
|---|---|---|---|---|
| `owner-store/backup.ts` (161) | `readLegacyOwnerBackup`, `OwnerStoreBackupError` | `owner-store/index.ts`; Tovu `apps/website/src/cli/commands/owner-store.ts` | `owner-store/__tests__/backup.test.ts` | `INVALID_BACKUP`, `BACKUP_VERSION=2`, `LEGACY_BACKUP_VERSION=1`, `ENTRY_FIELDS`, `HINT_FIELDS`, `REVOCATION_FIELDS`, `GRANT_FIELDS` |
| `owner-store/legacy.ts` (121) | `OWNER_WORKSPACE_ID`, `ownerContext`, `countLegacyOwnerStore`, `readLegacyOwnerStore`, `OwnerStoreRecoveryError`, types `LegacyOwner{Entry,Destination,Snapshot,Counts,StoreFile}` | `owner-store/index.ts`, `backup.ts` (types); same Tovu file | `__tests__/legacy.test.ts`, `unit/legacy-empty-m2.unit.test.ts`, `fixture.ts` | none (a `LegacyOwnerDatabase` interface) |
| `storage/legacy/sqlite.ts` (66) | `migrate`, `createLegacySqliteStorage`, `openDatabase`, `closeDatabase` | **none in Jini source**; `packages/sqlite` only aliases the path in `vitest.config.ts`/`tsconfig.json` and its README documents it; **none in Tovu source** (only allowlists in `scripts/__tests__/storage-public-entries.test.ts`, `scripts/check-engine-boundaries.ts`, `knip.json`, `scripts/error-gate-debt.json`) | `storage/__tests__/legacy-sqlite.test.ts`, `legacy-ownership.test.ts` | `defaultStorage` singleton (`openDatabase`/`closeDatabase` are its methods) |

Item 4 reading (recorded, no change): `packages/sqlite`'s `src/index.ts` does not export `openDatabase`/`migrate`, and no host imports `storage/legacy/sqlite`, so by the sheet's own rule it **stays in the preset** (it wires three packages' DDL lists). Adding it to the frozen `sqlite` surface would change R13a's pin for no importer.

**Needs a decision before R13b can run:** rewrite the sheet for what the code is (a legacy reader/decoder, not an exporter), and say whether the decoder is deleted after the one-time import is done, reconciled into `vault-archive.ts`, or kept in the preset as legacy wiring.

## R3b: DONE (15 sites onto the kit, 4 commits + 1 test-support commit, Jini)
| SHA (Jini) | step |
|---|---|
| `aaad7c4e7` | test support: `fetch-query-support.ts` also mounts the host binding (`realUmKit`: real ui/admin components + hooks, same as Tovu's `userManagementKit`); no production file touched |
| `d100f7d55` | `react/auth` (2 sites): `Login`, `TotpSettings` import the `SecretInput` slot from `../kit.js` |
| `5727dd5bf` | `react/members` (3 sites): `Members` slots `RowMenu`/`ConfirmDialog`; `use-members.hooks.ts` wrappers; `rules.ts` `RowMenuItem` type |
| `b2c6a1771` | `react/users` (10 sites): `Users` (4 slots), `ChangeUsernameDialog`, `UserRowParts`/`rules.ts` types, two hook files |
| `2282c1d20` | manifest: `@jini-ai/ui` and `@jini-ai/admin` removed from `peerDependencies`, `peerDependenciesMeta`, `jini.optionalPeers` (kept in `devDependencies` for the real-binding tests); two manifest-peer debt keys retired; manifest assertion + README updated; `@jini-ai/ui-kit` stays |

Tovu (all "Checked against Jini <sha>"): `5bdf79ff9` (render helper imports the provider), `894fae06b` (**fix: the provider line of the previous commit had not applied**; found when `5727dd5bf` turned 14 admin tests red; my slip, fixed forward), `fb2031357` (two users hook tests wrap `userManagementKit` beside `FetchQueryProvider`). The Tovu commits only touch test files. Pushed after each Jini step.

- **Tests first (S2):** each folder got a fake-kit page test file written and run RED before its import switch (auth 8 red of 12, members 7/7, users 10/10), then green after. `ChangeUsernameDialog.kit.unit.test.tsx`: 4/4 red under a one-line mutation of its import back to `@jini-ai/admin/react`. Each file also has a "no provider -> typed `UserManagementKitMissingError`" case. Pages covered: loading, error, loaded, every conditional slot (`ConfirmDialog` closed/open/confirm/cancel with tone, `RowMenu` items per status, `SecretInput` in the sign-in, TOTP, new-user and both reset-password fields, `InfoTip`).
- **Hook rule:** no component calls `useUserManagementKit()` or a new custom hook; slot components keep the C9c `useContext` bodies. `pnpm check:hooks` before/after identical; `scripts/hook-injection-debt.json` untouched.
- **Debt keys retired** (`scripts/injection-debt.json`, hand-deleted, 14 lines): `react/auth/{Login,TotpSettings}.tsx` (2), `react/members/{Members,rules,hooks/use-members}` (3), `react/users/{Users x2,ChangeUsernameDialog,UserRowParts,rules x2,hooks/use-users (count 2),hooks/use-change-username}` (9 lines), `package.json` manifest-peer `@jini-ai/admin` and `@jini-ai/ui` (2). Also lowered `scripts/size-debt.json` `Users.tsx` `<file>` 725 -> 723 (the file shrank by two import lines; the ratchet demands it).
- **Option C kept:** nothing under `src/admin/react/**` was touched (the 23 `allowed-optionC` imports and the `needs` import in `admin/react/index.ts` stay; the `*KitNeeds` STOP from C9c is unchanged).
- Final scan: `rg "@jini-ai/(ui|admin)['/\"]" packages/user-management/src -g '!**/__tests__/**' -g '!*.test.*'` prints only `src/admin/PORT.md` code samples (docs).

### Test counts (user-management, `npx vitest run --maxWorkers=2`)
Base 104 files / 1246 tests -> final **109 files / 1279 tests** (+5 files, +33 tests: Login 6, TotpSettings 6, Members 7, Users 10, ChangeUsernameDialog 4), 0 removed. Existing page/hook tests were **not** converted to `renderWithUmKit`: they keep running over the real ui/admin binding through `fetch-query-support` (`realUmKit`) as the sheet's "one real-implementation render per page stays". They rely on real cache/invalidation and real markup (e.g. the eye toggle named by the host translator), which the fake's in-memory hooks cannot express. That is the sheet's "needs a behaviour the fake cannot express" case: these are integration tests, not dropped. Three hook-only files and `fetch-query-support` now import the real binding in their wrapper (`integration-reconcile`, `use-users.hooks.pins`, `use-users.ported`).

### Sheet slips and things the sheet asked for that I did not do
1. "type-only imports (`RowMenuItem`, `QueryKey`) come from `kit.tsx`": `kit.tsx` exports `RowMenuItem` but not `QueryKey` (C9c took it from `@jini-ai/core/fetch`). `rules.ts` imports `QueryKey` from `@jini-ai/core/fetch` (same type `ui` re-exports); adding a re-export to `kit.tsx` would be a forwarder.
2. "the error state: the plain-words error and its **Copy-details control** render": no screen under `src/react/**` has a Copy-details control (they render a plain `notice error`/`role=alert`). Adding one is a behaviour change; I asserted the plain-words text only and did not add the control.
3. "`kit.tsx` stays a declared dependency of ui-kit": unchanged.
4. **Chrome look not done** (users list, row menu, change-username dialog, member invite, login, TOTP, light and dark): unattended run, no seeded Tovu backend. The Tovu admin `userManagementKit` integration test and the unit suites cover the real bindings, but no visual check was made.
5. The Jini guard advisory line `injection advisory: N test-only cross-package imports` went **387 -> 391** (the four real-binding imports in `fetch-query-support.ts`: `@jini-ai/admin/react`, `@jini-ai/ui`, `@jini-ai/ui/admin-widgets`, `@jini-ai/ui/panel-kit`). It says "not failing" and is the only difference in `pnpm guard` output (exit 0); a count change, not a new finding. The sheet allows the real render to stay as a test; if you want the count flat, those tests move to Tovu admin (G-TESTS T4).
6. S5 import `rg` lists `+import { useAsyncAction } from '@jini-ai/ui/panel-kit'` in `__tests__/fetch-query-support.ts`: the test host binding supplying the real hook to the kit (same as Tovu's `jini-kits.ts`), not a component calling a hook.

## Gates (Jini; BASE for the diff blocks = `c481c01db`, the merge)
| command | result |
|---|---|
| `pnpm --filter @jini-ai/user-management build` / `pnpm typecheck` | exit 0 / no error lines |
| `cd packages/user-management && npx vitest run --maxWorkers=2` | 109 files, 1279 passed (every source-reading test of the package) |
| `pnpm guard` (diff vs base capture) | exit 0; only difference is item 5 above |
| `pnpm check:hooks` (diff vs base capture) | identical (32 pre-existing findings), no new key |
| `pnpm check:size`, `pnpm check:complexity` | both pass |
| `pnpm api:check` | exit 0 (prints two `added export ./secrets/testing#...` lines that are on the base too; no baseline of mine changed) |
| S3, S4, S6, S10, S11, S7 blocks | print nothing (S5: item 6; S9: only test helpers and the C9c kit functions, merge-diff) |
| S8 eslint 50/10/500 on the 11 changed source files | prints only `Users.tsx max-lines (723)` which was 725 at base: shrank, allowed |
| S13 | no removed `it(`/`test(`/`expect(` line in my commits (the one removed `expect(existsSync` in the base..HEAD diff is C9c's) |
`pnpm install --frozen-lockfile` and `--lockfile-only` leave `pnpm-lock.yaml` unchanged (workspace peers are not recorded).

## Gates (Tovu, linked to Jini `2282c1d20` tree)
| command | result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run check:size`, `check:complexity`, `check:architecture` | exit 1 on the base worktree and **byte-identical output after** (base red); `check:hooks` and `check:errors` exit 0, identical |
| `npx vitest run --maxWorkers=2` in `apps/admin`: `src/features/{users,members,auth,security}` | 49-50 files / 1232 tests green after the helper fix (the first run, before `894fae06b`, had 14 red; before `fb2031357` 48 red) |
| full `apps/admin` suite (`npx vitest run --maxWorkers=2`) | 895 of 896 files, 14789 tests passed, 2 skipped; the one failing file is the ENV chart-provider artifact under "Left" |

## Overlaps with parallel runs
Jini: `packages/user-management/**`, `scripts/injection-debt.json` (hand-deleted keys only), `scripts/size-debt.json` (one value lowered). Tovu: `apps/admin/src/__tests__/render-with-jini-kits.tsx` and two users tests (test files only; INDEX §4 lists `jini-kits.ts`/`main.tsx` for R1c/R2a, which I did not touch).

## Left / next step
- **R13b**: needs the sheet rewritten (see above); nothing was changed for it.
- **R3b**: Chrome look; owner decision on the `*KitNeeds`/`kitNeeds` readers (C9c) so the last `@jini-ai/ui-kit` root `needs` import and its debt key can go; optional: move the real-binding integration tests to Tovu admin to bring the guard advisory count back to 387.
- ENV: Tovu `src/integrations/chart-providers/__tests__/recharts-bundle-integer-ticks.unit.test.ts` fails to load `../Jini/packages/provider-plugins/plugins/charts-recharts/0.7.0/client/provider.js` (not built in this container): ENV/PRE-EXISTING, unrelated.
