PARTIAL ffebc0e370 55010ba59: K5-members-1 (12 of 13 files), K5-members-2, V-members-3, U-members-1, K5-newsletter-1/2/3, T-newsletter-1, A-adm-members-1, A-K2-members-1, RT-K1-adm-members-1/2, RT-K1-adm-newsletter-1–7, RT-K1-pub-members-1–6, RT-K1-pub-site-3, K5-member-login-1 (5 of 7 files), P9F slices member-auth-script / headless member-login / member-pages / member-access — blocked by in-flight or foundation files, unlanded prerequisites, or an owner decision (see "Steps skipped")

# ex6-members — Members, Newsletter lane (2026-11-23)

Unattended cloud run, Opus high, coordinator plus 2 subagents in one wave (the lane's ready inventory only supported two disjoint batches). **Every lane file that can move on these bases without touching another run's files has moved.** FILES-LEFT **2,401 → 2,398 (−3)**, or **2,290 → 2,287** without themes. Two sources moved to `@jini-ai/user-management` with their collaborators injected. One Tovu forwarding shell was deleted.

The remaining ~100 lane files are blocked. Nearly all of them hang off three facts:
1. `features/members/types.ts` and `ports.ts` are imported through the members barrel by six files that other runs own.
2. Every newsletter module imports `newsletter/types.ts`, which `ex5-fnd-inject` touches. `bugs-medium` touches the newsletter barrel and its services.
3. The admin Members hooks and test are touched by `ex5-fnd-kit` and `ex5-fnd-inject`.

Codex review is still needed before merge.

- **Branches** (plain `git push`, never force):
  - Tovu `codex/ex6-members-tovu`, from `origin/integ/merge-13-2026-11-22` `f7185f153` plus the provisional foundation.
  - Jini `codex/ex6-members-jini`, from `origin/integ/merge-14-2026-11-22` `4902a6a1a` plus the provisional foundation.
- **Not touched:** no tags, no publish, no `--no-verify`, no force-push, no codebase-memory tools. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.

## Provisional foundation (merged before branching)

| repo | branch | result |
|---|---|---|
| Jini | `codex/ex5-fnd-kit-jini` | merged clean |
| Jini | `codex/ex5-fnd-seams-jini` | merged clean (`c5aa0d9ec`) |
| Jini | `codex/ex5-fnd-inject-jini` | **SKIPPED.** Non-trivial: 23 files conflict with seams. They include add/add in 17 `core/src/contracts/site/*` files, `diagnostics/observability/index.ts` and the chat run-event files |
| Jini | `codex/ex5-fnd-routes-jini` | merged clean (`ffc969580`) |
| Jini | `codex/ex3-c0b-jini` | merged (`c25d9dd2f`). The only conflict was the generated `api-baseline/jini-ai__core.json`. The lost site-key rows were restored by `api:update` in `00941d0aa` |
| Tovu | `codex/ex2-tovu-halves` | fast-forward |
| Tovu | `codex/ex5-fnd-kit-tovu` | merged clean |
| Tovu | `codex/ex2-holds-tovu` | merged (`70393b3d5`). Conflicts and resolutions: <br>• `why-comments-debt.json`: union by id. <br>• Two admin tests: holds' `@/lib/admin-http/settings-api` path plus kit's `@jini-ai/admin/shell/lib/content-refresh-bus`. <br>• `lib/admin-http/settings-api.ts`: holds' location plus kit's Jini `settings-effective-reads` import. |
| Tovu | `codex/ex5-fnd-seams-tovu` | **SKIPPED.** Non-trivial: modify/delete on 9 `tool-metadata/*` files against halves, plus admin `App.hooks`/sidebar hooks |
| Tovu | `codex/ex5-fnd-inject-tovu` | **SKIPPED.** Non-trivial: 60+ conflicts, including every `tool-metadata/*` file, `members-controller.hooks.ts` and `i18n-common.ts` |
| Tovu | `codex/ex5-fnd-routes-tovu` | merged (`3468be610`). `why-comments-debt.json` union by id (721 unique ids) |

The files of all six Tovu foundation branches, merged or not, were treated as read-only for the rest of the run. So were the files of every in-flight branch named in the dispatch.

## Setup

- **Tools:** Node 22.23.5 (no `/opt/node24` in this container; engines warn only), pnpm 10.33.2, npm 11.
- **Jini:**
  - `pnpm install --frozen-lockfile`: 0.
  - `pnpm --no-bail -r build`: 0, with 0 `error TS`.
  - The clone was unshallowed so `check:cross-package --base 35c4961af` resolves.
- **Tovu:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 0.
  - `packages/contracts` tsc: 0. `packages/sdk` build: 0.
  - `origin/refactor/terra` and `origin/main` were fetched for the why-comments base.
- **Base for every comparison:** clean worktrees at the setup tips, with their own install, build and link:
  - Jini `c25d9dd2f` at `/home/user/base/Jini`.
  - Tovu `3468be610` at `/home/user/base/Tovu`, linked to the base Jini.
- **Not set up:** PostgreSQL. None of the affected tests needed it.

## Batch table

| batch | subagent | files moved (Tovu → Jini) | importers repointed | tests | status |
|---|---|---|---|---|---|
| **C** members auth mail (K5-members-1 slice) | sonnet-xhigh (11 calls) | `features/members/auth-mail.ts` → `user-management/src/members/auth-mail.ts` (`./members/auth-mail`, universal). `renderEmailForSend` is injected through the existing `required` args object as a structural `RenderEmailForSend` slice | `member-challenge-request.ts`: specifier, plus it passes `renderEmailForSend` from `@jini-ai/platform/mail/email-template` | **New in Jini** (tests first): `members/__tests__/auth-mail.test.ts`, 5 tests. **Tovu parity** (unchanged): write-service, write-service.guards, password-auth, magic-link-mail-off, purpose-scoped-mailer call sites and members-public-sign-in: **158/158** | DONE |
| **B** member OIDC facade (K5-member-login-1 slice) | opus-high (35 calls) | **Moved:** `features/member-login/oidc-login.ts` → `user-management/src/member-login/oidc-login.ts` (`./member-login/oidc-login`, node, isolation domain `server`). <br>**Injected through the existing `OidcLoginDeps`:** `beginAuthorizationCode`, `completeAuthorizationCode`, `createSealedAuthorizationState`, `createSealerStateCodec`, `validateOidcIdToken`, `formatAad`, and `appIdentity`. `appIdentity` is K3: the client display name and software id were Tovu literals. <br>**Types** come from `@jini-ai/core` `contracts/oauth` and `contracts/vault`. Three structural slices have no core owner: `CreateSealerStateCodec`, `ValidateOidcIdToken` and `FormatAad`. <br>**Deleted** the forwarding shell `features/member-login/public-path.ts` and the `MEMBER_OIDC_PATH` re-export in `oidc-deps.ts` | **13 files:** <br>• `member-login/index.ts`: 2 re-export lines deleted. <br>• `oidc-deps`, `oidc-start`, `oidc-callback`, `oidc-verify-email`: repointed to the Jini subpath and to `contracts/headless` for `MEMBER_OIDC_PATH`. <br>• `composition/modules/members.ts`: injects the operations. <br>• Fixtures: `oidcOperationsFixture`. <br>• Tests: `oidc-login.test`, `member-oidc-auth.test`, `h4-oidc.unit` and `member-oidc-callback.unit`, whose `mock.module` target moved to the Jini specifier | **New in Jini:** `member-login/__tests__/oidc-login.injection.test.ts`, 3 tests. <br>**`oidc-login.test.ts` stays in Tovu** as the consumer test. It needs real PKCE and JWT, plus Tovu's keyring, sealer and fake-clock, and `user-management` has no `oauth`/`platform` devDependency. <br>**Tovu:** 11 affected files, **232/238**. The 6 reds are identical at base (below) | DONE (slice) |

Coordinator follow-ups were done on the branch, not by subagents:
- typed `_options: Record<string, never>` on the exported functions (`public-args` contract test);
- `parts[1] ?? ""` in `validEmail`, where length is already 2 (Jini `noUncheckedIndexedAccess`), with the reason in a comment;
- the entry pins in `package-entries` and `user-management-rename.contract` gained the two new subpaths;
- the `server` isolation domain for the OIDC entry (guard SI-domain);
- verbatim why-comments (Tovu why-comments gate searches `../Jini`);
- changesets `.changeset/p9-ex6-members-auth-mail.md` and `p9-ex6-member-login-oidc.md`;
- `api:update`.

### Commits
- **Jini `codex/ex6-members-jini`:**
  - `075bf3995` C, `90465d2fb` B
  - `379caf9ff` contract and strict-type fixes
  - `00941d0aa` core baseline restore from the merge
  - `83adb4c96` user-management API baseline
  - `f9c42fec1` isolation domain
  - `55010ba59` verbatim why-comments
  - The report copy follows.
- **Tovu `codex/ex6-members-tovu`:**
  - `38a3048300` C, `8c887c2b2a` B
  - `ffebc0e370` Wiring docs
  - This report follows.

## Named mutations (red, then restored green)

| slice | mutation | Jini test | Tovu consumer (planted in the linked Jini `dist/`, restored by byte copy, `cmp` identical) |
|---|---|---|---|
| C | the template choice is negated (`purpose !== "signin"`) | `auth-mail.test.ts`: 2/5 red → 5/5 | members suites: **24 red** (password reset and login, D2 inbox challenges) → 158/158 |
| B | `softwareId: deps.appIdentity.clientDisplayName` (the injected identity is miswired) | `oidc-login.injection.test.ts`: 1/3 red → 3/3 | — (Tovu does not assert the software id) |
| B (wiring) | the callback path becomes `/callbacks` in `dist/member-login/oidc-login.js` | — | `oidc-login.test` + `member-oidc-auth.test`: **12 red** → green |

## Gates (tip vs base, same worktree method)

| gate | base | tip | verdict |
|---|---|---|---|
| Jini build (`pnpm -r build`) | 0 | 0 (user-management rebuilt) | = |
| Jini guard | 0 | 0 | = (after `f9c42fec1`; the SI-domain finding was fixed) |
| Jini typecheck / api:check / hooks | 0 / 0 / 0 | 0 / 0 / 0 | = |
| Jini size / complexity / cross-package (XP) | 1 / 1 / 1 | identical output | = (same base rows) |
| Jini why-comments | 359 lost (341 allow-listed) | 359 (341) | = |
| Jini error gate (WARN mode) | 26 entries | 27 | **+1 WARN:** `catch-reads-error` in `member-login/oidc-login.ts` (4). This is the same catch that Tovu carries as `error-gate-debt.json:743`; the code moved verbatim. No debt row added (owner rule 5) |
| `user-management` vitest | — | **118 files, 1361/1361** | green |
| Tovu typecheck / typecheck:tests / typecheck:scripts | 2 / 2 / 2 | identical output | = (base-red: `plugin-tier2/worker.ts` `Tier2ImportPolicy`, from the skipped inject/seams foundation pairing) |
| Tovu boundaries / hooks / errors / admin tsc | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | = (errors: "8 entries improved", was 7; the oidc row is now stale) |
| Tovu size / complexity | 1 / 1 | identical | = |
| Tovu why-comments | 88 open | **88** | = (2 rows briefly opened by reworded moved comments; fixed in `55010ba59`) |
| Tovu architecture | 1 regressed row (runtime-only propagation 3.30) | same row at 3.29; files 2245 → 2242; API surface 687 → 686 | no new regression |

**Base-red tests**, all identical at base `3468be610`:
- `mcp-ui-allowlist-completeness` "scan finds the known exchange openers";
- `providers.test` "bundled preset admits…";
- `ready-providers.test` ×4.

Admin vitest was not run: no admin file changed.

## Self-check against the 11-22 Codex findings
1. **No re-export or forwarding files.**
   - Tovu `member-login/index.ts` lost its oidc lines.
   - `public-path.ts` was itself a shell and is deleted.
   - Jini adds two leaf modules and no barrel.
2. **Hooks as required props:** not applicable (no UI moved).
3. **No server-framework types and no host log formatters in Jini.** The moved code has no Express and no console; the Express route halves stay in Tovu.
4. **`jini-*` classes:** not applicable (no markup). `member-auth-script.ts` was skipped for exactly this reason (below).
5. **No new entries in size-exceptions, complexity, error or why-comments debt lists, in either repo.**
6. **Shared wire types:** OAuth and vault types come from their core owners. Only three call-site slices are declared locally.
7. **Named mutations recorded** for both behaviour-changing slices (table above).

## Steps skipped and why

- **K5-members-1 (rest), K5-members-2, V-members-3 and U-members-1.**
  - **Barrel users owned by other runs.** Moving `types.ts`/`ports.ts`/`repo.memory.ts` requires deleting their barrel lines (no shells) and repointing every barrel user. These users belong to other runs:
    - `modules/site-search.ts` (`MemberContext`, ex4-settings);
    - `render-context/post-previews.ts` (ex5-fnd-routes);
    - `pages/static-tier.ts` and `site/media-rendition.ts` (`MemberAccessResolver`, ex5-fnd-inject);
    - `memory-deps/route-deps/members-media-newsletter-forms.ts` (`InMemory*` repos, ex4-deploy and ex4-integrations);
    - `trash/__tests__/member-adapter.test.ts` (ex4-deploy).
  - **Members files that other runs touch:**
    - `repo.ts` (bugs-high);
    - `tool-registrations.ts` and `tool-metadata/members.ts` (foundation seams, inject and halves);
    - `capability-card.ts`, whose user `site-guide.ts` is touched by fnd-seams;
    - `agent-tools.ts`, whose test user is touched by ex4-settings and fnd-inject.
  - `access-resolver.ts` is FOUNDATION-owned (P9F). `password-auth.ts` imports it.
  - The sheets also need `K5-platform-mail-2` (Integrations, in flight) and `K4-seam-5` (only partial in fnd-seams).
- **K5-newsletter-1/2/3 and T-newsletter-1.** Every module imports `newsletter/types.ts` (fnd-inject).
  - fnd-inject also touches `data-module-manifest.ts`, `tool-registrations.ts` and `delivery/tool-registrations.ts`.
  - bugs-medium touches `errors.ts`, `lists.ts`, `confirmation.ts`, `subscriptions.ts`, `campaign-write-service.ts` and `index.ts`.
  - `tool-metadata/newsletter.ts` is touched by halves, kit and inject.
- **RT-K1-adm-members-1/2 and RT-K1-pub-members-1–6.** The sheets depend on V-members-3, plus `K5-platform-mail-2`, `RT-K1-pub-visitor-analytics-1` and `K5-contracts-core-3`. No Jini spec can type its deps until the member types have a Jini owner.
- **RT-K1-adm-newsletter-1–7 and RT-K1-pub-site-3.** They depend on K5-newsletter-1/2. `site/newsletter-confirm.ts` is in bugs-medium.
- **A-adm-members-1 and A-K2-members-1.**
  - `members-api.types.ts` is imported by `use-members.hooks.unit.test.ts` (fnd-kit).
  - `members-i18n.ts` is imported by `members-controller.hooks.ts` (fnd-kit and fnd-inject).
  - `members-dependencies.hooks.ts` is fnd-inject's.
  - Note: Tovu's `MembersPanel.tsx` already renders Jini's `Members` (`@jini-ai/user-management/react`) and passes product copy, `ServerLabel` and the hook as host wiring. What is left in Tovu is that wiring plus the HTTP transport (`members-api.ts`), which stays like `comments-api.ts` did in ex5-small.
- **K5-member-login-1 (rest).**
  - `credentials.ts` and `ready-providers.ts` need `K5-custom-credentials-3` (Integrations, not landed).
  - `providers.ts` needs `K5-agent-plugins-4/5` (Add-ons, not landed) and pins the `tovu/<plugin>` namespace, which is product policy.
  - `link-service.ts` needs the members barrel and `platform/db`, so it is blocked like V-members-3.
- **P9F slices.**
  - `public-http/http/site/member-auth-script.ts` needs an **owner decision.** It writes `data-tovu-member-auth` markers that 5 Tovu test assertions pin. Its `.member-auth` classes are the theme styling contract. Moving it means either renaming them to `jini-*` (a DOM/theme break) or injecting marker and class names.
  - `contracts/headless/member-login.ts`: its barrel `contracts/headless/index.ts` is owned by a foundation branch.
  - `routes/site/member-pages.ts` and `render-context/member-access.ts` need the FOUNDATION `access-resolver` and K1 conversion after V-members-3.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122` `ad8362919`)

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (`theme` 86 + `adm-themes` 25) |
|---|---|---|---|---|
| base `3468be610` (merge-13 + provisional foundation) | 2,401 | 0 | **2,401** | **2,290** |
| tip `ffebc0e370` | 2,398 | 0 | **2,398** | **2,287** |

−3 = `members/auth-mail.ts`, `member-login/oidc-login.ts` and `member-login/public-path.ts`. By scanner area: members 24 → 23, member-login 7 → 5, newsletter 25 → 25, adm-members 8 → 8.

## Docs (Wiring)
- **Jini (new):**
  - `packages/user-management/src/members/README.md` covers `renderEmailForSend` in and `renderMemberAuthMail` out.
  - `packages/user-management/src/member-login/README.md` covers the `OidcLoginDeps` injected operations, `appIdentity` and the never-import list. It links `docs/decisions/DR-005-portable-package-boundaries.md`.
- **Tovu (updated):**
  - `features/member-login/CONTRACTS.md` has a new `## Wiring` section and the corrected `OidcLoginDeps` line.
  - `features/members/INFO.md` has a new `## Wiring` section.
  - Both link the DR-005 ADR.

## For the reviewer (Codex)
1. **Non-verbatim edits in moved code:**
   - the injection fields;
   - `appIdentity` (K3);
   - `deps.keyring.activeKey({})`, because core's `KeyringPort.activeKey` takes an object, which matches what `@jini-ai/oauth`'s codec already passes;
   - `continuationAad` now receives `deps` in its existing args object;
   - typed `_options`;
   - the `?? ""` on an already length-checked split.
2. **`appIdentity` literals live in two places:** the composition (`modules/members.ts`) and the test fixture. They carry the same product strings the Jini file used to hard-code.
3. **Stale host rows, left alone** because the files are on other runs' touch lists or are security configuration:
   - `development/scripts/error-gate-debt.json:743`;
   - `development/scripts/check-architecture.baseline.json:138`, the old `oidc-login.ts → webhooks` edge;
   - the dead `features/member-login/oidc-login.ts` entry in `assistant/__tests__/mcp-ui-allowlist-completeness.test.ts` `NON_EXCHANGE_OPEN_CALLS`. It is harmless, and the test stays at its base-red count.
4. **Moving `oidc-login.test.ts` into Jini** would need `@jini-ai/oauth` and `@jini-ai/platform` as `user-management` devDependencies, plus Jini in-memory keyring, sealer and clock fixtures. That is a lockfile change, so it was not done here.
