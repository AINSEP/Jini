PARTIAL 6581b14d41 85dfa18d7: X-identity-1 (api-key-types, api-key-secret, owner-reset-env, user-purge-types, username-change-ports, delete-user-service, repo.memory), X-identity-2 (api-key-service; site-key-permission → Security), A-K2-roles-1/2 (14 files), A-K2-users-1 (7 files), A-K2-auth-1 (Login, OwnerRecoverySignIn, auth-api, use-login, login-dependencies, index), A-K2-authentication-1 (all 4), owner MFA/passkey/recovery clients (A-K2-shell-lib-5 slice), K5-identity-1/2, RT-K1-adm-users-1–9, RT-K1-adm-api-keys-1/2, RT-K1-adm-owner-{mfa-deps,mfa-routes,passkey-routes,recovery-routes}-1, dev-auth.ts K1 split

# ex6 Users, Roles, Authentication lane (2026-11-23): Tovu `codex/ex6-users-tovu`, Jini `codex/ex6-users-jini`

This was an unattended cloud run that started at 19:33 UTC. Code tips: Tovu `6581b14d41` and Jini `85dfa18d7`. Both branches were pushed with a plain `git push` after `git pull --rebase`. The run used no force-push, no `--no-verify`, no publishing and no tags, and did not touch `main`, `integ/*`, `plan/*` or `release/*`.

**Result.**
- **Moves:** 13 Tovu source files left the lane. FILES-LEFT went from **2,385 to 2,372** (−13). Seven tests moved with them, plus one duplicate Tovu suite was deleted (an identical Jini copy already existed). One shared wire type (`AdminIdentityUser`) now points at its existing `@jini-ai/core` owner.
- **Ready work is used up.** Everything else in the lane is held by one of five things:
  - an unlanded Foundation prerequisite (`lib/admin-http/request.ts` = A-K2-shell-lib-4, K4-seam-5/14/15/19)
  - Jini's 500-line file limit (the roles and users dictionaries)
  - in-flight branches that own importers
  - product literals that need an owner BREAKS decision
  - STOP rules 3, 6 and 8
- **No wave 2.** I ran no second wave because each remaining slice needs a new port, or more than one injected prop at a call site, and either one is a STOP.
- **Gates:** all equal to base. There are no new red tests.

## Setup
- **Bases and provisional foundation** (merged before branching):
  - **Jini:** `origin/integ/merge-14-2026-11-22` `4902a6a1a`.
    - Merged: `ex5-fnd-kit-jini` `c03c3cd1`, `ex5-fnd-seams-jini` `80523731`, `ex5-fnd-routes-jini` `cbd14e0c`, `ex3-c0b-jini` `a34ea219`.
    - The `ex3-c0b` merge had one conflict, the generated `api-baseline/jini-ai__core.json`. I resolved it as ours and regenerated it with `api:update` at the end, which restored c0b's `./contracts/site/site-key` row.
    - **Skipped `ex5-fnd-inject-jini`** (non-trivial: 23 conflicted files, including core contracts `user-management-react.ts`, `assistant-*`, `chat-core`, `cms-forms`).
    - Merged base: `948e3ff4`.
  - **Tovu:** `origin/integ/merge-13-2026-11-22` `f7185f153`.
    - Merged, in order: `ex5-fnd-seams-tovu` `63b09af26`, `ex2-tovu-halves` `d6590fc72`, `ex2-holds-tovu` `8eb8ea568`, `ex5-fnd-kit-tovu` `541537de6`, `ex5-fnd-routes-tovu` `ab3beb411`. Seams went first because seams→kit is the order that merges.
    - **Conflict resolutions:**
      - **halves vs seams:** halves modified 9 `contracts/core/tool-metadata/*.ts` files that seams deleted (moved to Jini). I kept the deletion.
      - **kit vs seams:** 7 one-hunk import conflicts in `App.hooks.ts`, the `use-pages`/`use-posts` tests, `use-sites-sidebar-nav(.tw2-pin.test)`, `durable-run-subscription.unit.test.ts` and `lib/admin-http/settings-api.ts`. I took seams' locations for `settings-api` and nav types, and kit's `@jini-ai/admin/shell/lib/*` imports and injected collaborators.
      - **`development/why-comments-debt.json`:** union of rows, 4 times.
    - **Skipped `ex5-fnd-inject-tovu`** (non-trivial: 47 conflicts even on the bare base, 63 on top of the others).
    - Merged base: `13d792cf4`.
