PARTIAL 0d7f78fa4 641f6d38: SEC-IDX (plan branch, not pushable here), SEC-6, SEC-7, SEC-8, SEC-9, SEC-10, SEC-11, SEC-12, SEC-13, SEC-14, U-AUTH-T1, SEC-T0, SEC-T1a, SEC-T1b, SEC-T1c

# ex4-security (2026-11-22): Jini Security pieces and the owner-auth split

Unattended cloud run, Opus high. No subagents, no codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.

## Result in one paragraph
Every step that had no open owner decision is built, tested and pushed on Jini `codex/ex4-security-jini`: **SEC-1, SEC-2, SEC-3, SEC-5, U-AUTH-1, U-AUTH-2 and U-AUTH-3** (SEC-4 was skipped as instructed; its branch is merged in). Each step wrote its tests first, has a named mutation that went red, and has a changeset and an `api:update` delta. The rest is **blocked by open owner decisions, not by work**:
- **OD-3** is unanswered, which blocks SEC-6 (a), SEC-8 (b), SEC-12 (c) and SEC-14 (d).
- SEC-7, SEC-9, SEC-10, SEC-11 and SEC-13 wait on those steps through the lane order in §5.
- SEC-10 and SEC-11 also need the missing kit chip slot (A-K2-0a.chip).
- **OD-2** is unanswered, so U-AUTH-T1 (the Tovu cutover onto K1) is held. Only OD-1 is approved.
- SEC-T0 and SEC-T1a/b/c need all of the above, so **SEC-T1 was not attempted**, per the dispatch rule.

The Tovu branch therefore carries only this report. No Tovu source file changed, and FILES-LEFT is unchanged.

## Branches and SHAs
- **Jini** `codex/ex4-security-jini` (plain `git push` after every step). Base: `origin/integ/merge-14-2026-11-22` `4902a6a1a` plus `origin/codex/sec4-jini` `22b390df` (fast-forward; not pushed separately).

  | SHA | step |
  |---|---|
  | `7ba78110` | SEC-1 |
  | `dbab441f` | SEC-2 |
  | `6f5671e0` | SEC-3 |
  | `b66446ef` | SEC-5 |
  | `c1974c14` | U-AUTH-1 |
  | `a912790c` | U-AUTH-2 |
  | `5d7d963c` | U-AUTH-3 |
  | `641f6d38` | SEC-5 complexity fix (two helpers split) |
  | (next commit) | this report copied to `cloud-results/ex4-security.md` |

- **Tovu** `codex/ex4-security-tovu`. Base `origin/integ/merge-13-2026-11-22` `0d7f78fa4`, unchanged except this report commit. The first line names `0d7f78fa4` because no Tovu content commit exists.

## Setup
- Node 24.22.3 (`/opt/node24`), pnpm 10.33.2.
- Jini: `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (admin and user-management rebuilt after each step).
- Tovu: `npm ci --ignore-scripts` in root, `apps/admin` and `apps/site-chat` 0/0/0. Desktop was not installed, because no desktop file or desktop-consumed Jini module changed.
- Linked Jini with `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; `packages/contracts` tsc 0; `packages/sdk` build 0.
- Jini was unshallowed so the XP gate could reach its `35c4961af` base.

## Steps

### SEC-1: module shape, host translator, header, TabBar, root-key tab options. DONE `7ba78110`
- **Corrections applied:**
  - Check 4: caller search included relative imports. `security.test.tsx` and `security-editor.test.tsx` called `security({})`; both are repointed to `security({ ui: reactModuleUi })`, import line plus call only.
  - The host translator rides a stable Provider prop (the Comments pattern), so a locale swap re-renders without remounting the tab.
  - The kit `TabBar` replaces `Tabs`.
- **What changed:**
  - `security({ ui }, { t, rootKeyScopeNotice, rootKeyTab, tabIcons })` uses the injected `ui.bindReact`. The direct `bindReact` import is gone.
  - Kicker, h1 and description header.
  - `TabBar` with handles `security-tab-access-tokens` / `security-tab-site-key`, container `security-tab-bar`, and handle labels through `t`.
  - Host `tabIcons`.
  - `rootKeyTab` options are merged into the root-key tab `params`.
  - `englishSecurity` and `SecurityTranslator` added.
