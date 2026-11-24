PARTIAL 641835f339 197a6098b: lane steps blocked on owner decisions / unlanded prerequisites / files owned by in-flight runs — all admin A-adm/A-K2 deployment·source-control·database·recovery·trash·import-export·publish-content screens, K5 deployments/source-control/dns/database/recovery/trash/site-backup/site-export/publish-content remainders, P-publish-trust-1, DT-desktop-1 (6 held files), K5-desktop-1, desktop React-hook rows (AX-48–56, 64/65, 87, 120/121 renderer half), AX-68–73, 77–88, 114/115, 122–129 (see "Steps skipped")

# ex7-deploy-desktop: Deployment/Source Control/Database/Recovery/Trash/Backup/Export + Desktop shell (continuation, 2026-11-23)

Unattended cloud run. Opus coordinated; 14 subagents built the batches (13 Opus, 1 Sonnet). Wall-clock 19:51 to about 21:20 UTC. The coordinator reviewed every subagent diff, then committed each batch on its own (Jini half, then Tovu half). It rebuilt the changed packages, ran the affected tests and pushed with a plain `git push`. **Codex should review every diff before merge.**

## Result
- **Tovu deletions:**
  - 15 production files and 7 test files deleted.
  - 111 files changed, **+864 / −3,888** lines.
- **FILES-LEFT (`scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`):**
  - **2,362 → 2,359**; excluding themes, 2,251 → 2,248; this lane's areas, 302 → 299.
  - Desktop "keep" went **226 → 215**.
  - Most desktop work deletes or splits files the scanner classes as host "keep" (AX rows), so FILES-LEFT moves little.
  - About 3,000 Tovu lines of desktop and renderer mechanics now live in Jini.
- **Gates:**
  - **No new red in either repo.** Every remaining red gate, and every red test, is identical at the provisional base.
  - Three new reds found at the end were fixed before this report: Jini guard SI-domain, check:hooks and log-safety. So were Tovu `typecheck:tests` and the `main/index.ts` size growth.
- **Mutations:** every behaviour-changing slice has a named mutation, and each one went red and then green again after restore (table below).
- **Branches** (both pushed; the remote was checked to be in sync after each push):
  - Jini `codex/ex7-deploy-desktop-jini`: 39 commits after the provisional-base merges, from `d9dc45d35` to `197a6098b`.
  - Tovu `codex/ex7-deploy-desktop-tovu`: 23 commits after the provisional-base merges, from `962a2b5aa9` to `641835f339`.
  - This report is the commit after each.

## Provisional foundation (merged before branching)
**Jini base** `origin/integ/merge-14-2026-11-22` (`4902a6a1a`) plus these merges:
- `ex4-deploy-jini` and `ex4-desktop-jini`.
- `ex5-fnd-kit-jini` and `ex5-fnd-seams-jini`.
- `ex5-fnd-routes-jini`: the api-baseline conflict was resolved by a 3-way JSON union.
- `ex3-c0b-jini`: same core baseline JSON union.
- The provisional base tip is `39b6ef9f`.
- **Skipped: `ex5-fnd-inject-jini`.** It conflicts with seams and ex4-deploy in 27 files: 19 add/add contracts and `cms/publish/content/peer-url.ts`, which both branches re-injected. That is non-trivial.

**Tovu base** `origin/integ/merge-13-2026-11-22` (`f7185f153`) plus these merges:
- `ex4-deploy-tovu`.
- `ex4-desktop-tovu`, `ex2-tovu-halves` (already contained) and `ex2-holds-tovu`: only `why-comments-debt.json` conflicted, resolved by list union.
- `ex5-fnd-kit-tovu`: three import-line conflicts with holds' moved `settings-api`, resolved to holds' path plus kit's Jini imports.
- `ex5-fnd-seams-tovu`: four import-line conflicts, plus nine `contracts/core/tool-metadata/*` files that seams deleted and holds had re-imported. I took the deletion.
- `ex5-fnd-routes-tovu`.
- The provisional base tip is `05eff8c99`.
- **Skipped: `ex5-fnd-inject-tovu`.** About 100 conflicting files, including `tool-metadata/*` and assistant approval files. That is non-trivial.

