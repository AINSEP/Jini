PARTIAL 6ded743aac b7e79e403 | FILES LEFT 1186 (excl. themes 1066) | left: website node-test gate unfinished (killed at 30 min; ~260 files red in a run disturbed by mid-run Jini rebuilds, triage below), check:architecture still red on pre-existing cross-feature edges (merge-20 already red), desktop gates not re-run after the last merges (no apps/desktop change since the green run)

# combine-21 (2026-11-25): Tovu + Jini `integ/merge-21-2026-11-24`

This was an unattended cloud run. Opus coordinated and did the merges. Sonnet high-effort workers did every fix (11 dispatches, never more than 4 at once). I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first, and every brief carried its rules: root cause first, failing test first plus a named mutation, inject everything, fn ≤ 80 / complexity ≤ 10, no re-export shells, why-comments moved with code, no `--no-verify`.

- **Base:** Tovu `68cb95192`, Jini `7b2625f4d` (merge-21 with the m21-leftovers report).
- **Tips:** Tovu `6ded743aac` (code), plus this report. Jini `b7e79e403` (code), plus the report copy.
- **Setup:** Node 24.22.3 (`/opt/node24/bin` first on PATH).
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat, then `link:jini`, `prepare-desktop-hooks`, and a build of `packages/{contracts,sdk}`. All exited 0.
  - Workers each had their own git worktree pair: `node_modules` hardlinked, `dist` copied, and Tovu relinked to the worktree's Jini.
- **Gate 0:** desktop `npm run gates` on the merge-21 base passed 6/6.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and older `integ/merge-*` untouched. The x8 lanes were not touched.
  - No tag, no publish.
- **Caps:**
  - Four workers ended at or slightly over 50 calls (W5 59, W6 50). Each was stopped and its leftovers re-dispatched to a fresh worker.
  - Coordinator: about 120 tool calls. Wall clock about 2 h 10 min.

## Items