- **Tools:** Node 24.22.3 (`/opt/node24`), pnpm 10.33.2.
- **Jini:** `pnpm install --frozen-lockfile` returned 0. `pnpm --no-bail -r build` returned 0, with 0 `error TS`.
- **Tovu:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 0. This links **this run's Jini branch**.
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
- **PostgreSQL:** not provisioned. The PG-backed tests are BASE-RED for that reason.
- **Base gates:** these ran on clean `git worktree`s of the two merged bases:
  - Tovu shares the main tree's `node_modules`.
  - Jini has its own offline install and build.
  - The drift gates use `*_BASE_REF` = the merged base (Jini `948e3ff4`, Tovu `13d792cf4`), so they measure only this lane.

## Batches

| batch | subagent | files moved | importers | tests | status |
|---|---|---|---|---|---|
| **A** X-identity-1/2 ready slice | sonnet-xhigh | **Tovu `features/identity/` → Jini `user-management/src/identity/`:** `boot-session-token`, `builtin-role-grants`, `permission-grants`, `role-manage-permission`, `user-manage-permission`.<br>Tests moved: `boot-session-token.test` (9) and `builtin-role-grants.test` (12). `node:test` became vitest; `t.after` became `onTestFinished`.<br>5 exports entries (`universal`, isolation domain `server`). New `identity/README.md` with a Wiring section. | 29 lines in 28 Tovu files go straight to `@jini-ai/user-management/identity/*`:<br>• `serve-listen`, `dev-auth:32`, `wiring.ts:13,14` and `app-permission-grants:1,3,4`<br>• the `permission-grants` users: fs-files, mail-status, pages, publish-content, settings, `site-dir`, and `site-key-permission:1` (import line only)<br>• the tests<br>5 stale `check-architecture.baseline.json` edges removed (shrink only). | **Jini user-management:** 1,374/1,374 after the follow-up `85dfa18d7`.<br>The first run had 2 reds caused by this batch:<br>• `public-args.test`: the boot-token exports had no named-args pad. Fixed by adding typed `_optional`/`_options: Record<string, never> = {}` pads, so callers are unchanged.<br>• `user-management-rename.contract.test`: the entry pin needed the 5 new subpaths added. | DONE (slice) |
| **B** A-adm-roles-1 + roles tab model | opus-high | **Jini `admin/src/roles/`:** `api/roles-api.types.ts` (verbatim) and `Roles.hooks.tsx`. In `Roles.hooks.tsx`, `TabBarTab` now comes from the admin kit (same shape).<br>Test moved: `Roles.hooks.unit.test.tsx`, plus a `// @vitest-environment jsdom` line.<br>New characterization test `Roles.hooks.tabs.unit.test.tsx` (3). `roles/README.md` with a Wiring section. | 13 type importers in `features/roles/**`, plus `Roles.tsx:4` → `@jini-ai/admin/roles/*`.<br>`e2e/journeys/admin-visual.pins.journey.ts:117` uses the dist-path form, the same as the seo line. | Jini roles 4/4. | DONE (slice) |
| **C** auth / boot-token | opus-high | **Jini `admin/src/screens/auth/`:** `api/auth-api.types.ts`, `hooks/login-port.hooks.ts`, `Login.hooks.ts`, and `auth-i18n.ts` (K4i: host `COMMON_I18N` → Jini `ADMIN_COMMON_I18N`, which differ only by one product key login never reads).<br>**Jini `admin/src/shell/lib/`:** `boot-token-fragment.ts`.<br>Tests moved: `auth-i18n.unit.test` (6) and `boot-token-fragment.unit.test` (6). `screens/auth/README.md` with a Wiring section. | `App.hooks:26,30,217`, `App.session:4,7`, `App.tsx:10`, `site-section-availability.hooks:4`, `app-sites-section-visibility.unit.test:18`, `Login.tsx:1,7`, `auth-api.ts:2`, `use-login.hooks:6,8`, `login-dependencies.hooks:2`, and `use-login.hooks.unit.test:7`. | Jini 12/12. | DONE (slice) |
| **D** Users panel | opus-high | **Deleted `features/users/api/users-api.types.ts`** in favour of the existing core owner `@jini-ai/core/contracts/site/user-management-react` (rule 6). The types are structurally identical, and core's `canRename` doc carries the same why.<br>**Deleted the duplicate Tovu `use-reset-password-fields.unit.test.tsx`**. Its 5 tests already exist in Jini `user-management/src/react/users/__tests__/`. Its why-comments were added to the Jini copy.<br>**Rule-1 fix:** `UsersPanel.tsx` no longer re-exports `UserManagePanel` and `UserManageController`, and the 2 tests import them from `@jini-ai/user-management/react`. | trash `{use-trash.unit.test, trash-dependencies, trash-port}`, users `{account-protections, rules, use-users, users-agent-drive, Users}.unit.test`, `users-api.ts:3`, and `lib/__tests__/api-users.{test-d,unit.test}`. | Covered by the admin run below. | DONE (slice) |
| coordinator | — | Admin package.json: 6 exports, `jini.entries` and isolation entries, and `typesVersions` `roles/*` and `screens/*`.<br>API baselines for admin (+6), user-management (+5) and core (restored c0b row). Changeset `.changeset/ex6-users-identity-admin-leaves.md`.<br>6 Tovu why-comments allow-list rows, all "moved to Jini" with the Jini path, why kept. | | | |