- **Files:** `security/{index.ts,messages.en.ts}`, `security/react/{index.ts,hooks/SecurityPage.hooks.ts,hooks/SecurityPorts.hooks.ts,pages/SecurityPage.tsx}`, 2 test repoints, new `react/__tests__/security-module.test.tsx`.
- **API delta:**
  - `./security` + `englishSecurity`, `SecurityTranslator`.
  - `./security/react`: `security` (breaking signature), + `SecurityOptions`, `SecurityRootKeyTabOptions`, `SecurityTranslator`.
  - No consumer outside the package (`git grep -F "@jini-ai/admin/security"` in Tovu: none).
- **Tests (8):**
  - `security.read`-only gives `[access-tokens]`, and a `root-key` deep link falls back;
  - with the grant, both tabs;
  - denied gives a notice and no TabBar;
  - header copy;
  - handles, handle labels, icons and container handle;
  - `rootKeyTab` reaches the params;
  - a translator swap relabels with the tab mounted once;
  - `onTabChange` fires once.
- **Mutation:** dropped the root-key tab's `permissions` → the `security.read`-only case went red (1/8). Restored → green.

### SEC-2: owner-controls slot. DONE `dbab441f`
- **What changed:** Provider `ownerControls?: ReactNode`, rendered once before the `TabBar` and only when the page is visible.
- **Tests (4):**
  - once, before the TabBar;
  - absent when denied;
  - nothing extra when not supplied;
  - survives tab changes (effect counter 1).
- **Mutation:** stopped rendering `vm.ownerControls` → 2/4 red.

### SEC-3: owner recovery card into `@jini-ai/user-management`. DONE `6f5671e0`
- **Corrections applied (check 5):**
  - **Status-load failure vs submit failures.** The status-load failure test asserts that **no** `secrets` reach the redactor. The issue and reset failure tests assert the **exact** submitted values (`['owner-password','123456']`, `['new-one']`) and that neither is rendered.
  - **Reset button.** It keeps `busy || !password` (pinned). A mismatch shows the message and makes no `reset` call. The plan's proposed "both non-empty" disablement was **not** applied, because it is not approved.
  - **Injected hooks.** The wrappers' inner calls are injected as hook props: `useJiniRecoveryKitHook` and `useOwnerPasswordResetHook`.
  - **Class edits, named.** `card` → `jini-card`, `btn-primary` → `jini-btn-primary`, `btn-secondary` → `jini-btn-secondary`, `notice` → `jini-notice`. The UM kit has no Button, so the raw `<button>`s remain.
  - **Translation contract.** Literal message, action and step strings stay in the moved code and pass to the host formatter. The mismatch and reset copy go through `t`, as before.
  - **Download mutation.** It is the no-op `dismiss` named below, which still runs the download and fails the cleanup test.
- **Moves:** `T:RecoveryCodesCard.tsx` → `UM:react/auth/RecoveryCodesCard.tsx`, `T:RecoveryCodesCard.hooks.ts` → `UM:react/auth/RecoveryCodesCard.hooks.ts`. `OwnerRecoveryStatus` and `OwnerRecoveryPort` move as types.
- **Renames:** `useRecoveryKit` → `useOwnerRecoveryKit`, `createRecoveryKitDownload` → `createOwnerRecoveryKitDownload`. These need logging in `P9-BREAKS.md` on the plan branch, which this run may not push.
- **Injection:**
  - `port` is required.
  - `describeFailure: OwnerRecoveryFailureFormatter` has the exact `ownerRecoveryFailure` signature, including `secrets`.
  - `FailureNotice` replaces `ErrorNotice`.
  - `filename` replaces the product filename.
  - The DOM `saveTextFile` default is kept verbatim (`saveTextFileViaDom`).
  - `createDownloadHook` is a prop.
  - Every `_options = {}` pad is kept, as the hook-prop object.