| # | item | status | commits (Tovu / Jini) | evidence |
|---|---|---|---|---|
| 4 | owner local-main 11-24 open-bugs/todos fold, `development/carry/` deleted | **DONE** | `52b9e9583` (merge `6d01bc604`) / — | Docs only. open-bugs gained 1,420 lines (the old live-tree log, inserted before combine-7, plus the 11-22..11-24 rows at the end). todos gained 302 lines (15 carry-only sections, plus `26b`/`26c`). No repo row was deleted. No shared id had a newer carry status. Carry versions that duplicate newer `bt2-todos 11-24` annotations were left out. |
| 1 | `codex/x6-server-*` + rv1124d FIX 1, FIX 2 | **DONE** | merge `0f95708746`, FIX 1 `94aa921d24`, FIX 2 `794e3b4858` (merged `d03023bf98`) / `d876badc5` (merged `ca9a786c9`) | Merge conflicts were `tool-metadata/index.ts` (kept x6 Jini imports plus merge-21's agent-pause) and the debt ledger (3-way union by id). All six flagged overlap files keep both sides. **FIX 1:** none of the 4 SEO specs set `bufferedReply`. `seo-documents.wire-pins.test.ts` (12) was RED (`Content-Length actual null`, no ETag). The fix mounts each with `bufferedReply: true`. GREEN 12/12, and the existing sitemap/robots/llms/feed tests pass (40). **M `drop-buffered-reply`** → 12 red. **FIX 2:** a fixture sealed once with the pre-move AAD and the real `AesGcmSecretSealer`, opened through the production `composeSiteSavedKeys`; a wrong share id is refused. **M `hardcode-wrong-aad-domain`** → 3 red. |
| 2 | `codex/x7-admin-*` (incl. x6-admin) + rv1124d FIX 3, FIX 4 | **DONE** | merge `91f5fb0205`, FIX 3 `238e192f1a`, FIX 4 `d59758a224` (merged `caa3ac7811`) / `757373653` (merged `dc2349f51`) | Clean merge. **FIX 3:** RED was `ERR_MODULE_NOT_FOUND` on the deleted admin file. The import is now `@jini-ai/admin/shell/lib/assistant-daemon-activation`, resolved via `createRequire` from `apps/admin` because website has no admin dep (precedent `import-restore.unit.test.ts`). GREEN 12/12. A sweep of 100 deleted admin files found one more stale importer: `vendor-neutrality.test.ts` seams for the 2 plugin-surface files that moved to Jini (RED `ENOENT`, now 2/2). **FIX 4:** the classic/glass `admin.css` files are byte-identical to merge-21, and `--jini-admin-site-preview-bg: var(--tovu-site-preview-bg)` lives in the host bridge `lib/jini-admin-tokens.css`. New `jini-admin-tokens.unit.test.ts` was RED 3/3, now GREEN 3/3. **M `drop-alias`** → red. |
| 3 | `codex/bt3-*` + rv1124d FIX 5, 6, 7 | **DONE** | FIX 5 `9e131b3e4f` (+ moved to Jini during the merge), FIX 6 `446f4bc27b`, FIX 7 `2d135f592f`, merge onto x7 `b72111aa2b` / FIX 7 `aca90549c`, `ae67ee818`, FIX 5 in Jini `f8dedb8d4`, `8b519a442` | **FIX 5:** `.mov,.m4v,video/quicktime,video/x-m4v` added to the video and All-tab native pickers. x7 moved the rules, so the final change is in Jini `screens/media/rules.ts`. Jini test RED (`expected ['video/mp4','video/webm'] to include '.mov'`), GREEN 61/61. **M `drop-quicktime-from-all-tab`** → red. Todo row 115 is annotated, not ticked. **FIX 6:** one shared `createConvertingUploader` is used by admin direct upload, admin URL import and both assistant imports (`persistImportedMedia`). Pinned through each entry point: 4 RED, then GREEN. A failed conversion keeps the raw cause in the operator log only. **M `url-import-bare-upload`**, **M `leak-raw-cause`** → red. **FIX 7:** Jini `ResolvedMailer.effectiveProviderId({lane})` comes from the same resolution (`"console"` on the fallback). Tovu plans the test send from it, and the separate settings read was deleted. New pin "selection changes between settings read and resolution" was RED (`actual 'console', expected 'fake'`), GREEN 30/30, and the 4 mail files pass 56/56. **M `infer-from-settings-read`** → red. Existing `MAIL_TEST_APPROVAL_CHANGED` refusal pins are still green. Jini mail 393/393. Changeset `mail-effective-provider.md`. |
| 5 | owner decision: video-only upload cap 500 MiB | **DONE** | `d6752f9180`, `8208e7393a`, `9251ed48cf`, `0db3e9e035`, `fc558d1334`, `5ad18e8858`, docs `3e9dcf6dd1`, `eb3619cdbc`; merged onto bt3 `97a55649df` / `a7894709a`, `e4b864468`, `9abf2e1b2`, `a27133c09`, `7c0c6d48d`, `6426c0ae4`, `6151d2ce8`, N1 fix `b7e79e403` | **One source:** `@tovu/contracts/upload-limits` exports `VIDEO_UPLOAD_LIMIT_BYTES` (500 MiB), `UPLOAD_CAPS`, `uploadLimitFor`, `uploadLimitForFile`. **Jini:** `cms/media/upload-cap.ts` `resolveUploadCap` (optional `maxVideoUploadBytes`, default = general cap, so other hosts are unchanged). It is used by uploadMedia, replaceMediaFile, `media_upload_asset`, the admin replace route (cap checked after the sniff), duplicate-asset and import-media-entity. Chat uploader and daemon attachments take `maxAttachmentBytesFor`. **Tovu:** all upload/import/tool paths, chat attachments (client + server) and the local-file import pre-read gate (by extension; a renamed non-video is still refused by the sniffed cap). **Body limit:** 700mb applies ONLY to media upload/replace. Publish-content blob/bundle stays at 75mb (**M `global-700mb`** → red). **Tests:** RED `That file is 60 MB; the limit is 50 MB.` **M `video-cap-back-to-50`** (3 red), **M `image-gets-video-cap`** (2 red), **M `duplicate-ignores-video-cap`**, **M `local-import-flat-50`**. bt3's "fails if the cap is raised" pin was rewritten to the new invariant (video cap > conversion threshold, image cap unchanged), not deleted. `media_convert_video` is unchanged (card-free). Per-turn attachment total is now video + 50 MiB (550 MiB); the AssistantDock pin derives it from the source (`569b2fa545`). |
| 6a | `replace.test.ts` `captions: null` (9 red) | **DONE** | Jini `e4b864468` | Root cause: Jini `uploadMedia` built the record without `captions` while the repo reads back `captions: null`. The producer now sets `captions: null`, and the replace route uses the plain-words limit sentence. replace.test 16/16 and replace-file.test 24/24 (12 red on the bt3 base), with no test changed. **M** (remove `captions: null`) → 9 + 12 red. |
| 6b | `check:architecture` red | **PARTIAL** | `55fed8a9b0`, `bab2208956` (merged `8f5c62d3c3`), `e6f9117b1a` / — | **Fixed:** the 3 back-edges into the composition root (assistant → `composition/jini-routes.ts`) and the `assistant <-> server` cycle. `jini-routes.ts` + `request-facts.ts` (no composition policy) moved to `platform/express/`, 56 importers repointed, no shells. Back-edges 3 → 0, SCC 3 → 2. FIX 6's new `media-import → media/import-video-conversion` edge goes through `media/index.ts`. **Still red (pre-existing, not m21):** 43 "NEW cross-feature edge" rows. I ran the checker on merge-20 `b115aa29b` and it already printed 43 of them plus the same 0 → 3 back-edges. The baseline is file-level and has been stale since combine-19. 3 of today's rows are x6 repoints of existing feature pairs (`{entries,taxonomy,widgets}/publish-content.ts → publish-content/tovu-publish-ports.ts`, replacing the baseline's `repo-handler.ts` rows). Baseline untouched. Propagation cost (runtime-only, warning ratchet) 3.06 → 3.58. |
| — | why-comment debt from x6/x7 lanes | **DONE** | `53f7d33962` / — | 65 blocks lost vs merge-21. 62 were admin comments the lanes moved into Jini and reworded (de-branded) there. These got debt rows with the new Jini `path:line`, plus 11 rows for comments whose code changed and 5 whose code is gone. 2 json-body-parsers comments were restored in place. Tovu checker exit 0 (with `--other-root /home/user/Jini`), Jini checker exit 0. |

## Merge order (all pushed)
Tovu merge-21:
1. `6d01bc604` notes
2. `caa3ac7811` x7
3. `d03023bf98` x6
4. `8f5c62d3c3` arch
5. `b72111aa2b` / `d23dfa676b` bt3 + cap. These were resolved in worktree `integ/wip22-final`, then fast-forwarded.
6. `e6f9117b1a`, `53f7d33962`, `569b2fa545`, `6ded743aac`

Jini merge-21: `dc2349f51` x7 → `ca9a786c9` x6 → bt3 (`f8dedb8d4`, `8b519a442`) → `f36ab47ba` cap → `b7e79e403`.

Conflicts and how they were resolved:
- `admin-request-facts.ts` (x6 `servingOriginFor` + arch move): resolved.
- bt3 i18n: ported into the moved Jini dictionaries. The Library dictionary is now 45 keys; the exact-count assertion was updated, not loosened.
- `media/rules.ts`: deleted in Tovu, fix applied in Jini.
- Tool-metadata index: kept x6 + merge-21 + bt3 `media_convert_video`.
- Ledgers: union by id.
- cap × FIX 6: `createConvertingUploader` takes `caps` (`UPLOAD_CAPS`).
- Jini `create-daemon-attachment-uploader.ts` / `media-service.ts`: took the cap side.

WIP refs:
- Tovu `integ/wip22-{notes,x7,bt3,cap,final}`.
- Jini `integ/wip22-{x6,x7,bt3,cap}`.
- Tovu `integ/wip22-x6` / `integ/wip22-arch` were never pushed. Their pre-push desktop gates failed in contended runs; the same commits passed the gates on the merge-21 push.

## Gates (final)
**Jini** (`f36ab47ba`, then the comment-only `b7e79e403`):
- `pnpm -r --filter './packages/*' build` 0. `pnpm -r build` fails only in `examples/reference-desktop`: electron is not installed here.
- `pnpm typecheck` 0.
- `pnpm guard` 1: only the known BASE-RED `shell-failure-log.ts` HW3. The N1 product word that this run introduced is fixed.
- `api:check` 0 (`api:update` + changesets `video-upload-cap.md`, `video-aware-attachment-caps.md`, `mail-effective-provider.md`).
- `check:hooks` 0. `check-why-comments --base 7b2625f4d` 0.
- Changed vitest:
  - cms media 278 files
  - platform mail 393
  - admin screens library/trash/media 103
  - chat 29
  - daemon attachments 155
  - all green

**Tovu** (`d23dfa676b` for the full run; later commits are tests/docs and one import repoint):
- `npm run typecheck` (root + e2e) 0. Admin `tsc` 0.
- `check:hooks` 0.
- `check:boundaries` 0 errors, 141 warnings (was 144).
- `check:architecture` 1 (see 6b).
- why-comments 0 after `53f7d33962`.
- **Admin vitest** on 89 changed test files: 1546/1547. The one failure (the per-turn 100 MiB pin) is fixed in `569b2fa545` (175/175).
- **Website node tests** (changed tests + importers: 613 files, `--test-concurrency=2`): **UNFINISHED**. The runner hit its 30-min background limit at about 4,400 pass / 665 fail. That run overlapped Jini rebuilds by two workers, and re-running a sample of the failed files gave:
  - `authorize-guard` and `widgets-site-serving` pass now (transient).
  - `forms/common-fields.test.ts` was a real x6 stale import, fixed in `6ded743aac` (6/6).
  - `deployments/publish-agent-tools.unit.test.ts` imports the deleted `publish-credentials/repo.memory.js`. It is BASE-RED (missing on merge-21 too, deleted by `44d47bd5c0`).
  - `assistant/__tests__/tool-registrations.contracts.test.ts` has stale imports (`mail-status/delivery-agent-tools.js`, `members/agent-tools.js`), identical on merge-21 (BASE-RED).
  - **The remaining ~255 failed files were not re-triaged. The next combine must re-run them on a quiet machine against merge-21 base `68cb95192`.**
- **Desktop gates:** 6/6 PASS on the merge-21 base, and 6/6 PASS in the pre-push hook on `8f5c62d3c3` (the only push that changed `apps/desktop`: `desktop-agent.ts` import repoint). No `apps/desktop` change after that, so they were not re-run.

## UNVERIFIABLE-IN-CLOUD (check in the real app)
1. **Video cap:**
   - Upload a 60–500 MB `.mp4`/`.mov` in Media, in the chat composer and through an assistant URL/local import.
   - Check the web-safe MP4 conversion actually runs (real ffmpeg) and the original is kept.
   - A 60 MB image is refused with the plain-words sentence.
   - Watch memory on a 500 MB base64 JSON upload: the 700mb parser buffers it all.
2. **`.mov`/`.m4v` native picker:** they show in the Videos and All tabs (macOS Finder filter).
3. **Mail "Send test"** with a provider chosen but no key saved, in local mode: it no longer says "Mail configuration changed".
4. **SEO documents:** `/sitemap.xml`, `/robots.txt`, `/llms.txt` and `/feed.xml` return Content-Length, ETag and 304 behind the real proxy/CDN.
5. **Old share passwords** from a real pre-x6 backup still open.
6. **Admin site-preview background** (classic + glass themes) looks unchanged.
7. **Trash header copy** and **Library 50 MiB wording** in the moved Jini dictionaries, in a non-English locale.
8. **Postgres-server tests** (no socket here).
9. Everything carried from m21: release feed and updates, H4 kill-switch end to end, captions playback, held-back themes screen, FIX 10 POSTs, combine-20 carries.

## New bugs / notes
- `c21-web-suite-untriaged`: ~255 website test files red in a disturbed run. Not triaged (see gates).
- `c21-arch-cross-feature-baseline`: 43 pre-existing cross-feature rows (merge-20 already red). Fix at the source, or have the owner approve a baseline refresh of the pure repoints. Untouched.
- `c21-moved-vendor-neutrality`: the 2 plugin-surface files moved to Jini lost their vendor-word scan (Tovu seams removed). Consider a Jini-side scan.
- `c21-asset-transfer-no-conversion`: `features/asset-transfer/asset-destinations.ts` calls `persistImportedMedia` without `videoImport`, so asset transfers do not convert large videos. The reviewer did not name it, so it was left alone.
- `c21-conversion-note-not-surfaced`: the owner-facing conversion note is still only in the operator log. The upload response has no field for it (needs a Jini route change).
- `c21-text-vtt-picker`: Media picker accept intentionally excludes `text/vtt` (captions have no admin UI yet). Confirm.
- `c21-batch-550mib`: the chat per-turn total is now 550 MiB, so one full video fits. Confirm this is wanted.
- Stale test-only references: `development/scripts/error-gate-debt.json` row for the deleted `use-admin-surface-frame.hooks.ts`; the architecture baseline still lists the deleted `publish-content/{content-references,repo-handler}.ts`.

## FILES LEFT (combine-18 planner + P9 scan on the final tree)
moving **1,186** (ready 175, blocked 1,011), keep 353, theme areas 120. That is **1,186 / 1,066 excl. themes** (merge-21 base: 1,310 / 1,190).

Per area, files still Jini-bound (`src`; base → now; ready now):

| area | merge-21 base | combine-21 | ready |
|---|---|---|---|
| adm-other | 208 | 167 | 3 |
| theme | 88 | 88 | 32 |
| public-http | 95 | 86 | 6 |
| admin-http | 71 | 65 | 0 |
| adm-shell-components | 71 | 47 | 1 |
| agent-plugins | 45 | 45 | 8 |
| adm-posts | 40 | 40 | 5 |
| site-backup | 38 | 37 | 0 |
| adm-shell-lib | 39 | 35 | 11 |
| adm-themes | 32 | 32 | 10 |
| post | 30 | 30 | 11 |
| adm-security | 29 | 29 | 6 |
| contracts-core | 56 | 28 | 15 |
| deployments | 28 | 28 | 2 |
| adm-deployment | 24 | 24 | 6 |
| plugin-runtime | 21 | 21 | 1 |
| publish-content | 32 | 20 | 0 |
| adm-pages | 19 | 19 | 1 |
| custom-credentials | 15 | 15 | 3 |
| media | 13 | 15 | 2 |
| api-connections | 14 | 14 | 0 |
| trash | 14 | 14 | 1 |
| adm-publish-content | 13 | 13 | 3 |
| adm-shell-hooks | 14 | 13 | 0 |
| identity | 13 | 13 | 3 |
| source-control | 12 | 12 | 0 |
| external-mcp | 11 | 11 | 1 |
| site-export | 10 | 10 | 2 |
| adm-source-control | 9 | 9 | 0 |
| database-transfer | 9 | 9 | 4 |
| settings | 9 | 9 | 3 |
| forms | 8 | 8 | 0 |
| newsletter | 8 | 8 | 1 |
| pages | 8 | 8 | 0 |
| project-keys | 8 | 8 | 0 |
| webhooks | 8 | 8 | 2 |
| adm-members | 6 | 6 | 0 |
| publish-trust | 6 | 6 | 2 |
| vendor-credentials | 6 | 6 | 1 |
| adm-recovery | 5 | 5 | 0 |
| adm-roles | 5 | 5 | 0 |
| desktop | 5 | 5 | 3 |
| contracts-headless | 5 | 5 | 2 |
| database | 5 | 5 | 4 |
| site-inspection | 5 | 5 | 1 |
| platform-mail | 5 | 5 | 0 |
| adm-users | 4 | 4 | 0 |
| consent | 4 | 4 | 0 |
| content-types | 4 | 4 | 2 |
| form-destinations | 4 | 4 | 0 |
| fs-files | 4 | 4 | 0 |
| mail-status | 4 | 4 | 0 |
| member-login | 4 | 4 | 0 |
| navigation | 4 | 4 | 1 |
| publish-content-ui | 4 | 4 | 0 |
| taxonomy | 4 | 4 | 2 |
| widgets | 4 | 4 | 1 |
| asset-transfer | 3 | 3 | 0 |
| comments | 3 | 3 | 1 |
| entries | 3 | 3 | 0 |
| media-generation | 3 | 3 | 0 |
| members | 3 | 3 | 0 |
| presentation | 3 | 3 | 1 |
| recovery | 3 | 3 | 2 |
| web | 3 | 3 | 0 |
| platform-html | 3 | 3 | 3 |
| analytics | 2 | 2 | 2 |
| email-templates | 2 | 2 | 0 |
| mail | 2 | 2 | 0 |
| object-storage | 2 | 2 | 0 |
| skills | 2 | 2 | 1 |
| web-screenshot | 2 | 2 | 1 |
| content-duplication | 1 | 1 | 0 |
| image-transform | 1 | 1 | 0 |
| media-import | 1 | 1 | 0 |
| observability | 1 | 1 | 1 |
| permanent-delete | 1 | 1 | 0 |
| redirects | 1 | 1 | 0 |
| seo | 1 | 1 | 0 |
| server-logs | 1 | 1 | 0 |
| site-search | 1 | 1 | 0 |
| tool-audit | 1 | 1 | 0 |
| webmcp | 1 | 1 | 0 |
| platform-routing | 1 | 1 | 1 |
| **total** | **1310** | **1186** | |
