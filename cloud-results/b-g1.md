DONE 16fae690f2 cba888fe76

# b-g1 (2026-11-25): open bugs + P8 triaged backlog part A — Tovu + Jini `integ/b-g1-2026-11-25`

This was an unattended cloud run. Opus coordinated, merged and reviewed. The four `BUILDER: OPUS` sheets went to four Opus (high-effort) workers, each in its own git worktree. No more than 4 ran at once, and each stayed within its budget (P8-J1 26 tool calls, P8-T1.S 31, B-VIDEO-NOTE.T 40, B-DESKTOP-CACHE.T 33). The coordinator used about 95 tool calls over about 1 h 10 min.

Before starting I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5, 2026-11-05), and every worker brief carried its rules: root cause first; a failing test first plus a named mutation; inject everything; required hook props; no re-export shells; functions ≤ 80 lines and complexity ≤ 10; why-comments move with the code; plain-words errors with redacted details.

- **Base:** Tovu `7c87b3c3f9`, Jini `010c8cd874` (`integ/merge-21-2026-11-24`).
- **Code tips:** Tovu `16fae690f2`, plus this report. Jini `cba888fe76`, plus the report copy.
- **Setup:** Node 24.22.3 (`/opt/node24/bin` first on PATH).
  - Jini: `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link:jini` (`JINI_PACKAGES_DIR=/home/user/Jini/packages`); `prepare-desktop-hooks`; build `packages/{contracts,sdk}`.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` untouched. No tag, no publish.
  - Jini was not rebuilt during any Tovu test run. The one rebuild (for `api:update`) happened after all workers had finished.
- **WIP refs:** Tovu and Jini `integ/wip-b-g1`.

## Sheets

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| B-HEADLESS.J | Sol | DONE (tested) | user-management core 20/20. AST fixtures for type-only vs value import. Not re-mutated by Opus. |
| B-VENDOR-SCAN.J | Sol + Opus | DONE | `surface-vendor-neutrality.test.ts` 3/3. Opus removed a host product word ("Tovu") from the test's why-comment, because the N1 rule bans host words in Jini. |
| B-MEDIA-DATE.J (OPUS-REVIEW) | Sol, reviewed by Opus | DONE, approved | 3 viewer-zone witnesses green. **M** `force-utc-after-injection` turned all 3 red while the UTC tests stayed green. Opus restored the lost UTC-default why-comment. `api:update` run (see Gates). |
| B-MAIL-CLEAR-COPY.J | Sol + Opus | DONE | The Sol witness **crashed before asserting** because it had no `AdminKitProvider`. Fixed by mounting under `fakeAdminKit()` (J `e6948b382`). 2/2 green. **M** `restore-unqualified-clear-copy` turned 2/2 red. The Tovu repoint (`EmailCaptureClear.unit.test.tsx`) is green. |
| B-VIDEO-NOTE.J (OPUS-REVIEW) | Sol, reviewed by Opus | DONE, approved | cms media routes 90/90. **M** `drop-conversion-notice`: the upload and import-url positive witnesses each went red. **M** `forward-arbitrary-notice-value`: both arbitrary-value fixtures and the "omit on success" test went red. The type is additive, and `AdminMediaEnvelope` is unchanged. |
| B-MEDIA-DATE.T | Sol | DONE | `media-card-viewer-zone.unit.test.tsx` green. **M** `drop-zone-at-card-boundary` turned it red. |
| B-ERROR-LEDGER.T | Sol | DONE | `moved-admin-surface-error-debt.test.mjs` green. The 32 rows were removed and the other rows left untouched. The named mutation was not re-run by Opus. |
| P8-T3.J | Sol + Opus | DONE | The Sol build was **red**: `exactOptionalPropertyTypes` on `leaveGuardOwner` in `MenuEditorHeader.tsx`. Fixed with a conditional spread (J `ca4dc190e`). Interceptor and header tests are green. Opus restored the lost "Audit finding" why-comment. |
| P8-T3.T | Sol | DONE | MenuEditor 20/20. **M1** remove `preventDefault` → `sidebar navigation … asks first` red. **M2** omit `leaveGuardOwner` → `Back link prompts once` red. **M3** omit cleanup → 3 red, including `unmounting a dirty menu removes the guard`. |
| B-DESKTOP-CACHE.T | Opus | DONE (retirement only) | T `151195461`, `87a5de7b3`, `16fae690f`. Tests: `removal clears only the retired site's web caches after untracking`, `a refused erase never touches the site's partition cache`, `cache cleanup failure does not turn completed project removal into failed deletion`, plus 2 binding tests in `site-cache-trim.test.ts`. Mutations: `trim-default-partition` → binding test red. `trim-before-untrack` → "only the retired site" red (moving it before the erase also turns "refused erase" red). `propagate-cache-failure` → "cache cleanup failure" red. Opus follow-up: the catch now reads the error and reports only its errno code (error gate); **M** `return String(error)` → no-path assertion red. Electron 43.8.6 calls used: `fromPartition(sitePartition)`, `clearCache()`, `clearCodeCaches({})`. **There is no supported per-partition cap** (no `setCacheSize`; `cache:false` turns the cache off entirely, it does not bound it), so no cap is claimed. |
| B-VIDEO-NOTE.T | Opus | DONE | T `2a4417488`, `603f52350`. Server: `a failed video conversion returns the original and never serializes its cause` and a no-notice control. A mounted upload + URL-import witness (`video-conversion-notice.test.ts`) checks a canary is never sent. Admin: `Media shows a saved-without-playable-copy status after a successful upload` plus a locale test (21 locales). Mutations: `return-stored-without-notice` → unit and mounted witnesses red. `serialize-converter-cause` → unit witness red (the mounted one stays green because the Jini route forwards only the literal). `render-notice-inside-closed-modal` → admin witness red. |
| P8-J1.J | Opus | DONE | J `953835e9c` (tests, red), `f51dcd921`. ui execution tests 388 → 400. All 9 table tests went red before the fix or under their mutation: M1 timer approval, M2 no blur commit, M3 approve on identity change, M4 no preset-default approval, M5 approve whatever selectPreset yields, M6 drop the hasApiKey trigger, M7 no URL validation on Test connection, M8 no `preventDefault` on Enter, M9 ignore `isComposing`. Approval state holds trimmed URLs only, never a key. Seeded from the initial host endpoint only. `BASE_URL_SETTLE_MS` / `baseUrlSettleMs` deleted (no consumers). |
| P8-T1.S | Opus | DONE | T `d0f5d57dc`: chat migration `0049_scrub_assistant_chat_titles`, appended to `CHAT_MIGRATIONS`. Pin `chat/0049_…` = `8758a15c…d55f`; Opus re-derived it independently (PIN-OK, STEP-OK). The runner accepts any strictly increasing ids, and TS steps have no Drizzle journal. Tests in `chat-title-scrub.test.ts` (sqlite + pglite, with an AFTER UPDATE trigger counting writes): `a stored chat title holding a token is redacted by the migration` and `a clean title and its title_source are left untouched`. RED: not registered. **M** skip redactor → token test red on both dialects. **M** write back every row → clean-title test red. A second runner call applies nothing, and null titles stay null. `runner.postgres.test.ts` chat witness: 0049 added and green against a real local PG16. |

Non-build dispositions were carried as the sheet states. O02 keeps `text/vtt` out of the picker (OWNER-DEFAULT 2). O03 keeps 550 MiB (OWNER-DEFAULT 3). Legacy redirect overflow: no reproduction attempted (not a build sheet).

## Gates vs merge-21

**Gate 0.** Desktop `npm run gates` passed 6/6. `apps/desktop` was byte-identical to merge-21 at that point; the Tovu Sol merges touch no desktop file.

**Jini** (`cba888fe7`):
- Package build 0. On the first Sol merge it was red, and that was fixed.
- `pnpm typecheck` 0.
- `pnpm guard` 1. The only violation is the known BASE-RED HW3 in `shell-failure-log.ts` (same as merge-21). No host or product words in the `packages/` diff: 0 "Tovu" hits after the fix.
- `api:check` 0 after `api:update` (J `f741f0349`). The changed entries are exactly the sheets' ones:
  - `./media#formatUploadDate` and `use-media-card-metadata` (`MediaMetadataFormatters`, `useMediaCardMetadata`)
  - `MediaPort`
  - `./browser#navigate` and the new `BEFORE_LINK_NAVIGATION_EVENT`
  - `MenuEditorController`
  - the cms `upload` / `import-url` deps and routes
  - core `MediaConversionNotice` / `MediaUploadResult`
  - the ui execution entries