- **Size:** each moved function is under 50 lines; complexity gate clean.
- **Tests (13, port of the host's 104-line test plus the plan's new cases):** autocomplete and agent-private on all four secret inputs; staff → nothing; unavailable → nothing; status-load failure; issue gives exactly ten codes in a private element; issue failure redaction; download (injected filename and joined text, object URL revoked, codes cleared); dismiss; no reset form without `desktopOwnerReset`; reset gating and mismatch; reset success; reset failure redaction; translation without re-reading status.
  - **Not ported:** the host's "Show <label>" reveal assertion. The reveal toggle belongs to the kit's `SecretInput`, and the UM fake kit has no reveal button.
- **Host type repoints** (`lib/owner-recovery-api.ts`, `features/auth/OwnerRecoverySignIn*`) belong to SEC-T1c. Not done.
- **Mutation:** `dismiss: () => {}` inside `createOwnerRecoveryKitDownload` → the download-clears-codes case went red (1/13).

### SEC-4: SKIPPED
Instructed. Built on `codex/sec4-jini`, merged in as the base.

### SEC-5: root-key status presentation, generate visibility, typed refusals. DONE `b66446ef` + `641f6d38`
- **Corrections applied:**
  - Check 6: the effective-guard mutation.
  - Redaction: only `describeError`'s public `detail` reaches the snapshot.
  - Jini contains no `TOVU_SITE_KEY`. The env var name comes from the status `envVarName`, then the host's `rootKeyTab.defaultEnvVarName`.
- **What changed:**
  - **Rules:** `rootKeyBadge` (None / key file / environment variable {name}; tone `warning` when invalid, `success` when active, `info` otherwise) and `rootKeySourceNote` (env, file path as its own `code` element, invalid env or file, none). The "none" copy depends on generate visibility.
  - **Refusals:** `classifyRootKeyRefusal` (`locked` / `refused` / `already-exists` / `generic`, matching `use-site-key.hooks.ts:82-90`).
  - **Controller:** `createRootKeyController(…, { describeError })` with snapshot `generateError`. The generate guard now also refuses any `source !== 'none'` (create-only).
  - **Hook:** a locked note when locked; a production backup caveat in the scope notice; `describeRootKeyError` comes from the Provider chrome.
  - **Tab:** split into `RootKeyScopeNotice` / `RootKeyStatusCard`.
- **Existing assertions changed (deliberate P12/P16 display change, listed):**
  - `RootKeyTab.test.tsx` "shows the status line" (`active · fp · file`) now asserts badge, fingerprint title and path `code`.
  - "offers generation only when allowed" now supplies a loaded status, because Create lives in the status card.
  - `root-key.controller.test.ts` "reports a refused generation with the fixed message" now expects `generateError: {kind:'generic'}` and asserts that `PRIVATE` is absent from the snapshot. Generate no longer reuses the recovery message.
  - Test count rose; nothing was deleted.
- **Tests:** `__tests__/root-key-presentation.test.ts` (24) plus 3 module-level cases in `security-module.test.tsx`:
  - generate shown or hidden;
  - a translated badge;
  - a `KEY_INVALID` detail shown while the raw message is absent;
  - the key fixture never in the snapshot;
  - refusals for an active key, an env source and a file source.
- **Mutation:** the guard was reduced to `if (!status) return Promise.resolve(false);` → **7 red** (including the new active, env and file cases and 4 older ones).
- **Follow-up `641f6d38`:** `canGenerateKey` and `invalidKeyNote` were split out, because `rootKeyFlags` (13) and `rootKeySourceNote` (11) broke complexity 10. The gate is back to base.

### U-AUTH-1: login, MFA login, logout as K1 routes. DONE `c1974c14`
- **Corrections applied (checks 2 and 3):**
  - Parsers are total. Every refusal is a thrown `RouteRefusalError` (a returned `err` would bypass `onError`), and the host reads `.response.status` and `.body`.
  - Unexpected MFA-login failures are thrown for the host's `sendAuthFailure(login)`, with `no-store` already set.
  - MFA success body pinned, including the display-name fallback.
- **New node entry `@jini-ai/user-management/admin-http/auth`:**
  - `auth-request.ts`: the `AuthRequest` host response-policy contract, `requireAuthRequest`, `refuse`, `bodyRecord`.
  - `password-login.ts`, `mfa-login.ts`, `logout.ts`, with small per-route deps.
