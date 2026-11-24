DONE 3995db6fe0 b565aaa7 | FILES LEFT 1,659 / 1,548 excl. themes (combine-17 lost tree: 1,655 / 1,544; merge-16: 2,187 / 2,076)

# combine-17b (2026-11-24): rebuild and push Tovu `integ/merge-17-2026-11-23`

Unattended cloud run with an Opus high coordinator. I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before starting any work: root cause first, minimum change in scope, fresh evidence before claiming done, inject dependencies, no re-export shells. Every worker's brief carried those rules.

- **Base:** Tovu `origin/integ/merge-16-2026-11-23` = `3a93322474`. Jini `integ/merge-17-2026-11-23` = `890723edb` plus my fix `b565aaa7` (pushed).
- **Lanes:** the Tovu halves of the 9 lanes that combine-17 merged on Jini: w3-rtfnd, w3-users-sec, w3-fnd, w3-screens, w3-settings, w3-sites, w3-pages-members, w3-deploy, w3-addons. w3-content stays out, as it did in combine-17.
- **Not taken:** the 4 bug/todo branches (bugs-low-a/b, todos-a/b). combine-17 did not take them.
- **Decisions:** I reused combine-17's conflict decisions; its report is `cloud-results/combine-17.md` on Jini merge-17. Ownership: users-sec owns the owner clients and auth. Screens owns Content Analysis. Sites owns WebMCP, the folder picker and admin-page-tools. Add-ons owns Skills. Deploy owns Import/Export, Git backup and the `escapeHtml` seam. pages-members' AdminFailureNotice wins.
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile` and `pnpm -r build` both exit 0.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `link-jini.mjs`. I installed the desktop pre-push hook with `prepare-desktop-hooks.mjs`, which sets `core.hooksPath=apps/desktop/scripts/hooks` the way a normal `npm ci` does.
- **Method:**
  1. Lane fix branches: 4 workers at a time, each in its own `git worktree`. Each built `fix/<lane>` = lane branch + the Codex Tovu FIXes + a merge of merge-16.
  2. Integration chains: 3 chains ran in parallel worktrees (`integ/{fnd,b,c}-step`). I merged the results, with workers doing the joins (`integ/{j,k,z}-step`).
  3. Shared JSON ledgers were UNION-merged by id.
- **Rules held:**
  - No `--no-verify`. Hooks config, the hook and `core.hooksPath` were not touched.
  - No force-push. No codebase-memory tools.
  - `main`, `integ/merge-16*`, older `integ/*`, `plan/*`, `release/*` and `codex/*` were untouched. No tag or publish.
  - Theme freeze held: the diff under `features/theme`, `routes/themes` and admin `themes` vs merge-16 is import and dynamic-import path repoints only (9 files), and the theme area count is unchanged at 111.

## Pushes
Tovu `integ/merge-17-2026-11-23` (new branch). Every push went through the pre-push hook.
- `80832de2d4`: 7 lanes (rtfnd, users-sec, addons, sites, screens, fnd + fixes). The hook ran the desktop gates: **6/6 PASS**.
- `bd34481ad2`: + deploy, pages-members and settings (final join) and the why-comments pass. The hook ran the desktop gates: **6/6 PASS**.
- `7f4a9b9f8d`: drops the stale boundaries rank. The hook skipped the desktop gates because no desktop path changed.
- `50d6a8fd0f`: this report. Then the test-import repoint merge and this report's update (the branch tip). The hook skipped the desktop gates.

Jini `integ/merge-17-2026-11-23`: `b565aaa7` (desktop regression fix), then this report's copy.

## Lanes
FIX ap = applied, st = stale (already done), INTEG = done while integrating with the owning lane, df = deferred.

| lane | Tovu FIX | notes |
|---|---|---|
| w3-rtfnd (rv1123l) | ap T5, T6, T7, T8 | T5 and T6 are security fixes with RED-first tests. T5: the raw-route wrappers forward a host `RouteHostContext`, and a `requireSameOrigin` mount without one is refused at registration (same-origin and cross-origin 403 pinned, admin + public). T6: `deferMissingPrincipal` + `sessionCredentialOnly` is refused at registration (combined-options pin). T7: panel-access evidence repointed to Jini dist routes, 29/45 → 45/45. T8: object-form `mountOptions` in members.ts/skills.ts, plus the `plans/K1-route-template.md` reconciliation. The merge-16 conflict in `admin-json-route-ports` keeps `forwardRejection` plus `sessionCredentialOnly`/`forbidden`/`failureFor`/`failureCopy` via `adminPortsFor`. |
| w3-users-sec (rv1123l) | ap T11; st T12 | T11: `.jini-roles-list-table` desktop, row-action and responsive selectors. The RED-first pin was red on 11/12 checks and reads the class from Jini `PoliciesSection.tsx`. T12: `owner-clients.ts` is the single owner, and fnd's `shell-collaborators` was repointed (fnd T1). Integration: the security module takes the merge-16 rule of one REQUIRED `useAdminLocaleHook`, together with `grantsReady`. Host `Login` takes the required locale hook. `useUsers` binds Jini's required `useUsers` and the host-owned `/users` deep-link close route (Jini FIX 9 contract). |
| w3-fnd (rv1123k) | ap T1 (INTEG), T2, T3 (doc) | T1: competing owner clients removed from `shell-collaborators.ts`; every importer uses `owner-clients.ts`. T2: Skills `ErrorNotice` comes from the admin kit, and `settings-dialog.css` loads from `main.tsx` ahead of skills/styles. Add-ons' Skills layout then won, and the Jini Skills screen already imports the kit `ErrorNotice`. T3: F8.1 is recorded in `cloud-results/w3-fnd.md` as a coordinator note. **Owner sign-off is still pending.** Join: injected `isAbortError`, `orFallbackSync` and `formatUserFacingError`; Jini kit slots bound; `useHostSitesSnapshot` binds `SITES_LISTING` for the sidebar (a behaviour carry-over). |
| w3-screens (rv1123k) | ap T1 (INTEG), T2 | T2: the Content Analysis mount is kept, with `useFetchQuery`/`useFetchMutation` injected (new required Jini deps). T1: WebMCP, the folder picker and `App.hooks` go to the Sites exports. Import/Export and Git backup go to Deploy's layout; `ImportExportPanel` and the screens hooks were dropped and the 3 tests repointed. Skills goes to Add-ons. The busy-picker 409 test now goes through `nativeFolderPickerDeps.isDialogAlreadyOpen`. |
| w3-settings (rv1123k) | ap T1 (INTEG), T2, T3 | T1: Screens' required-hook mount at `PostSavedPanels.tsx`. The port keeps `toAdminApiError`, so the card still hides on `PLUGIN_NOT_FOUND`. T2: 6 host consumers use Core `site-assistant-visitor-tools-management`, and the Tovu contract is deleted; `VISITOR_TOOLS_HOST` is kept. T3: `useExternalMcpRemoveConfirmHook` and `useFocusTrapHook` are bound, along with the consent/analytics hooks, `agentHandle`, `resolveDefinitionRaw` and `nowIso`. `bindModuleLoading` carries merge-16's locale hook. |
| w3-sites (rv1123l) | ap T16 | `GET /api/attachments/:ref` is a method route again through merge-16's `mountJiniRouteInPlace`, in the same position after the session gate. RED-first: a `use`-layer pin, which failed before the fix. OPTIONS (`Allow: GET,HEAD`) and HEAD (ETag/304) are pinned. The route-table snapshot row is unchanged. In the duplicate assistant route set, merge-16's specs won. |
| w3-pages-members (rv1123m) | ap 5, 6; dismissLabel st | 5: Observability hook collaborators and the server-logs `serverLogFilterReply` mapper are bound. 6: the dictionary-sinks guard accepts `COMMON_I18N` as `commonDictionary` in `createMembersTranslator` and `createPageEditorTranslator` only. Also: `evaluateNewsletterLaunchGate` gets `orFallback`; Members write deps get `orFallbackSync`, which fixed 15 of the members test failures. |
| w3-deploy (rv1123m) | ap 11; df 12 | 11: one host rollback reporter, `reportDirectoryRollbackFailure` (redacted via `describeErrorForLog`), at the 4 direct mounts; `provider-kit-host` implements `describeTransportError`; the admin `RECOVERY_HOST.reportError` takes `{message, error}`. Comes with a test and a mutation note. 12: deferred (theme freeze); the `publish-content/type-registry.ts` forwards stay. |
| w3-addons (rv1123m) | ap 17, 18 | 17: Jini merge-17 did **not** rename the manifests (`store`/`lipay`). The host binds `FIRST_PARTY_PUBLISHER = "tovu-core"` into both. New `first-party-data-modules.identity.test.ts` (2/2): an old site's retained rows are adopted, and a foreign publisher still needs consent. Mutation: skipping the binding turns it red. 18: `features/webhooks/index.ts` deleted; its rationale moved to `webhook-repo.sqlite.ts`; importers repointed (`system-deploy`, `publish-trust` → `keyring.env`). |

## Desktop regression fix (step 2)
- **Root cause.** Jini's log-safety refactor (`4f7d4d37`) moved the rename error out of the durable-json "could not be moved aside" notice into the reporter's `{ error }` argument, so the notice lost its `(reason)`. Tovu desktop pins that suffix in `site-dir-store.test.ts`, `site-child-registry.test.ts` and `tracked-sites.test.ts`. Their comment already accepts the fixed label `Error(EACCES)`.
- **Fix in Jini (`b565aaa7`).**
  - Failing test first: `durable-json.boundaries.test.ts` EXDEV now pins `(Error(EXDEV))`, and it went red.
  - Then the fix: `packages/platform/src/fs/durable-json.ts` puts `describeErrorForLog({ err })` in the message. That is the safe class(code) label, never the error text, and the existing "no secret in messages" assertion still passes. `{ error }` is still passed to the diagnostics sink.
  - Platform durable-json tests: 46/46. The 3 desktop tests pass.
- **Other desktop gate reds (all were red on merge-16 too, so they were not new).** The pre-push hook still blocks on them, and each was fixed honestly:
  - complexity: 3 functions at 10 (`SiteGrid`, `SiteStartPanel`, `TabStrip`) brought under 9/9 by small pure helper extractions (`71ecc6cad9`). The debt file was not touched. 227 renderer tests pass.
  - tests: 2 stale source guards (`80832de2d4`).
    - `WorkspaceChatPane` now takes an injectable `useWorkspaceChatPaneHook`. The guard still forbids raw React primitives and now also asserts that the default binds the real hook.
    - `SettingsControl` renders an `UpdateCheckMenuItem` sibling; its test binding was added.
  - typecheck: the `@jini-ai/node-adapters/fs` `nodeFileLock`/`nodeAtomicWriter` drift. Jini XC-6a made node-adapters take injected platform functions; the fnd join resolved it, and root, admin and all 4 desktop tsconfigs are 0.
  - coverage: it failed only because the tests failed.
- **Result:** `npm run gates` = 6/6 PASS on `80832de2d4` and again on `bd34481ad2`, run by the hook itself.

## Gates (once, at the end, on `7f4a9b9f8d`)
- **Tovu `npm run typecheck`** (root + e2e): 0 errors.
- **admin tsc:** 0.
- **desktop:** tsc on all 4 configs is 0, and `npm run gates` is 6/6 PASS.
- **hooks** (`check:hooks`): exit 0 (`hook-injection: ok`).
- **boundaries:** exit 0 after the stale `domain-dns` rank was dropped (the folder holds only tests and INFO.md). 136 depcruise warnings, 0 errors.
- **why-comments** (`--other-root /home/user/Jini`): **61** (base merge-16: 78–80; combine-17's lost tree: 244).
  - Added 153 moved-to-Jini rows. Each names the Jini file, and a script checked that the file exists and holds the symbol or an equivalent comment.
  - Added 7 obsolete rows, each proven by its deleting commit: deleted re-export shims or comment-only barrels.
  - Restored 1 genuinely lost why-comment: `site-backup/share-service.ts` `acknowledgeSiteShare`.
  - The 61 left are listed below; no rows were added for them.
- **admin vitest** (244 changed test files vs merge-16, `--maxWorkers=2`): 5075/5086. 6 red files:
  - BASE-RED: `credential-input-autocomplete`.
  - NEW-RED:
    - `phone-touch-targets-css`
    - `jini-class-host-css`: no top-level `:where(.jini-content-analysis) .jini-card-title` rule
    - `dictionary-lookup-sinks`: sanity floor of 30, but 28 found now that dictionaries moved to Jini; not lowered here
    - `use-dock-renderer-registry` hook: one extra key
    - `security-panel.test.tsx`: `useAdminLocaleHook is not a function`, from the locale-hook integration
  - The first two are the same CSS reds combine-17 reported.
- **node tests** (775 changed website/site-chat/package test files, postgres/live excluded, concurrency 2): 10896/10989, 87 fail in 44 files.
  - NEW-RED, caused by test imports or deps that moved to Jini:
    - `newsletter/send-pipeline` (`orFallback`)
    - `system/mail-activity` (`listCustomCredentials`)
    - site-export `download-forms-privacy`, `hosted-forms-static`, `static-copy-policy` (`platform/html/source-edits`)
    - `newsletter/error-mapping`
    - `seo/put-settings`
    - A worker was repointing these at the end of the run; see "Late fix".
  - NEW-RED, behavioural:
    - `member-login/link-service` (+ dialects): `LOGIN_INVALID` from Jini `link-service.ts:158`. combine-17 attributed this to the addons side.
    - `settings/site-title` AC-07: the pending workspace should be pinned to the Tovu demo title.
    - `route-deps-members-mail.characterization`: 1 new row.
  - BASE-RED (same failure on merge-16):
    - Postgres or environment: forms-notification-restart, settlement, owner-passkey-http (no chromium), secret-scan-guard (git ENOBUFS).
    - Assertion failures: federate-mcp, no-vendor-in-core, `mail/activity.repo.dialects`, attempts-retention, tool-contract characterization, share-database, forms-submit, pages-update-html-auth, forms-module-sender, resolve-mailer, webhook-delivery-worker (+shutdown), mail-send.golden, serve-command-wiring.
  - UNATTRIBUTABLE (13 files, including redirects-create and newsletter create-list/import/send-test-campaign with 500 ≠ 400, plugin-host, process-root-parity, wiring-identity). The merge-16 rerun shared this run's Jini merge-17 link and failed to load on the `nodeAtomicWriter` drift. To attribute them, rerun merge-16 against its pinned Jini.
  - Raw summary: worker file `final-tests.md`, local only.
- **FILES LEFT:** `plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`. scan: 7,568 files; plan: moving 1,659 (ready 321, blocked 1,338), keep 321, theme areas (`adm-themes`, `theme`) 111. So **1,659 / 1,548 excl. themes**.

## Late fix
`b785e5fd67` (merged): the 7 test-import NEW-REDs were repointed to the moved Jini owners, with no assertion changed. 6 files now pass in full: mail-activity 7/7, download-forms-privacy 4/4, hosted-forms-static 3/3, static-copy-policy 9/9, error-mapping 12/12 and put-settings 6/6. `send-pipeline` is 84/85. The 1 failure left is `dispatchRow` happy path: Jini `user-management/newsletter/send-pipeline.ts` now sends an explicit `html: undefined` key, and the test's deepStrictEqual expects that key to be absent. This is combine-17 bug #4 and is left for an owner call: either Jini omits the key, or the expectation changes.

## New bugs / follow-ups
1. **why-comments, 61 left.**
   - (A) 30 ids whose code is now in Jini but whose Jini home lacks the rationale; restore them in Jini, which was read-only for this run's worker. Most are in cms `admin-http/routes/{pages,posts}/{delete,update}.ts` (version-race, outbox drain, omitted-vs-null), `media/versioned-repo.ts` CAS, `themes/layout.ts`, `media/upload.ts`, `forms/result-html.ts`, and mcp `agent-install/install.ts` (consent before I/O).
   - (B) 17 comments reworded in place next to surviving Tovu code. The new text keeps the rationale, so an owner call is needed on a "reworded in place" row form.
   - (C) 2 others. Possibly a lost test: `search.route.test.ts` "longest accepted q still passes" was deleted with its comment, but `SEARCH_QUERY_MAX_LENGTH` is still in Tovu.
2. **Lane fix branches committed `node_modules` symlinks.** `apps/{admin,desktop,site-chat}/node_modules` were committed by worker `git add -A` runs. These branches are local only and were never pushed. merge-17 tracks none: I untracked them in the commit after `d704d6b520` and in `de00cfd22a` on b-step, and `git ls-files | grep node_modules$` = 0. One merge-abort with a tracked symlink deleted the main checkout's ignored `apps/admin/node_modules`; it was restored. **Hazard for future runs:** stage with `git add -u` plus explicit paths in worktrees with linked `node_modules`.
3. **`git pull --rebase` on an integ branch flattens merge commits.** AGENTS rule 4 says to pull with rebase. On an integration branch, `git pull --rebase` without `--rebase-merges` tried to replay the lane commits one by one, and I aborted it. When origin is an ancestor, a plain push is a fast-forward. Suggest `git pull --rebase=merges` in that rule.
4. Admin CSS/markup reds (see Gates). `dictionary-lookup-sinks` has a sanity floor of 30 but now finds 28. combine-17 lowered it to 25 with a comment; this run did not lower it. An owner call is needed.
5. `security-panel.test.tsx` 6/6 red: `useAdminLocaleHook is not a function` in the integrated security module test. A prop is probably not reaching the host Provider path; to be fixed next.
6. `member-login/link-service` `LOGIN_INVALID` (Jini `user-management/member-login/link-service.ts:158`) and `site-title` AC-07: behavioural NEW-REDs that need bisecting.
7. `apps/desktop/complexity-debt.json` still holds an `App.tsx` `App` entry the gate now reports as FIXED; remove it.
8. fnd's `HostAdminFailureNotice.tsx` was dropped in favour of pages-members' `shell-notices-wiring` (`TovuAdminFailureNotice`), which also passes a translated `dismissLabel`.
9. `tsconfig.tests.json` (not a required gate) was not run at the end. The b-step worker saw 37 errors there: test fixtures missing `orFallbackSync`/`escapeHtml`/`orFallback`, plus stale imports.
10. Still open from combine-17:
    - Jini `user-management` runtime-boundary regex false positive.
    - `send-pipeline.ts:256` undefined `html`.
    - `mountAdminJsonRoute` origin context for JSON specs.
    - Bare `on` classes in `ConsentFields`/`PrivacyTab`.
    - `bundled-deploy-package` plugin ids.
    - fnd F8.1 owner sign-off.