- The baseline refresh also folds in **pre-existing merge-21 drift** that `api:check` already reported before any b-g1 change: changed `./react/kit` AdminKit* / `InfoTipProps` / `useAdminKitChatValues` / `useTabbedDialog`, many added admin `./shell/*` subpaths, and 3 added user-management `react/*/api` subpaths.
- Changesets: `media-card-viewer-zone`, `email-capture-scope-copy`, `media-conversion-notice`, `p8-t3-admin-link-leave-guard`, `p8-j1-byok-explicit-endpoint-commit`.
- `check:hooks` 0. `check-why-comments --base merge-21` 0 (5 blocks restored or retired with reasons).
- Changed vitest, all green:
  - admin browser/media/screens(media, email, menus, plugins): 767
  - cms media routes: 90
  - ui execution: 400
  - user-management core: 20

**Tovu** (`16fae690f`):
- Root `npm run typecheck` (+ e2e) 0. Admin `tsc` 0.
- `check:hooks` 0.
- `check:boundaries` 0 errors, 143 warnings. That is the same count as after the Sol merges, before any OPUS sheet. combine-21 recorded 141 at its own tip.
- `check-why-comments --base merge-21 --other-root Jini` 0 after 2 debt rows: the obsolete "defaulted menu hook" doc, and the reworded "response has no field" video-note doc.
- Error gate (WARN mode): 7 new or worse entries, **identical to merge-21's 7**. The one new entry b-g1 introduced (`project-ipc.delete.ts` catch) was fixed.
- Desktop `npm run gates` 6/6. It ran twice: the final standalone run, and the pre-push run on `16fae690f`.
- Admin vitest on media, menus, email, library, settings and panel importers: 78 files, 1296 passed, 2 skipped.
- Website node tests on media conversion, all media route tests, chat migrations, checksums and assistant-chats routes: 287 tests, 283 passed, **4 failed**. All 4 fail identically on unmodified merge-21, checked in a merge-21 worktree:
  - `checksums.test.ts` ×2
  - `library.test.ts` (file-level)
  - `upload.test.ts` "one byte over 50 MiB"