**Forbidden-file rule.** Files changed on in-flight branches were avoided: ex5-*, ex6-*, p12-*, bugs-*, p11-next-*, visitor-chat, sec5, plus ex2-halves/holds and ex3-c0b, each diffed against its merge-base. That came to 1,690 Tovu and 878 Jini paths.
- The only exception was append-only shared manifests: `package.json` exports and `jini` blocks, `.changeset/*`, `api-baseline/*` and `development/why-comments-debt.json`. Every lane appends to these, and the reviews say "keep all rows".
- `cms/package.json` and `core/package.json` were appended to under that exception.

## Setup
- **Tools:** Node 22.23.5 (no `/opt/node24` in this container) and pnpm 10.33.2.
- **Jini:**
  - `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0, with 0 `error TS`.
  - A clean worktree at the provisional base (`/home/user/jini-base`) was installed, built and used for the base gates.
- **Tovu:**
  - `npm ci --ignore-scripts` in root, admin, desktop and site-chat: 0/0/0/0.
  - `link-jini.mjs` against this Jini branch: 0. `packages/contracts` tsc: 0. `packages/sdk` build: 0.
  - A base worktree at `05eff8c99` (`/home/user/tovu-base`) shares `node_modules`.
  - `origin/refactor/terra` was fetched for why-comments.
- **Not set up:** PostgreSQL.
- **Not used:** codebase-memory tools, force-push, `--no-verify`, tags or publish. No `main`, `integ/*`, `plan/*` or `release/*` branch was written.

## Batch table
Each row's Jini commit is listed first, then its Tovu commit.

| batch | subagent | rows | files moved or split (Tovu → Jini) | importers repointed | tests (Jini / Tovu) | named mutation | status |
|---|---|---|---|---|---|---|---|
| B1 | Opus | rv-c desktop **FIX-1** (AX-91/92, D15 dedupe) | Removed Jini `./shell/{window-navigation-policy,webview-guest-policy,window-bounds-store}`. The host binds `./electron/navigation-policy` and `./electron/usability` directly. New host `main/windows/window-bounds-file.ts` (JSON store + file name). | `main/index.ts`, `windows/app-window.ts`, `windows/sites-home-window.ts`, Jini `shell/guest-navigation.ts`, 4 tests | dh 832 green; Tovu nav/guest/app/sites/bounds files 73/0 | saved bounds → null: 3 red; required-preload throw off: 2 red; both restored | DONE. `zoom-menu` dedupe SKIPPED: Jini zoom needs positional-callback support, which is new behaviour |
| B2 | Opus | AX-58/59, AX-66/67, AX-57 | `use-dropdown-menu.hooks.ts` → ui `browser/useDismissibleDropdown` + `settingsControlHandlers`; `use-site-list-prefs` → ui `useSiteListPrefs` (seed + sync save); `folder-drop.ts` deleted (dead duplicate of ui `folderPathsFromDataTransfer`) | `SiteGrid.tsx`, `SettingsControl.tsx`, 3 tests | ui 7 + 10 new; desktop 46/47 (1 BASE-RED) | Escape no longer closes: 1 red; denied storage: 1 red; sync save: 2 red | DONE. `Spinner.tsx` SKIPPED: markup and a11y differ (decorative ring vs live region) |
| B3 | Sonnet | K5-publish-trust-1, K5-deployments-1 (part) | `publish-trust/keys.ts` → `cms/publish/trust/keys`; `publish-credentials/types.ts` → `devops/deploy/site/publish-credentials/types` | 19 importers; barrel type re-export removed | cms 9 + devops 3 new; website 60 files green, plus 1 BASE-RED (`publish-run.unit` 6/12 at base too) | installation-id purpose; verify fails open; type field drop | DONE |
| B4 | Opus | AX-132/103, AX-62/63 | `tree-quiet.ts` deduped onto devops `treeQuietProblems` (optional host formatters); LoadedSitesStepper → ui `./number-stepper` (NumberStepper, rules, optimistic setting) | `scripts/check-tree-quiet.ts`, `LoadedSitesStepper.tsx`, `use-loaded-sites.hooks.ts` | devops 7 → 11; ui 16 new; desktop 12/12 | moving-file refusal: 4 red; + button upper limit: 1 red; clamp max: 5 red | DONE. `.stepper*` CSS stays in the host via `classNames` (owner decision to ship a `jini-number-stepper` stylesheet) |
| W2a | Opus | AX-93/94, AX-118/119 | Manual update check → `desktop-host/electron/updates/update-check-now`; new `./electron/preferences` (preference file, values, persisted checkbox/radio menus, trusted IPC) | `main/index.ts`, `desktop-updater.ts`, `product-telemetry-boot.ts`, `settings-menu.ts`, `site-view-preference.ts`, `desktop-update-preference.ts` | dh 31 new; desktop 257 | duplicate manual check; bounds clamp; stale checkbox; stale radio | DONE. AX-95/96 → W3c. The renderer `use-site-view-preference` hook stays (React) |
| W2c | Opus | AX-60/61, AX-107/109, AX-105 part | expanded-mode, theme (on `resolveColorScheme`), delete-confirmation, site toast, `import-error-details` → ui `./app-shell` | `App.tsx`, `App.hooks.ts`, `SiteWorkspace`, `TopNav`, `SettingsControl`, 3 hooks, tests | ui 18 new; desktop 59 | delete-cancel targets the wrong item; toast lifetime; color-scheme media | DONE. Host bindings kept for copy, storage key and error policy |
| W2d | Opus | AX-110/111, AX-105 part | `icon-frame.tsx` → ui `IconFrame`; `use-import-drop` → ui `useClassifiedPathDrop` (classifiers injected); `mount-renderer` → ui `browser/mountRenderer` | `icons.tsx`, `tool-icons.tsx`, `ImportWebsite.tsx`, `main.tsx` | ui 10; desktop 66 + 22 | rejected-drop reset; missing root | DONE |
| W2f | Opus | K5-deployments (heal scheduler) | `account-label-heal-scheduler.ts` → `devops/deploy/site/publish-credentials/account-label-heal-scheduler` with a REQUIRED `onHealError` (no console in Jini) | route `system/publish-credentials.ts` (inline host reporter, log text identical), barrel line removed | devops 10; host pin added (8/8) | reporter swallowed: 2 red; host reporter `() => {}`: 1 red | DONE. Fixture vendor names neutralised for the no-hosting-vendor test |
| W3a | Opus | AX-116/117, AX-74/75/76 | Server-output tail deduped onto diagnostics `createRedactedOutputSink` retain/tailKeepChars; `desktop-agent-inventory.ts` → `agent-runtime/inventory`; DTO → `core/contracts/agents/inventory` (types only) | `tovu-server.output.ts`, `desktop-chat-main.ts`, `workspace-chat-ipc.ts`, `renderer/runner-api.ts` (coordinator), `contracts/runtime-inventory.ts` trimmed to channels | diagnostics 20 → 23; agent-runtime 8; desktop 120 | tail keeps head: 1 red; unbounded tail: 1 red; rescan stale: 2 red | DONE. The coordinator finished the AX-74 renderer repoint |
| W3b | Opus | AX-46/47 | Preload subscriber → `desktop-host/electron/preload` `createPreloadSubscriber`; `<webview>` structural types → `./electron/webview` | `preload.mts`, `renderer/electron-webview.d.ts` | dh 3 new | cleanup removes another listener: 2 red | DONE |
| W3c | Opus | AX-95/96 | Desktop updater lifecycle and native notices → `desktop-host/electron/updates` (eligibility, preferences, controller, reporter injected) | `main/index.ts`, `updates/desktop-updater.ts`, `updates/native-notices.ts` | dh 36; Tovu 32 → 8 + Jini 29 | quit after download: 1 red; duplicate start: 2 red | DONE |
| W3d | Opus | AX-112/113 | `desktop-auth.ts` mechanics → `desktop-host/electron/session-bootstrap` (exchange, probe, partition, header arming); host keeps endpoints, names, loopback guard and policy | 2 tests (type imports) | dh 20; desktop 27 + 5 + 4 + 15 | partial bind reported as bound: 2 red; `useSessionCookies` false: 1 red | DONE. No rollback added: the original has none |
| W3e | Opus | AX-130/131 | `boot-steps.ts` toolchain setup and discovery lanes → `desktop-host/node-toolchain` | `main/index.ts` (imports only) | dh 7; desktop 40 | failed discovery blocks boot; write failure throws | DONE |
| W3f | Opus | AX-101/102 | `move-to-applications.ts` policy → `devops/packaging/electron/move-to-applications` (copy, app name, decline store, file reader injected) | its test | devops 22; Tovu 20 → 8 (+12 in Jini) | relocation re-entry decision lost: 3 red | DONE. Uses core runtime `orFallbackSync`, as devops already does (core is XP-exempt) |
| W3g | Opus | AX-89/90 | app-window and dock-icon → `desktop-host/electron/windows` (title, URL, partition, preload, nav policy, reporter injected) | `app-window.test.ts` | dh 12; desktop 11 | navigation installed after load: 3 red | DONE |
| L1 | Opus | gate fix | Error text formatting moved back to the host: `update-check-now` `describeErrorMessage`, session `describeError`, dock-icon `reportFailure({error})` | `update-check-now.ts`, `desktop-auth.ts`, `dock-icon.ts`, `main/index.ts` | dh 271 | dock-icon stringifies: 1 red | DONE |

Coordinator fixes:
- ui `NumberStepper` takes a REQUIRED `hooks` object (hook-injection gate). `theme/color-scheme.ts` was added to ui `isolation.shared` (SI-domain).
- The `MOVE_PROMPT` `satisfies` clause was widened.
- A heal pin test arity was fixed.
- `main/index.ts` is back to its base line count (merged duplicate-specifier imports).
- `hardwiring-debt.json`: removed 2 stale HW5 rows, for the deleted desktop duplicates.
- `why-comments-debt.json`: 128 "Moved to Jini" rows; `check:why-comments` is back to the base set.

**Mutation evidence.** The plants, red counts and restores are in each row above; the subagents' reports are summarised here. Every restore was a `cp` from backup, checked with `cmp`.

## Wiring docs (ADR-071)
`## Wiring` sections were added or updated in:
- `packages/desktop-host/README.md`: navigation/usability, updates, preferences, preload, webview, node-toolchain, session-bootstrap, windows and the updater.
- `packages/ui/src/browser/README.md` and `packages/ui/src/features/{site-card,number-stepper,app-shell,folder-path-drop}/README.md`.
- `packages/devops/src/deploy/site/README.md` and `packages/devops/src/packaging/electron/README.md`.
- `packages/cms/src/publish/trust/README.md`.
- `packages/agent-runtime/src/inventory/README.md` and `packages/diagnostics/README.md`.

## Self-check (11-22 review failures)
1. **No re-export or forwarding files.**
   - Tovu keeps host binding files only where host values remain: app-window, dock-icon, desktop-auth, boot-steps, theme, use-site-toast, use-delete-confirmation, move-to-applications, update-check-now, site-view-preference, desktop-update-preference, use-loaded-sites, LoadedSitesStepper, window-bounds-file and tovu-server.output. Each binds copy, keys or policy; none only re-exports.
   - The barrels inside Jini packages are package entry points.
2. **Hooks.** Every hook reaches a Jini component as a REQUIRED prop: `NumberStepper.hooks`. SiteToast calls no hook.
3. **No Express types or host formatters in Jini.** Log-safety equals base; L1 removed the three new findings.
4. **Class names.** New Jini components use `jini-*` classes, with host classes passed through `classNames`.
5. **No new size-exception or shrink-only debt rows.** Two HW5 rows were removed. why-comments rows are moved-comment records, appended as on every lane.
6. **Shared DTO.** `AgentInventorySummary` is owned by `core/contracts/agents/inventory` (types only).
7. **Named mutations.** Each behaviour-changing slice records one (table above).

## Gates (provisional base → tip; raw logs in the run scratchpad)

**Jini**

| gate | result |
|---|---|
| typecheck | 0 = 0 |
| guard | 0 = 0, after the SI-domain fix |
| api:check | 0 |
| check:hooks | 0 = 0, after the NumberStepper fix |
| check:size | identical output |
| check:complexity | identical output |
| check:why-comments | same lost and allow-listed counts (359 / 341) |
| check:errors | 0 |
| check:log-safety | identical set of 15 pre-existing findings |
| check:cross-package | XP1/2/4/5 rows identical. XP3 cannot be evaluated here: no declaration snapshot exists at the pinned `35c4961af` (`JINI_DECLARATION_BASELINE_DIR`). That gives 1,995 such lines at base and 1,999 at tip, the extra 4 being newly changed files |

Jini vitest (changed packages):
- desktop-host: 943 passed, 1 skipped.
- ui: 8,875, all green.
- devops: 1,390 at wave 1; `src/deploy` 235 and `src/packaging` 241 at the end.
- core: 2,998, all green.
- diagnostics: 1,089 passed, 4 failed. The 4 are BASE-RED (`web-evidence/page-body`).
- agent-runtime: 4,546 passed, 1 failed. The 1 is BASE-RED (`providers/connection-guard`).
- cms: 5,155 passed, 8 failed. The 8 are BASE-RED: `forms/package-boundary`, `forms/result-html` (6) and `widgets/expand-partials`.

**Tovu**

| gate | result |
|---|---|
| typecheck | 2 = base (same 2 `plugin-tier2/worker.ts` errors from the provisional foundation) |
| typecheck:tests | 2 = base, after the arity fix |
| typecheck:scripts | identical |
| check:boundaries | 0, with 108 warnings = base |
| check:size | identical: `main/index.ts` is 668 vs baseline 665 both at base and at tip |
| check:complexity | identical |
| check:hooks | 0 |
| check:why-comments | 109 at tip vs 110 at base, with no new ids |
| check:architecture | identical single non-blocking ratchet row |
| check:errors | 0 |
| admin tsc | 0 |
| desktop tsc | 0 |

The base desktop tsc log showed 2 errors only because desktop-host `dist` was being rebuilt during that run.

Tovu tests:
- **Desktop main:** 2,053 passed, 4 failed, all BASE-RED. 3 are root-permission "cannot be moved aside" tests, because the container runs as root. The 4th is `speech/preload-speech`, which needs a built `dist/preload`, as recorded by ex4-desktop.
- **Desktop renderer:** 884 passed, 2 failed, both BASE-RED: `use-site-folders` (`UpdateCheckMenuItem` binding) and `use-workspace-chat-pane` (raw primitive rule).
- **Admin vitest:** 14,572 passed, 7 failed in 4 files, all BASE-RED with identical counts: `JiniMediaPicker.hooks`, `admin-literal-copy`, `credential-input-autocomplete`, `panel-access`.
- **Website node tests:** every file touched or importing changed files, 66 files, is green except BASE-RED `static-publish/__tests__/publish-run.unit.test.ts` (6/12 at base and at tip).

## FILES-LEFT (all areas, themes excluded)

| tree | moving | shells | FILES-LEFT | excl. themes (`theme` + `adm-themes` = 111) | lane areas | desktop keep |
|---|---|---|---|---|---|---|
| base `05eff8c99` | 2,362 | 0 | **2,362** | **2,251** | 302 | 226 |
| tip `641835f339` | 2,359 | 0 | **2,359** | **2,248** | 299 | 215 |

Lane areas at the tip:
- `deployments` 41 → 39 and `publish-trust` 11 → 10.
- Everything else is unchanged: trash 18, publish-content 44, source-control 17, domain-dns 9, site-backup 43, database 6, database-transfer 12, publish-content-ui 8, recovery 4, site-export 9, permanent-delete 2, desktop (scanner) 11, and adm-* 28 / 14 / 13 / 12.

## Steps skipped, and why
**Files owned by in-flight runs** (changed on ex5/ex6/p12/bugs/visitor-chat/p11 branches):
- Every A-adm/A-K2 step in this lane: deployment-1/2, source-control, database, recovery, trash, import-export and publish-content each contain 1–4 files changed on those branches. Examples are `Deployment.hooks.ts`, `SourceControl.hooks.ts`, `source-control-visuals.tsx` and `publish-content/ui/contract.ts`.
- `contracts/core/tool-metadata/{deployments,domain-dns,publish-content,source-control}.ts`: inject deletes them.
- Deployments: `agent-tools`, `capability-card`, `contracts`, `dockerfile`, `domain-publish-rows`, `deploy-targets/types`, `export-run` and `tool-registrations`, each with forbidden importers.
- `site-backup/saved-keys-port`, `source-control/saved-key-bindings` and `publish-trust/{session,grant}`: forbidden importers (`publish-trust/handshake.ts` and others).

**Prerequisites not landed.** A readiness scan (every relative/`#src`/`@/` import already in Jini or in the same move set) found only 30 of 247 lane files import-ready. The common blockers are:
- `platform/http`, `platform/db/content-kernel` and `platform/site-dir`.
- `contracts/core/{human-confirm,export-report,gated-mutations/*,model-facing-tool-errors,credential-token}`.
- `@tovu/contracts/secret-redaction` and `vendor-credentials` / `custom-credentials`.
- The admin `lib/admin-http/request.ts` and `use-admin-locale.hooks.ts`.

**Desktop:**
- K5-desktop-1 still needs K4-seam-17/18; `core/contracts/site/{packaging-electron,platform-process}` are absent.
- AX-114/115 and 128/129 need BX-19/20; there is no `core/contracts/runtime/daemon-control`.
- AX-77–80 need K4-seam-18, and `desktop-resources.ts` is forbidden.
- AX-81–88 need W1 site-preview.
- AX-68–73: the workspace-chat transport is forbidden.
- AX-122–125: `desktop-agent.ts` is forbidden.

**Owner decision needed:**
- **React dependency for `@jini-ai/desktop-host`.** These rows target desktop-host React hooks: AX-48/49/51/52 (find bar), AX-53/54 (zoom), AX-55/56 (app-version), AX-64/65 (live views), AX-87 and the AX-120/121 renderer half. desktop-host has no React dependency, so these need a dependency or a retarget to `@jini-ai/ui`.
- **DT-desktop-1, 6 held files** (as in ex4-desktop):
  - `find-menu` (deployed channel).
  - `node-toolchain` (`TOVU_*` env contract).
  - `speech/*` ×3 (ABI namespace and helper path).
  - `shell-staleness` (message collision).
- **P-publish-trust-1:** the `TOVU_PUBLISH_TRUST` rename fails open.
- X-database-transfer-1, X-permanent-delete-1, `media-references` (SI-domain), `plan-store`, `directory-rollback-log` and the trash `registry`: same reasons as ex4-deploy and its FIX-1.
- **AX-57 `Spinner.tsx`:** the markup and accessible semantics differ.
- **zoom-menu dedupe:** Jini zoom would need positional Electron callbacks.
- **`jini-number-stepper` stylesheet.**

## Findings and notes for Codex / combine-15
1. **Index contamination.**
   - B2 and W2d staged their deletions with `git rm`. Tovu `962a2b5aa9` (B1) therefore also contains B2's deletions of `use-dropdown-menu.hooks{,.test,.render.test}.ts` and `folder-drop{,.test}.ts`; B2's importer repoints land in `688e170ea3`. The two commits are only consistent together.
   - Later commits used path-limited `git commit -- <paths>`.
2. **API-baseline commit `51d1a9405`** briefly carried W3g's in-flight `./electron/windows` symbols. `323e4bb44` and later commits regenerate it; the final `api:check` is 0.
3. **Stale rows left in forbidden files** (other runs own them):
   - `development/scripts/check-architecture.baseline.json:183` and `error-gate-debt.json:863`, both referencing deleted `publish-trust/keys.ts`. Neither gate went red.
   - `apps/desktop/src/asar-verify.ts:4` comment cites `src/tree-quiet.ts`.
   - `static-publish/verify.ts:60` comment cites the moved heal scheduler.
   - `apps/desktop/src/main/index.ts:~1077` comment says "every rule is in move-to-applications.ts", which is now partly in Jini.
4. **XP3 needs a declaration snapshot.** It must be built from a clean checkout at `35c4961af` (`--write-baseline`) before it can be evaluated. No run has had one.
5. **`useSiteListPrefs` now starts a save in the same turn** when none is in flight, and accepts synchronous ports. Admin's suite is unchanged (BASE-RED set identical), but admin `useWiredSiteListPrefs` timing changed slightly.
6. **Provisional merges** are in both branches' history; combine-15 rebases them away.