- **Package metadata tests:**
  - `user-management-rename.contract.test.ts` gained the entry row.
  - `package-entries.test.ts` treats it as `node`, like `./server`.
  - Both are additions; no assertion was relaxed.
- **Tests (21):** B1–B5, B7–B13, MFA-store routing, passthrough of host faults, parser totality for `undefined`/`null`/string/number/object. B6 (the real `Set-Cookie` order) is a host route test (U-AUTH-T1).
- **Mutation:** removed `details.retryAfterSeconds` from the login 429 → B2 red.

### U-AUTH-2: boot-session, local-boot-session. DONE `a912790c`
- **Corrections applied (check 3):**
  - A deliberate redemption `failure` is thrown as `OwnerAuthFailure{operation:'boot-session'}`, for the host's redacted `boot-session` envelope. Repository faults pass through untouched (OD-2 path).
  - The sign-in signal fires after the host installs the cookie.
  - The existing-session local branch skips the mint and the signal.
  - B14 spies on the **token property** getter.
- **Why-comments moved, with three product names neutralised:** `TOVU_DESKTOP_*` → "launcher-specific name", `tovu serve` → "an ordinary server start", and the host file path → "the host's boot-session token store". This keeps Jini vendor-neutral. A reviewer should confirm that is acceptable against the verbatim rule.
- **Tests (11):** B14–B20 plus the 403, fault and no-store-on-refusal paths.
- **Mutation:** skipped the loopback check → B14 red.

### U-AUTH-3: /auth/me and password-status. DONE `5d7d963c`
- `currentUserRoute` returns exactly four keys. `createPasswordStatusRoute()` is a per-registration factory: the memo, its why-comment, the 256 cap and the wholesale clear moved verbatim. `DEFAULT_OWNER_PASSWORD` is now the injected `defaultOwnerPassword`.
- **Tests (9):** B21 for both routes; B22 for a missing row, the memo, per-registration memos, re-verify on a new hash, and the 256 clear.
- **Mutation:** hoisted the memo `Map` to module scope → per-registration red (plus re-verify).

## Not done, and why
| step | reason |
|---|---|
| SEC-IDX | Docs on `plan/whats-left-1122`; this run may not push `plan/*` |
| SEC-6 | OD-3 (a) `RootKeyPort.reveal?` unanswered (STOP a) |
| SEC-7 | Depends on SEC-6 (lane A) |
| SEC-8 | OD-3 (b) unanswered; K4-seam-5.J also a prerequisite |
| SEC-9 | Depends on SEC-8 |
| SEC-10, SEC-11 | Chain plus the missing A-K2-0a.chip kit slot (STOP b) |
| SEC-12 | OD-3 (c) unanswered |
| SEC-13 | Lane B chain after SEC-12 |
| SEC-14 | OD-3 (d) unanswered |
| U-AUTH-T1 | OD-2 (`next(error)` forwarding for 4 routes) unanswered; OD-1 alone does not unblock it. Host notes for it: keep `redeemOwnerBootSession`'s tested helper contract for `dev-auth-boot-owner`/`dev-auth-failures` tests (check 3); host `onError` must map `RouteRefusalError` → flat body, `OwnerAuthFailure` → `sendAuthFailure`, else login/logout `sendAuthFailure`, boot/me `next` |
| SEC-T0, T1a/b/c | Need every step above (dispatch rule) |