## UNVERIFIABLE-IN-CLOUD
- **B-DESKTOP-CACHE.T packaged run.** These were not checked on a packaged build:
  - On-disk HTTP disk cache vs V8 code cache after removal.
  - What happens to an already-grown partition.
  - Whether `fromPartition` for a site not opened this launch clears its on-disk cache.
  - The sign-in and kept-site reopen controls.

  The environment has no display and no packaged Electron.
- **B-DESKTOP-CACHE.T active cache bound.** Not possible with a supported Electron 43 API (see above). Only retirement cleanup is fixed.
- **B-MEDIA-DATE.T real browser zone.** Tested with an injected zone only. The `Intl.DateTimeFormat().resolvedOptions().timeZone` default was not exercised in a real browser.
- **Website full node suite** was not run (run limit); only the changed areas and their importers were.

## New bugs
**Fixed in this run** (each with a failing test or failing build first):
- The P8-T3.J Sol build was red under `exactOptionalPropertyTypes` (J `ca4dc190e`).
- The B-MAIL-CLEAR-COPY.J Sol witness crashed without `AdminKitProvider` (J `e6948b382`).
- A host product word was in the Jini test comment (J `cba888fe7`).
- 5 lost why-comment blocks in Jini (restored or retired, J `0693ac543`, `cba888fe7`) and 2 in Tovu (T `829b974fe`, `16fae690f`).
- The desktop cache-failure catch did not read its error; it now reports only the errno code (T `16fae690f`).

**Logged** in `development/open-bugs.md` § "b-g1". All of these are pre-existing on merge-21 unless noted:
- `b-g1-checksums-0002-digest`: shipped content step 0002 was edited by import repoint `72a2612a6`. The checksum loop stops there, which hides later pins.
- `b-g1-upload-50mib-witness`
- `b-g1-library-test-file`
- `b-g1-runner-postgres-content-witness` (missing 0042–0045)
- `b-g1-desktop-cache-wiring-untested` (new, low): the `main/index.ts` binding has no unit test.
- `b-g1-byok-blur-then-test` (new, low): blur followed by Test connection gives an automatic plus an explicit discovery. This follows the sheet as written; owner to decide.

`development/todos.md`: the video-conversion item records that the owner-visible note is done. Its remaining work (the cap/threshold decision) is still open, so it is not ticked.
