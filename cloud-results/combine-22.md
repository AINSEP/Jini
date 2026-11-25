PARTIAL 89f44ea1a 9c4fcf87f | FILES LEFT 1008 (excl. themes) / 474 | left: final website node-test run hit its 60-min cap (7,816 top-level tests done, 0 new red vs merge-21; the files it never reached are not identified), check:architecture still red on the same 43 pre-existing cross-feature edges as merge-21

> The SHAs on the first line are the tested code tips: Tovu `89f44ea1a`, Jini `9c4fcf87f`. The commit that adds this report sits on top of them. All 5 items and every rv1124e FIX (1, 2, 3, 4, 6, 7, 8, 9) are merged and pushed. FIX 5 and the node gate are covered by the paired run below, which did not finish.

# combine-22 (2026-11-25): Tovu + Jini `integ/merge-22-2026-11-25`

This was an unattended cloud run. Opus coordinated and did the merges. Workers did every fix:
- **Sonnet** (high effort): srv, adm, x9, FILES LEFT script, fix.
- **Opus** (high effort): dom, which touches share-password crypto pins; bugs, which touches owner-data deletion and the keyring port; x9int, which touches site-key and publish-trust.

Never more than 4 workers ran at once. Each worker had a 50-call cap; the bugs worker went over it (60).

**Programmer skill confirmed.** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer v1.7.5) first. Every worker brief carried its rules:
- root cause first, minimum change;
- verification before completion;
- failing test first, plus a named mutation;
- inline docs and why-comments move with the code;
- the owner rules: inject everything, hooks as required props, fn ≤ 80 / complexity ≤ 10, no re-export shells, Jini neutral, themes untouched, never `--no-verify`.

**Setup:**
- **Node:** 24.22.3, with `/opt/node24/bin` first on PATH.
- **Jini:** `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`, exit 0.
- **Tovu:** `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link-jini` with `JINI_PACKAGES_DIR`; `prepare-desktop-hooks`; a build of `packages/{contracts,sdk}`. All exited 0.
- **Worktrees:** each item had its own worktree pair `/home/user/wt/<item>/{Jini,Tovu}`. `node_modules` were hardlinked, `dist` was copied, and Tovu was linked to that item's own Jini.

**Gate 0:** desktop `npm run gates` on merge-21 Tovu (`7c87b3c3f`): **6/6 pass**.

**Rules held:**
- No force-push, no `--no-verify`, hooks untouched.
- No codebase-memory tools, no RemoteTrigger.
- No tag, no publish.
- `main`, `plan/*`, `release/*`, every `codex/*` and older `integ/merge-*` were not written to.
- Themes are held at merge-21 (see item 4).

## Items