**Test runs:**
- **Tovu admin vitest:** 114 files (changed tests plus every test importing a changed file or the new subpaths), **4,313 / 4,313 pass**.
- **Tovu node:** 200 files (changed tests plus importers of changed website files), each run alone, 3 in parallel.
  - 189 pass. 11 fail, and **all 11 are BASE-RED**, re-run at `13d792cf4` with the same pass/fail counts.
  - The 5 PG files fail for lack of PostgreSQL: `*.postgres`, `passkeys.real-postgres`, and `init-site-branches.integration`.
  - The other 6 are existing reds: `wiring-identity` (1 failure, "a new owner or queue builder appeared"), `admin-trash-routes` (4), `pages-update-html-auth` (1, disk-full fixture), `owner-passkey-http.integration`, and `assistant-byok.inputs-pin`.
- **Jini:** full admin suite **3,499 / 3,499** and full user-management suite **1,374 / 1,374**.

### Named mutations (planted in the Jini copy, red, then restored by byte copy, `cmp` identical, green)
| slice | mutation | red | restored |
|---|---|---|---|
| A `boot-session-token.ts` | `if (armed === null) return false;` → `if (armed !== null)` | 5 of 9 red ("an unarmed store refuses EVERYTHING", …) | 9/9 |
| A pads | removing the pad, i.e. the pre-fix state | `public-args.test` red on `createBootSessionTokenStore` / `mintBootSessionToken` | 1,374/1,374 |
| B `Roles.hooks.tsx` `resolveRolesTabId` | `defaultId: "roles"` → `"policies"` | `Roles.hooks.tabs` 1 failed / 3 passed | 4/4 |
| C `auth-i18n.ts` | `{ commonDictionary: ADMIN_COMMON_I18N }` → `{}` | 1 failed / 5 passed ("Cancel" no longer becomes "Cancelar") | 6/6 |
| C `boot-token-fragment.ts` | `if (!token) return null;` → `if (token)` | 6/6 red (run by the subagent) | 6/6 |
| D | type-only repoint, no behaviour; `api-users.test-d.ts` typechecks against the core type | — | — |

The sheets' own mutations (`api-key-service` negate-if, `use-login`, `Authentication`) target files that did not move.

## Gates (tip vs base, same commands)
| gate | base | tip |
|---|---|---|
| Jini guard / api:check / hooks / why-comments / typecheck | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 (`api:check` is 0 after `api:update`) |
| Jini size / complexity | 1 / 1 | 1 / 1. The violation lines are identical. They are inherited from the foundation merges, e.g. `launch.ts createAgentExecutor`, `ErrorNotice`, `reporter.ts refusalError`, `json-ipc` stale entries. |
| Tovu admin-tsc | 0 | 0 |
| Tovu typecheck | 2 errors | 2 errors, the same lines |
| Tovu typecheck:scripts | 3 errors | 3 errors, the same lines |
| Tovu typecheck:tests | 2 errors | 2 errors, the same lines |
| Tovu size / complexity / architecture | red / red / red | Size and complexity output is identical. Architecture's hard red is the same runtime-only propagation regression at base and tip (3.06 → 3.28 against its baseline). Cross-feature edges go 307 → 302, files 2,228 → 2,223, and module API surface 684 → 680. All-import propagation moves 12.14% → 12.17% (ratio effect of 5 fewer files; still "improved" vs its baseline). |
| Tovu hooks / errors / boundaries | 0 / 0 / 0 | 0 / 0 / 0 |
| Tovu why-comments (`13d792cf4..HEAD`) | 0 | 0, with 6 allow-listed moved blocks |