## Gates (Jini; base = `integ/merge-14` + sec4, recorded before any edit)
| gate | base | tip | verdict |
|---|---|---|---|
| build (`-r`) | 0 | 0 (admin, user-management rebuilt) | same |
| typecheck (`pnpm typecheck`) | 0 at integ-14 (combine-14) | 0 | same |
| guard | 0 | 0 | same |
| api:check | 0 | 0, after `api:update` per step | same |
| check:hooks | 0 | 0 | same |
| check:size | 1, 1 stale row (sidecar) | 1, same row | same |
| check:complexity | 1: 4 rows (chat, core reporter, ui ErrorNotice, agent-runtime) | 1: same 4 | same, after `641f6d38` |
| check:why-comments | red, 10 deleted-comment rows in agent-plugins/chat/core/sidecar/admin-comments tests | same 10, none in touched files | same |
| check:errors | 0 | 0 | same |
| check:log-safety | red (desktop-host, http-kit, ui rows) | **+1 row: `[stored-error-text] user-management/src/admin-http/auth/mfa-login.ts`** | **NEW ROW**, from wire parity B12 (`{error: IdentityValidationError.message, code:"MFA_REFUSED"}`), the same as Tovu `DA:715`. Needs an owner call: allow it in the debt list, or change the wire |
| check:cross-package (XP, `--base 35c4961af`) | XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6 (combine-14) | XP1 39 / XP2 33 / **XP3 2056** / XP4 760 / XP5 6 | XP3 +6 = the "absolute JINI_DECLARATION_BASELINE_DIR required" row for each new source file. No declaration snapshot was built in this run |
| vitest admin | 3,094 tests | **3,133 / 3,133** (255 files) | +39, 0 red |
| vitest user-management | 1,353 tests | **1,407 / 1,407** (120 files) | +54, 0 red |

## Gates (Tovu, Jini branch linked; no Tovu source changed)
- **Root `tsc -p tsconfig.json`:** 0.
- **Admin `tsc --noEmit`:** 2, with 4 errors. All are Jini integ-14 kit additions the Tovu integ-13 host lacks: `Icon` slot, `useT` hook, kit `values` in `jini-kits.ts`, `main.tsx` and `render-with-jini-kits.tsx`. This run does not touch `packages/admin/src/react/kit.tsx` (`git diff origin/integ/merge-14 -- …kit.tsx` empty). It is a base-pairing break (Tovu merge-13 against Jini merge-14) for the next combine run.
- **Admin vitest on every importer of `@jini-ai/user-management/react`, plus `features/security` and `features/auth`:** 1,343 / 1,344 pass across 50 files. The one red is `lib/__tests__/credential-input-autocomplete.unit.test.ts` ("linked checkout only"), whose finding is `react/testing.tsx:10`, i.e. `packages/ui/src/react/testing.tsx`. That file is integ-14 base code this run did not touch, so the failure is base pairing.
- **Route-table pin (`create-app-route-table.pin.test.ts`):** 3 pass / 7 fail, all 7 variants.
  - Regenerating to a scratch copy (not committed; the fixture was restored with `git checkout`) shows the differences: the `/internal/tool-executions`, `/internal/tool-catalog` and `/api/site-assistant/frontend-sessions*` rows are absent, a new consent client hash appears, and two `use <anonymous> /` rows are added.
  - **No `/auth/*` row and no security row differs.** Tovu imports none of this run's new modules, so the drift comes from the environment and the integ-13/integ-14 pairing (site-chat not built, Jini merge-14 content). OD-1's 14 handler-name substitutions only apply in U-AUTH-T1, which was not run.
- **Node tests on changed files and importers:** none, because no Tovu file changed and no Tovu file imports a changed Jini module other than the UM react barrel (covered above).

## FILES-LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`)
| tree | moving | **FILES-LEFT** | excluding theme areas (`theme` 86 + `adm-themes` 25) |
|---|---|---|---|
| before (`0d7f78fa4`) | 2,486 | **2,486** | **2,375** |
| after (this branch) | 2,486 | **2,486** | **2,375** |

- `shells.json` is empty with this plan-branch version of the tools.
- The Tovu tree is unchanged. The Jini pieces built here only lower the count when SEC-T1 and U-AUTH-T1 delete the host files.

## Open items for the owner / Codex review
1. **OD-2 and OD-3 (a)–(d)** answers unblock U-AUTH-T1, then SEC-6/8/12/14 and their chains.
2. **log-safety:** the new `stored-error-text` row in `mfa-login.ts` is the parity body B12. Allow it, or change the wire.
3. **U-AUTH-2:** confirm the three product-name substitutions inside the moved why-comment.
4. **SEC-3:** record the two renames in `P9-BREAKS.md` (plan branch).
5. **Next combine:** Tovu integ-13 does not typecheck against Jini integ-14's kit (`Icon`, `useT`, `values`). That is independent of this run.