| # | item | status | commits Tovu / Jini (fix) | merged into merge-22 (Tovu / Jini) | evidence |
|---|---|---|---|---|---|
| 3 | `codex/x8-domains-*` + rv1124e FIX 6, FIX 7 | **DONE** | FIX 6 `6befeffb2` / `7891c7841`. FIX 7 needed no change. | `54479268f` / `0f4c7fef6` | **FIX 6:** Jini `static-download-landing.ts` keeps only the neutral page list. `StaticDownloadHost.renderLanding` is **required**, with no default. Tovu keeps merge-21's template and CSS byte-for-byte (unprefixed `card`/`badge`) and binds it in `static-download-host.ts`. New `static-download-landing.pin.test.ts` pins the exported `index.html` sha256 `a94ee700…` through the composed host. RED was `ERR_MODULE_NOT_FOUND`. **M `jini-default-renderer`** 2/2 red, **M `jini-prefixed-classes`** 1/2 red. GREEN 64/64; Jini devops 13/13. **FIX 7:** merge-21's frozen-ciphertext `saved-keys-aad-pin.test.ts` is on the branch byte-identical, next to the lane's reveal pin. 9/9 through the composed `site-portability.ts`. **M `wrong-aad-domain`** 5/9 red, including the frozen-ciphertext case. |
| 2 | `codex/x8-server-*` + rv1124e FIX 4, FIX 5 | **DONE** (FIX 5: see gates) | FIX 4 `f9b2ef8d1` / — | `6d551c53e` / `506e31538` | **FIX 4:** new opt-in mount option `forwardUncaughtErrors` in `admin-json-route-ports.ts`. A failure `failureFor` does not claim is rethrown, so `asyncRoute` sends it to `next(error)`: the app error middleware, 4xx `status` passthrough and `res.locals.routeError` all work again. Spec refusals (`RouteRefusalError`, `AdminWorkspaceRefusal`) and the folder-picker's own handled failures stay local. It is applied to `fs-files/custom-root.ts` GET/DELETE and to `folder-picker.ts`. New `uncaught-error-dispatch.test.ts` (7) runs over real HTTP. RED 6/7 (`0 !== 1` middleware never saw it, `500 !== 422`). **M `route-throw-to-generic-500`** 6 red. GREEN 7/7; neighbours 69/69. **FIX 5:** the coordinator's final website run uses the full merged scope: every test that changed or directly imports a changed file, on stable builds with no Jini rebuild mid-run. It was paired against merge-21; see Gates. |
| 1 | `codex/x8-admin-*` + rv1124e FIX 1, 2, 3, 9 + merge port | **DONE** | FIX 1/3/port `55cf5cc1b` / `adb385509`. FIX 2/9 in the x9 integration `7b6ed4c5d` / `ebaf5add6`. | `d295bef1d` / `c76c00a5f` | **FIX 1:** composer binds `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_BATCH_BYTES` and `uploadLimitForFile` from `@tovu/contracts/upload-limits`. Jini `useAttachmentUploader` now threads `maxAttachmentBytesFor`. RED: `upload-limit-single-source.unit.test.tsx` 2 failed (60 MiB video; shared batch cap). **M `composer-fixed-50mib`** red, in Tovu and in the new Jini `composer-upload-caps.unit.test.tsx`. **FIX 3:** `Themes.tsx` restored to merge-21 (themes dir diff empty), with compatibility selectors in host `styles.css`. **Merge port:** merge-21's Library "up to 50 MiB each" and Trash "days it has left" copy, which x8 had moved to Jini with the old strings. New Jini render tests: RED "Unable to find an element", mutation red, GREEN 46/46. **FIX 2:** the site-key hooks and their test use x9's type-only `@jini-ai/core/contracts/site/site-key`. The admin `site-key-port.hooks.ts` and its export/isolation entries are deleted, leaving no forwarding file and one owner (`rg SiteKeyPort`). **FIX 9:** `AccessTokensTab.tsx` loads `@jini-ai/admin/security/host/copy-keys-dialog.css`. Bug found: the Jini dialog rendered `copy-keys-*` while the stylesheet defines `jini-copy-keys-*`; renamed. New `copy-keys-dialog-css.test.tsx`: RED `expected ['copy-keys-list'] to deeply equal []`, **M `copykeys-class-drift`** red. x9's focus, cancellation and notification pins are green (17/17). |
| 4 | `integ/x9-batch-2026-11-24` + rv1124e FIX 8 (+ the x9 integration) | **DONE** | FIX 8 `e7bf1ab90`, docs `f1916122e` / `2eeac3601`. Integration `7b6ed4c5d` / `155800a17` + `ebaf5add6`. | `7b6ed4c5d` / `ebaf5add6` (fast-forward) | **FIX 8:** TH01–TH03 are held out in both repos. Tovu `features/themes/**`, the theme hooks, `ThemePreviewReloadButton`, the editor reload-button importers and the `ThemeTier` importers are back to merge-21. In Jini, the cms `react/themes` files, the 4 core theme contracts, their exports, isolation, api-baseline lines and the TH changeset are removed. **One deliberate deviation:** `Themes.tsx` differs from merge-21 by one import line, `../publish-content/PublishSectionButton` → `publish-section-button-binding`, because x9 deleted the old Tovu file (the review's "PublishSectionButton repoint"). Pure revert, so no mutation. Evidence: admin tsc 0; themes/posts/pages vitest 1361/1361; Jini cms react 23/23. **Integration conflicts** (Tovu): publish-content `destination-credential`/`disconnect-tool`/`plan-pull-tool.test`, `site-backup/import-plugin-state`, `Media.tsx`, the site-key files. Resolved per rv1124e MERGE-ORDER 3–4: x8-domains bindings plus x9's `PUBLISH_TRUST_WIRE`, logger and `hostSoonPluginIds`; no import of the deleted Tovu peer-transport. |
| 5a | Email Activity "Clear test emails" vs console "Kept locally" sends | **DONE** | `84d624607` / `05a4c4f20` | `a03f238ee` / `823b918ad` | Root cause: the list shows `mail_activity_attempts.outcome='captured'`, which includes console-driver sends with no `mail_capture` row, but clear only read `mail_capture`. The review now returns `attemptIds` too (revision v2). The count is distinct emails. Clear deletes the reviewed captures plus attempts that are still captured, in one transaction, and hides their ledger rows (`activity_retained=0`) while keeping the rows for duplicate protection. **The same preview → revision approval card**: a stale or unapproved confirm deletes nothing (pinned). RED `0 !== 1`. **M `clear-ignores-console-sends`** 2 red. GREEN 16/16. |
| 5b | Media card dates show the UTC day | **DONE** | — / `7a7f41abe` | same | `formatUploadDate` and `useMediaCardMetadata` take an injected IANA `timeZone`; the default is the browser zone. Jini admin vitest now runs with `TZ=UTC`, like Tovu's. RED `expected 'Oct 4, 2026' to be 'Oct 3, 2026'` (America/Los_Angeles). **M `media-date-utc`** 2 red. GREEN 20/20. |
| 5c | `KeyringPort` split | **DONE** | `f5754aae0` / `74be3a9e3` | same | One owner: core `contracts/vault` `KeyringPort` (`activeKey(_required)`). `integrations/secrets` and core `CredentialSetKeyringPort` are now **type aliases** of it, declared inside files that define other types, so neither is a shell file. Tovu `KeyringPort` imports were repointed to core, and 5 zero-arg `activeKey()` calls now pass `{}`. No crypto behaviour changed. Type test `keyring-port-owner.test.ts`: RED TS2344/TS2322. **M `keyring-arity-split`** red. Changesets added. This unblocks x9's STAYS-HOST sheets XM-01 and PK-02, which were not re-attempted. |
| 5d | Stale comments / debt rows (x9-testfix) | **DONE** | `e7bf1ab90` (in wip23-x9) / — | via x9 | (i) The word-count `index.ts` header now points at Jini `@jini-ai/plugins` `count-words.test.ts`. (ii) Removed the `error-gate-debt.json` rows for the deleted `use-copy-keys.hooks.ts` and `use-admin-surface-frame.hooks.ts`. (iii) Removed 12 architecture-baseline rows for the deleted `publish-content/{content-references,repo-handler}.ts`; NEW cross-feature edges stay 43 → 43. (iv) The `themes-port.hooks.ts` pointer is valid again (FIX 8 restored the file) and was left. |
| — | why-comment debt from the merges | **DONE** | `b2a5441e1` / `9c4fcf87f` | — | Jini: 3 comments made false by 5a/5b/5c, with reasoned rows. Tovu: 1 x8-domains T-FROZEN comment superseded by the lane's new block. Both checkers `ok`. |
| — | admin vitest reds introduced by the merges | **DONE** | `4cca7c7c1` (wip23-fix, fast-forward), `89f44ea1a` / — | same | (1) FIX 3's `:is(.jini-…, .agent-plugin-switch…)` rewrite hid the switch rules from the CSS pins. It is now plain selector lists naming both class families (`Themes.tsx` untouched). RED `No rule for selector .jini-agent-plugin-switch--locked:disabled`; M1–M3 red. (2) `panel-access.unit.test.ts`: x8-server moved the media, library and analytics permission literals into the Jini route specs. Evidence now resolves through package exports, as the existing observability entry already does, with the assertion unchanged. M6 red. (3) Pre-existing on merge-21, fixed anyway: `phone-touch-targets-css` (2) and `jini-class-host-css` content-analysis and consent (2). The content-analysis test now checks each `jini-content-analysis-*` twin against the generic rule it mirrors, which is what Jini renders; M4/M5 red. (4) `site-sealer.unit.test.ts`: bug 5c changed the keyring ABI, so the pin now asserts the wrapper forwards `activeKey({})`. RED `actual 1, expected 0`; **M `drop-keyring-options`** red. |

`open-bugs.md` (Tovu, `## combine-22` section) marks 5a, 5b, 5c, 5d and FIX 8 FIXED. The chat/media big-upload bugs were not touched (owner: later).

## Merge order (each pushed)
Tovu `integ/merge-22-2026-11-25`:
1. `54479268f` x8-domains (wip23-dom)
2. `6d551c53e` x8-server (wip23-srv)
3. `d295bef1d` x8-admin (wip23-adm)
4. `7b6ed4c5d` x9 (wip23-x9, via the wip23-x9int integration, fast-forward)
5. `a03f238ee` bugs (wip23-bugs)
6. `b2a5441e1` debt row
7. `4cca7c7c1` admin CSS / pin fixes (wip23-fix)
8. `89f44ea1a` site-sealer pin

Jini:
1. `0f4c7fef6`
2. `506e31538`
3. `c76c00a5f`
4. `155800a17` / `ebaf5add6`
5. `823b918ad`
6. `9c4fcf87f`


Each lane was first merged onto merge-21 as `integ/wip23-<item>`; the fixes were made there.

Conflicts and how they were resolved:
- Ledgers: 3-way union by id.
- The x8-admin composer, Library and Trash files: taken from x8, then merge-21's deltas re-applied test-first (FIX 1 and the port).
- The bugs × x9 publish-trust files: x9 had moved them to Jini. The deleted files stay deleted, and `KeyringPort` imports were repointed to core.

WIP refs (both repos): `integ/wip23-{dom,srv,adm,x9,x9int,bugs,fix}`. `wip23-bugs`, `wip23-fix` and `wip23-srv` hold no Jini changes for fix and srv.

## Gates (final tree)
**Jini** (`9c4fcf87f`; the build is `pnpm -r --filter './packages/*' build`, exit 0):
- `pnpm typecheck` (strict; per package with `--if-present` plus `scripts/tsconfig.json`): **0**.
- `pnpm guard`: **1**, only the known base-red HW3 in `shell-failure-log.ts`, same as merge-21. It also printed advisory "stale debt" notes for `hardwiring-debt.json` (1) and `env-access-debt.json` (2), which are not failures.
- `api:check` **0**. `check:hooks` **0**.
- `check-why-comments --base merge-21`: **ok**, after the 3 debt rows in `9c4fcf87f`.
- **Changed vitest** (every added or changed test file per package, plus platform `src/mail`), all green:
  - admin 23 files / 207 tests
  - agent-plugins 1 / 5
  - analytics 2 / 30
  - cms 52 / 444
  - core 2 / 4
  - devops 29 / 270
  - http-kit 4 / 16
  - integrations 3 / 8
  - plugins 1 / 10
  - search 1 / 7
  - user-management 6 / 55
  - platform 37 / 393
- `pnpm -r build` (all workspaces) still fails only in `examples/reference-desktop` (no electron in cloud).

**Tovu** (final tip `89f44ea1a`; static gates ran on `b2a5441e1`, and later commits are admin CSS and tests only):
- `npm run typecheck` (root + e2e): **0**. Admin `tsc --noEmit`: **0**.
- `check:hooks`: **ok**. `check:boundaries`: **0 errors**, 147 warnings (merge-21: 141).
- `check:architecture`: **FAILED, same as merge-21.**
  - 43 NEW cross-feature edges, set-identical to the x9 baseline run.
  - back-edges into the composition root 0.
  - runtime-only propagation 3.06 → 3.71 (warning ratchet; merge-21 3.58).
- why-comments (`--base merge-21 --other-root Jini`): **ok**, after 1 debt row in `b2a5441e1`.

**Admin vitest:** 215 test files (changed files plus direct importers, `--maxWorkers=2`), the same list on both trees.
- merge-21: 4055 pass / 12 fail (phone-touch 2, jini-class-host-css 2, CollectionEntries 1, security-panel 6, widgets-swap 1).
- merge-22 before the fix: 4017 / 15 fail. The 8 new or touched failures were fixed in `4cca7c7c1`, and those 4 files are 56/56 on the tip.
- **Remaining on the tip:** the 7 known (CollectionEntries 1, security-panel 6), the same as the x9 report. Not re-run as a whole after the fix.

**Website node tests (rv1124e FIX 5 plus the node gate):** changed tests plus their direct importers on the final tree.
- **Scope:** 832 files, the union of the merged-tree list and the pre-bugs list.
- **Sampled out:** importers whose only changed import is one of 6 one-line hub edits (`composition/app.ts`, `agent-plugins/lifecycle.ts`, `routes/types.ts`, `post/index.ts`, `admin-http/dev-auth.ts`, `post/repo.memory.ts`; tsc covers them). A 1-in-20 sample of those was kept (28 of 547).
- **Run:** `--test-concurrency=2`, `--experimental-test-module-mocks`, with no Jini rebuild during either run.
- **merge-21** (`/home/user/Tovu`, the same list in two runs): 9,926 top-level tests, 97 failing.
- **merge-22: the run hit the 60-min cap** after 7,816 top-level tests, with 66 failing. It ran concurrently with the base run and the desktop gates on 4 CPUs.
- **Every merge-22 failure in the completed part is pre-existing, except one,** which is now fixed:
  - Failures match merge-21 by test name and file, or by file for Postgres tests, which have no socket here and are red on both.
  - Seven files that were only in the second base batch were re-run singly on both trees: federate-mcp 4, auth-failure-diagnostic 1, credential-works-for 1, external-mcp-aad 1, ready-providers 4, newsletter-public-routes 2, production-readiness-boot 1. All are red identically on merge-21.
  - The one new red was `project-keys/site-sealer.unit.test.ts`, fixed in `89f44ea1a` (4/4).
- **Not proven:** the files the capped run never reached. The TAP output does not name files that never started. The next combine should re-run the list (`node-union.txt` in the run scratchpad) on a quiet machine with a 90-min cap.

**Desktop gates:** `npm run gates` on merge-22 (`b2a5441e1`; no `apps/desktop` change since merge-21): **6/6 pass**. Gate 0 on merge-21 was also 6/6.

## UNVERIFIABLE-IN-CLOUD (check in the real app)
1. **Static download landing (FIX 6):** download a static site backup and open `index.html`. It should look as before (classic card/badge styling).
2. **Uncaught route errors (FIX 4):** custom root and folder picker in the real admin. Error pages and status for a failing custom root should look as before x8, and the server log should have `routeError`.
3. **Chat composer caps (FIX 1):** a 60–500 MB video is accepted in the dock composer, a 60 MB image is refused in plain words, and a 501 MB video is refused. Real ffmpeg conversion was not run.
4. **CopyKeys dialog (FIX 9):** Security → Access tokens → Copy keys. The dialog should be styled (`jini-copy-keys-*` classes from the moved stylesheet), with focus, cancel and notify working.
5. **Agent-plugin pill switches** (FIX 3 compatibility selectors): the themes screen and Settings → User interface switches look identical, light and dark, phone width.
6. **Email Activity "Clear test emails" (5a):** with the console provider, send a test, see "Kept locally", then clear behind the approval card. The row is gone, and a second identical send is still de-duplicated.
7. **Media card dates (5b):** in a non-UTC time zone, upload late in the evening. The card shows the local day.
8. **Real publish-trust handshakes** against a live peer (x9 PT03 plus the x8-domains peer transport), and old share passwords from a real pre-x6 backup.
9. `examples/reference-desktop` build (no electron in cloud). Postgres-server tests (no socket).
10. Everything carried from combine-21 / x9 UNVERIFIABLE lists.

## New bugs / notes
- `c22-node-run-capped`: the final website paired run did not finish (see Gates). Re-run on a quiet machine.
- `c22-arch-propagation`: runtime-only propagation cost rose to 3.71 (merge-21 3.58), a warning ratchet. The 43 cross-feature rows are unchanged and pre-existing (`c21-arch-cross-feature-baseline`).
- `c22-themes-one-import`: `Themes.tsx` differs from merge-21 by one import (`PublishSectionButton` → `publish-section-button-binding`), because x9 deleted the old Tovu file. Owner: accept it, or restore the Tovu file while themes are held.
- `c22-keyring-unblocks`: with one `KeyringPort` owner, x9's STAYS-HOST sheets XM-01 and PK-02 can be re-planned. They were not attempted.
- `c22-api-baseline-drift`: the bugs worker's `pnpm api:update` committed about 880 lines of admin and 21 lines of user-management baseline drift that already existed on merge-21. `api:check` is 0 on the tip.
- `c22-content-analysis-test-shape`: `jini-class-host-css` content-analysis was red on merge-21. Its test now checks the flat `jini-content-analysis-*` twins Jini renders instead of the old scoped selectors; the CSS is unchanged. Owner review suggested.
- `c22-mail-clear-wider`: Clear test emails now also removes console-provider "Kept locally" attempts and hides their ledger rows. The rows are kept for de-duplication; check this in the app (UNVERIFIABLE 6).
- `c22-wrong-share-id-unmutated`: FIX 7's wrong-share-id refusal case cannot be turned RED by an AAD mutation, because a wrong AAD is refused too. Covered as before, but no mutation is named for it.
- Pre-existing failures carried, all red on merge-21: `publish-zero-setup-end-to-end` (`deployConfigGenerators` undefined), `wiring-identity` row 7, `webhook-repo.dialects` postgres stale-save (Jini), admin CollectionEntries 1 and security-panel 6, Jini guard HW3 `shell-failure-log.ts`.

## FILES LEFT (combine-18 planner + P9 scan; true count = planner + every KEEP_RULE in `plans/count-1124/*.md`)
The script was calibrated exactly on merge-21, giving 1186 / 1066 and true 642 / 522, which match the x9 report.

| tree | planner | planner excl. themes | true count | true excl. themes |
|---|---:|---:|---:|---:|
| merge-21 | 1186 | 1066 | 642 | 522 |
| **merge-22** | **1128** | **1008** | **594** | **474** |

The theme areas are 120 files on both trees (themes held out). The script is `files-left.sh` in the run scratchpad (scan.mjs → combine-18-plan.mjs, plus `plan-true.mjs` with the rules appended).

Per area, Jini-bound `src` files (sorted by merge-22 planner count):

| area | planner merge-21 | planner merge-22 | true merge-21 | true merge-22 | ready (true) |
|---|---:|---:|---:|---:|---:|
| adm-other | 167 | 147 | 66 | 47 | 0 |
| theme | 88 | 88 | 88 | 88 | 31 |
| public-http | 86 | 86 | 47 | 47 | 2 |
| admin-http | 65 | 63 | 30 | 28 | 0 |
| adm-shell-components | 47 | 45 | 29 | 28 | 0 |
| agent-plugins | 45 | 44 | 29 | 28 | 3 |
| adm-posts | 40 | 38 | 17 | 15 | 1 |
| adm-shell-lib | 35 | 35 | 8 | 8 | 1 |
| site-backup | 37 | 34 | 29 | 26 | 1 |
| adm-themes | 32 | 32 | 32 | 32 | 10 |
| post | 30 | 29 | 22 | 21 | 6 |
| deployments | 28 | 28 | 23 | 23 | 1 |
| contracts-core | 28 | 27 | 6 | 5 | 3 |
| adm-security | 29 | 23 | 19 | 15 | 0 |
| adm-deployment | 24 | 23 | 15 | 14 | 4 |
| adm-pages | 19 | 20 | 5 | 6 | 1 |
| plugin-runtime | 21 | 20 | 4 | 4 | 0 |
| publish-content | 20 | 15 | 17 | 13 | 0 |
| media | 15 | 14 | 11 | 11 | 2 |
| trash | 14 | 14 | 9 | 9 | 0 |
| custom-credentials | 15 | 14 | 9 | 8 | 1 |
| identity | 13 | 13 | 6 | 6 | 0 |
| adm-shell-hooks | 13 | 13 | 3 | 3 | 0 |
| api-connections | 14 | 13 | 4 | 3 | 0 |
| source-control | 12 | 12 | 5 | 5 | 0 |
| external-mcp | 11 | 11 | 7 | 7 | 0 |
| adm-publish-content | 13 | 11 | 8 | 6 | 0 |
| site-export | 10 | 10 | 6 | 6 | 1 |
| database-transfer | 9 | 9 | 2 | 2 | 1 |
| project-keys | 8 | 8 | 8 | 8 | 1 |
| adm-source-control | 9 | 8 | 5 | 5 | 0 |
| pages | 8 | 8 | 4 | 4 | 0 |
| forms | 8 | 8 | 2 | 2 | 0 |
| newsletter | 8 | 7 | 6 | 5 | 0 |
| webhooks | 8 | 7 | 6 | 5 | 1 |
| settings | 9 | 7 | 0 | 0 | 0 |
| vendor-credentials | 6 | 6 | 2 | 2 | 1 |
| adm-members | 6 | 6 | 0 | 0 | 0 |
| database | 5 | 5 | 3 | 3 | 2 |
| site-inspection | 5 | 5 | 2 | 2 | 0 |
| adm-recovery | 5 | 5 | 1 | 1 | 0 |
| desktop | 5 | 5 | 1 | 1 | 1 |
| contracts-headless | 5 | 5 | 1 | 1 | 1 |
| adm-roles | 5 | 5 | 0 | 0 | 0 |
| platform-mail | 5 | 5 | 0 | 0 | 0 |
| mail-status | 4 | 4 | 4 | 4 | 0 |
| form-destinations | 4 | 4 | 3 | 3 | 0 |
| member-login | 4 | 4 | 3 | 3 | 0 |
| consent | 4 | 4 | 2 | 2 | 0 |
| fs-files | 4 | 4 | 2 | 2 | 0 |
| taxonomy | 4 | 4 | 2 | 2 | 1 |
| content-types | 4 | 4 | 1 | 1 | 0 |
| navigation | 4 | 4 | 1 | 1 | 0 |
| widgets | 4 | 4 | 1 | 1 | 0 |
| adm-users | 4 | 4 | 0 | 0 | 0 |
| publish-content-ui | 4 | 4 | 0 | 0 | 0 |
| media-generation | 3 | 3 | 3 | 3 | 0 |
| asset-transfer | 3 | 3 | 2 | 2 | 0 |
| publish-trust | 6 | 3 | 5 | 2 | 0 |
| entries | 3 | 3 | 1 | 1 | 0 |
| members | 3 | 3 | 1 | 1 | 0 |
| recovery | 3 | 3 | 1 | 1 | 0 |
| web | 3 | 3 | 1 | 1 | 0 |
| platform-html | 3 | 3 | 1 | 1 | 1 |
| presentation | 3 | 3 | 0 | 0 | 0 |
| email-templates | 2 | 2 | 2 | 2 | 0 |
| web-screenshot | 2 | 2 | 2 | 2 | 1 |
| mail | 2 | 2 | 1 | 1 | 0 |
| object-storage | 2 | 2 | 1 | 1 | 0 |
| analytics | 2 | 2 | 0 | 0 | 0 |
| comments | 3 | 2 | 1 | 0 | 0 |
| skills | 2 | 2 | 0 | 0 | 0 |
| content-duplication | 1 | 1 | 1 | 1 | 0 |
| image-transform | 1 | 1 | 1 | 1 | 0 |
| media-import | 1 | 1 | 1 | 1 | 0 |
| permanent-delete | 1 | 1 | 1 | 1 | 0 |
| observability | 1 | 1 | 0 | 0 | 0 |
| redirects | 1 | 1 | 0 | 0 | 0 |
| seo | 1 | 1 | 0 | 0 | 0 |
| server-logs | 1 | 1 | 0 | 0 | 0 |
| site-search | 1 | 1 | 0 | 0 | 0 |
| tool-audit | 1 | 1 | 0 | 0 | 0 |
| webmcp | 1 | 1 | 0 | 0 | 0 |
| platform-routing | 1 | 1 | 0 | 0 | 0 |
| **total** | **1186** | **1128** | **642** | **594** | 79 |