## Self-check against the 11-22 Codex failures
1. **Re-export or forwarding files:** none were added. One was removed (`UsersPanel.tsx`'s re-export of `UserManagePanel`/`UserManageController`). No Tovu barrel forwards to Jini.
2. **Hooks as props:** no Jini component imports or defaults a custom hook. The moved `.hooks` files are a pure tab model, a port interface and a plain mapping function, and the Tovu `Roles`/`Login`/`use-login` code consumes them. `check:hooks` is 0 in both repos.
3. **Express types or console formatters in Jini:** none.
4. **`jini-*` classes:** no moved file renders a class name (`Roles.hooks.tsx` renders unclassed SVG).
5. **New size-exception or debt entries:** none. The roles and users dictionaries stay in Tovu rather than add a size exception. The only debt-list edits are the removal of 5 architecture-baseline edges and the standard why-comments "moved to Jini" allow rows.
6. **Shared wire type:** `AdminIdentityUser` uses its neutral core owner; I did not add a Users-owned copy.
7. **Named mutations:** recorded above.

## Steps skipped and why
| step / files | why |
|---|---|
| **X-identity-1:** `api-key-types` | Importer `server/routes/types.ts:36` is on in-flight branch files (avoid list). |
| X-identity-1: `repo.memory` | Imports `api-key-types`. |
| X-identity-1: `owner-reset-env` (+ test) | Importer `site-deps/identity-settings.ts` is on the avoid list. |
| X-identity-1: `user-purge-types` | Its importer `delete-user-service.ts` is on the avoid list (`bugs-high-tovu`). |
| X-identity-1: `username-change-ports` | Importer `identity/tool-registrations.ts` is on the avoid list. |
| X-identity-1: `delete-user-service` | Avoid list (`bugs-high-tovu`). |
| X-identity-1: `api-key-secret` (+2 tests) | Runtime product literals `"tovu_ak_"` (`:45`) and `/^tovu_ak_[0-9a-f]{12}$/` (`:57`). Renaming them breaks issued keys. **Owner BREAKS decision.** |
| **X-identity-2:** `api-key-service` (+ test) | Imports `api-key-secret`/`api-key-types`. |
| X-identity-2: `site-key-permission` | Belongs to the Security lane (P9F-check), plus the `TOVU_SITE_KEY` literal. |
| **A-K2-roles-1/2** (14 files) | `rules.ts` uses host `ApiError`/`describeApiError` from `lib/admin-http/request` (**A-K2-shell-lib-4 not landed**). `roles-i18n.ts` is 1,524 lines, over Jini's 500-line limit, and an exception is banned.<br>Everything else (controllers, row/permission actions, sections, dialogs, `Roles.tsx`, `index.ts`) depends on one of those two. The hooks also need `use-admin-locale` and an `admin → user-management` edge (K4-seam-6, which `ex5-fnd-inject` is doing).<br>Injecting the error describer, menu builders and dictionary part-builders across about 8 files is a new port and multi-prop injection (STOP 8 / "no new port"). |
| **A-K2-users-1** (7 files) | `users-i18n.ts` is 1,585 lines (size limit). `users-api.ts` is the shared Users API and needs shell-lib-4. `UsersPanel.tsx`/`UsersPanel.hooks.ts`/`users-controller.hooks.ts` are already the thin host binding; they need `useAdminLocale`, `WORKSPACE_ID`, the host port and `ServerLabel`, and the `admin → user-management` edge waits on K4-seam-6. `users-dependencies.hooks.ts` binds the roles and auth API clients. |
| **A-K2-auth-1:** `auth-api`, `use-login`, `login-dependencies` | `lib/admin-http/request` (shell-lib-4). |
| A-K2-auth-1: `Login.tsx` / `index.ts` | Hard-coded product `<h1>` (STOP 3, or K3 args); about 6 new injected props (STOP 8); and a kit gap: `ErrorNotice disclosure="id-only"` is missing from the kit's `ErrorNoticeProps`. |
| A-K2-auth-1: `OwnerRecoverySignIn(.hooks)` | Needs the owner-recovery client (stays), Tovu `SecretInput` (not in Jini), and the same `disclosure` kit gap. |
| **A-K2-authentication-1** (4 files) | Imports `provider-schemas` (host-policy hold); product copy (43 "Tovu" hits in the dictionary, STOP 3); kit gap `SettingsDialogShellProps.labels.kicker`; theme hook (host-injected; themes stay). |
| **A-K2-shell-lib-5** owner clients (`owner-mfa-api`, `owner-passkey-api`, `owner-recovery-api`, `local-owner-signin`) | Module-level singletons on `lib/admin-http/request` with no args object to inject through. `owner-recovery-api` also needs `TOVU_ERROR_REDACTION_OPTIONS`. |
| **K5-identity-1/2** (repos, `user-purge`, wiring, `tool-registrations`, `default-credential-exposure`) | K4-seam-15's `outboxEventValues` is not in core (no `contracts/site/db-events`). The Kysely-typed repos need K4db structural slices and `@jini-ai/user-management` has no kysely dependency. `permission-list-tool` needs K4-seam-19 (on unmerged `ex5-fnd-inject`). `tool-registrations` is on the avoid list. |
| **RT-K1-adm-users-1–9, RT-K1-adm-api-keys-1/2, owner-mfa/passkey/recovery route sheets** | K4-seam-5 (user-management record and repo types into core) and K4-seam-14 (`AuthServiceDeps`) are not landed. These are multi-target Foundation seams, and `ex5-fnd-inject` owns the neighbouring user-management seam. K5-identity-2 is also not landed. `routes/users/{enable,reset-password}.ts` and the `account-protections` test are on the avoid list. |
| **dev-auth.ts K1 split** (login/MFA/logout/session/password-status; SEC OD-1 `/auth/me`) | In flight on `origin/codex/ex4-security-jini` (`packages/user-management/src/admin-http/auth/{password-login,mfa-login,logout,boot-session,local-boot-session,current-user,password-status}.ts` + tests). I did not duplicate it. |

## FILES-LEFT (`plans/P9-data/tools/{scan,plan}.mjs` from `origin/plan/whats-left-1122`)
| tree | moving | shells | FILES-LEFT | excl. theme areas | users areas (adm-roles / adm-users / identity) |
|---|---|---|---|---|---|
| base `13d792cf4` (merged foundation) | 2,385 | 0 | **2,385** | **2,274** | 55 (19 / 8 / 28) |
| tip `6581b14d4` | 2,372 | 0 | **2,372** | **2,261** | 47 (17 / 7 / 23) |

The −13:
- 5 identity: `boot-session-token`, `builtin-role-grants`, `permission-grants`, `role-manage-permission`, `user-manage-permission`
- 2 roles: `roles-api.types`, `Roles.hooks`
- 1 users: `users-api.types`
- 5 auth/shell (adm-other area): `auth-api.types`, `login-port.hooks`, `Login.hooks`, `auth-i18n`, `boot-token-fragment`

## Merge-order / conflict notes for combine-15
- **Jini append points:**
  - `packages/admin/package.json` (exports, `jini.entries`, `jini.isolation.entries`, `typesVersions`)
  - `packages/user-management/package.json`, which is also edited by `ex4-security-jini`
  - `packages/user-management/src/__tests__/user-management-rename.contract.test.ts`, also edited by `ex4-security-jini`; its entry map gains 5 identity rows
  - the admin, user-management and core API baselines (regenerate)
- **Tovu files also touched by foundation branches** (import-line edits only):
  - `App.hooks.ts`, `App.session.ts`, `App.tsx`, `site-section-availability.hooks.ts`, `features/auth/auth-i18n.ts` (deleted), `features/roles/Roles.hooks.tsx` (deleted), `features/users/UsersPanel.tsx`, `features/trash/__tests__/use-trash.unit.test.tsx`, and `server/runtime/composition/site-dir.ts`, which kit/seams edit
  - `features/roles/hooks/use-roles.hooks.ts` and `server/inbound/admin-http/dev-auth.ts`, which the **unmerged** `ex5-fnd-inject` edits on adjacent import lines
- `development/scripts/check-architecture.baseline.json` (5 rows removed) is also edited on an in-flight branch.
- **Duplicate entry pin:** `ex4-security-jini` adds `./admin-http/auth/*` entries to the same user-management contract pin.

## For the reviewer / owner
1. **Product literal `tovu_ak_` in `api-key-secret.ts`** holds `api-key-service` and the whole api-keys route family. Choose a BREAKS rename to a neutral prefix with a host-injected prefix, or keep the module in Tovu.
2. **Jini's 500-line file limit vs the roles and users dictionaries** (1,524 and 1,585 lines). Choose per-locale splitting or an owner-approved exception. This holds both screens.
3. **A-K2-shell-lib-4** (`lib/admin-http/request.ts`: `ApiError`, `describeApiError`, `authenticatedAdminRequest`) is the single biggest unlock for Users, Roles and Auth. It needs to land in Foundation first.
4. **Kit gaps:** `ErrorNoticeProps.disclosure` (`"id-only"`) and `SettingsDialogShellProps.labels.kicker`.
5. **`boot-session-token` entry kind:** it imports `node:crypto` but is listed `universal`, because the existing `package-entries.test.ts` forces every non-react entry except `./server` to `universal`. The guard passes. Reclassifying it as `node` needs that test changed.
