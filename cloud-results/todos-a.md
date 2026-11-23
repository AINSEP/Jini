DONE 0f6cf35d5f 38e145427

# TODO lane A — 2026-11-23 (UTC 19:58–21:00)

**Branches:** Tovu `codex/todos-a-tovu` (base `origin/integ/merge-13-2026-11-22` @ `f7185f153`), Jini `codex/todos-a-jini` (base `origin/integ/merge-14-2026-11-22` @ `4902a6a1`). Jini was linked into Tovu with `link-jini.mjs` (Setup as in `combine-13-tovu.md`).
**Programmer skills:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Its rules were applied: red-first test per slice, named mutations, an architecture check per diff, and fresh evidence before claiming done.

## Scope: which items lane A took
- Source: `origin/plan/whats-left-1122:inputs/todos-triage.md` Part A, the **checkbox** items.
  - Part B is plain bullets, not checkboxes.
  - Items marked DONE, DROPPED, parked, OPEN-backlog or "later" were left out.
- What was left: 20 active OPEN groups in file order. Lane A took the first 10:
  - §1 .MOV gap; §1 update deployed site; §1 CRITICAL email.
  - §4 New-site password; §4 Vendor code remainder; §4 Email (active rows); §4 Media descriptions.
  - §5 UI/UX plugin; §5 WebMCP; §5 Rescued.
- The second half starts at "§5 08-10 slice":
  - 08-10 slice, Reliability, Agent capability, Cookie consent.
  - The inventory rows 1624, 1630, 1632, 1685, 1688, 1748, 1749, 1755, 1783 and 1822.
- Line numbers below are the triage's. Text is from `development/todos.md` on the Tovu base.

## Items

| item id | status | commit | test name |
|---|---|---|---|
| 102 Accept `.mov`/`.m4v` | **FIXED** (Jini + admin). See the AFTER-COMBINE rows below for the other upload paths. | Jini `9aea2fc70`; Tovu `cf77668a74` | `sniffContentType: QuickTime and M4V ftyp major brands are video/quicktime and video/x-m4v`; `uploadMedia accepts .mov and .m4v originals as-is and records their sniffed video type`; `accepts QuickTime and M4V bytes past the container guard`; admin `offers QuickTime (.mov) and .m4v next to MP4/WebM on the Videos and All tabs, never on Images`; `warns only for QuickTime that the browser may not play it`; `QuickTime playback note > shows the note on a QuickTime card only` |
| 102 rest | AFTER-COMBINE | – | `media-import/fetch-image.ts:93` still allows only mp4/webm, so assistant URL imports of a .mov are still refused. `site-backup/archive-media.ts:17` has no `mov`/`m4v` extension. Both files are on in-flight branches. |
| 104 Transcode to web-safe MP4 | **FIXED** (Jini port + adapter + rule) / AFTER-COMBINE (Tovu import hook) | Jini `e2fbab44b` | `shouldTranscodeOnImport keeps a video of exactly 50 MiB as-is`; `…transcodes a video one byte over 50 MiB`; `convertMediaVideo stores the web copy as a new item and leaves the original untouched`; `a real ffmpeg turns a QuickTime clip into a faststart MP4` (real ffmpeg in the container: avc1 + mp4a, moov before mdat) |
| 107 Assistant-callable conversion tool | **FIXED** (Jini) / AFTER-COMBINE (Tovu registration: `features/media/tool-registrations.ts` is in-flight) | Jini `e2fbab44b` | `media_convert_video is absent when the host provides no transcoder`; `…is present with a transcoder and asks the owner for approval`; `…creates a separate web copy and reports both ids` |
| 108 One size limit, stated in the error | **FIXED** (admin Library + Media: one 50 MB limit and the plain sentence in 22 locales). The composer and server parts are AFTER-COMBINE. | Tovu `cf77668a74` | `refuses one byte over the limit and accepts a file exactly at it`; `translates the refusal, keeping the number, in every admin locale`; `refuses a file one byte over the shared 50 MiB cap but accepts one exactly at it`; `refuses a file one byte over 50 MiB in the dialog, in plain words, and accepts exactly 50 MiB` |
| 108 rest | AFTER-COMBINE | – | (1) `AssistantDock.hooks.unit.test.tsx:1552`, plus `composer-files.hooks.ts` taking the shared sentence. The composer already caps at 50 MiB; only the wording differs. I backed this change out because it turned the in-flight test red. (2) `library/hooks/use-library.hooks.ts:112` still says "Larger than 10 MiB.", and its test at `:63` pins that. (3) `Library.tsx:132` helper text says "up to 10 MiB each". (4) `AssistantDock.state.hooks.ts:149` should pass the locale. (5) The server `routes/media/upload.ts:120` message. |
| 112 "Update available" check | **FIXED** (Jini contract + `checkForUpdateFromFeed`) / AFTER-COMBINE (Tovu notice + release-feed adapter; `deployments/**` and `site-backup/**` are in-flight) | Jini `437e9a0fe` | `returns the newer release with its notes`; `returns null when the running version equals the latest release`; `compareSiteVersions` (15 ordering cases incl. `0.7.3-next.2 < 0.7.3`) |
| 113 One-click/chat update | **FIXED** (Jini orchestrator `runSiteUpdate`) / AFTER-COMBINE (Tovu deploy adapters + approval card) | Jini `437e9a0fe` | `happy path runs backup, readiness, apply, verify in that order and reports what changed` |
| 117 Safety: backup, readiness gate, rollback, never auto-update | **FIXED** (in the Jini orchestrator) | Jini `437e9a0fe` | `refuses without an approval and calls no port at all`; `a blocked readiness gate stops before any deploy and says why`; `a failed verify rolls back to the kept previous version`; `a failed apply rolls back, because the deploy may have half-landed` |
| 122 Desktop + self-hosted same path | AFTER-COMBINE + NEEDS-OWNER | – | The port is host-neutral, so a desktop or self-hosted adapter plugs into the same `runSiteUpdate`. The adapters need `deployments/**` and the desktop app, both in-flight (ex7-deploy-desktop). **Question (G7-11):** should a self-hosted site update by bumping its image tag? **Recommendation:** yes, with the same approval card. |
| 256 CRITICAL: tovu.dev sends no email | NEEDS-OWNER | – | Production config, excluded from this run. **Recommendation:** on tovu.dev, connect the Resend plugin, save the key there, verify the domain and send one test. |
| 833 New-site password flow | NEEDS-OWNER | – | **Recommendation (P10 G7-1):** keep the desktop default; server sites ask for a password at setup. |
| 839 LiPay manifest still in core | NEEDS-OWNER | – | Commerce wire-in (owner-gated). **Recommendation:** move it with the commerce restart. |
| 844 Email phases 2–5 | NEEDS-OWNER | – | Email is parked (owner 10-22) and production email is excluded. **Recommendation:** plan phases 3–5 when email is un-parked. |
| 845 Template `{{fields}}` data source | NEEDS-OWNER | – | Inside the parked email section. **Recommendation:** one render check when email resumes. |
| 847 Delete sent-email records after 30 days | NEEDS-OWNER | – | **Recommendation:** yes. |
| 848 Auto-delete captured test emails | NEEDS-OWNER | – | **Recommendation:** yes, after 7 days, plus "clear all". |
| 849 Guided "Connect email" flow | NEEDS-OWNER | – | Parked email, and UI (the UI pass runs after the lanes land). |
| 850 tovu.dev Resend key/sender/domain | NEEDS-OWNER | – | Production action. Same as 256. |
| 866 Media description for search | **FIXED** (Jini) / AFTER-COMBINE (Tovu persistence) | Jini `3ded2a6bc`; Tovu `9eaafa36bc` (publish carries the field) | `updateMediaMetadata sets, keeps and clears description`; `description is capped at MEDIA_MAX_DESCRIPTION_LENGTH on update and upload, and nothing is written`; `media search finds an asset by its description, case-insensitively, and tolerates rows with none`; `media_update_metadata passes description through to the record and returns it on the view`. **After combine-15:** a nullable `description` column in `schema.sqlite.ts`/`schema.postgres.ts` plus a migration; mapping in `platform/db/repos/media-repo.ts` (in-flight); `routes/media/update.ts` accepts it; the view_image/import tools fill it. |
| 876 Each theme owns its `/` layout + Promote | NEEDS-OWNER | – | Design questions plus a UI pass. **Recommendation (G7-12):** park until the owner designs it. |
| 1080 Admin agent tags the HTML pages it creates | NEEDS-OWNER | – | **Question:** guidance only, or a post-save pass? **Recommendation (G7-13):** run the pass only on owner request. |
| 1329 Attachment preview modal never seen rendering a decoded image | UNVERIFIABLE-IN-CLOUD | – | Needs a Chrome look in the owner's localhost (P10 group 8, item 2). |

## Named mutations (each applied, red seen, reverted byte-exact with `cmp`)
- Jini `video/quicktime` removed from `DEFAULT_ALLOWED_MIME_TYPES`: the .mov/.m4v upload test went red.
- Transcode threshold changed from `>` to `>=`: two tests went red.
- Post-transcode abort check dropped: red.
- Rollback on a failed link disabled: red.
- `description` dropped from `applyMetadataEdits`: red.
- `description` dropped from the `listMediaPage` search filter: red.
- `runSiteUpdate` with the readiness gate skipped: 7 tests went red.
- Approval check dropped: 2 tests went red.
- Admin `LIBRARY_MAX_BYTES` back to 10 MiB: red.
- Admin `VIDEO_ACCEPT` back to mp4/webm: red.

## Gates (compared with the base; no new red)

**Jini**
- `pnpm -r build` (base): 0.
- Build of cms + devops at the tip: 0.
- `pnpm guard`: 0 at base and at the tip.
- `pnpm typecheck`: 0 at the tip.
- `pnpm api:check`: clean after `api:update`. The cms and devops baselines record **additions only**: new exports and optional fields/union members.
- Vitest:
  - cms media: 48 files, 605 tests, all pass.
  - devops `src/deploy`: 27 files, 275 tests, all pass.
  - Whole cms package: 5053 pass, 1 fail. The failure is `forms/src/__tests__/package-boundary.test.ts`, which expects `0.7.3-next.2` but finds `0.7.2`. It is a package-version pin on a file this run never touched.

**Tovu**
- Root `tsc --noEmit`: 0.
- `typecheck:tests`: 0. It was **1 before the fix**: Jini's new optional `MediaRecord.description` tripped the exhaustive `MEDIA_FIELDS` map in `features/media/publish-content.ts`. Fixed in `9eaafa36bc` (description travels, like caption).
- Admin `tsc`: 4 errors at both base and tip. They are the same `jini-kits.ts`/`main.tsx`/`render-with-jini-kits.tsx` `Icon`/`useT`/`values` mismatches against linked Jini merge-14, in files this run did not touch.
- Admin vitest on the changed files and their importers (library, media, lib/upload-limit, untranslated-copy, AssistantDock.hooks): 34 files, 744 tests, all pass.
- Full admin suite (run by the subagent): 6 base reds.
  - They fail identically in a clean worktree at `f7185f153`: JiniMediaPicker.hooks ×3, admin-literal-copy, credential-input-autocomplete, dictionary-lookup-sinks.
  - The offender lists of the two source-scanning tests have the same md5 at base and tip.
- Website node tests on importers of the changed Jini media code: 218 tests, all pass.
  - publish-content apply/write/overwrite/characterization: 64.
  - upload-content-type, media tool-registrations, agent-upload-sniff: 9.
  - All of media-import: 145.

## Commits
- Jini `codex/todos-a-jini`:
  - `e2fbab44b` (transcode).
  - `9aea2fc70` (.mov/.m4v).
  - `3ded2a6bc` (description).
  - `437e9a0fe` (site-update contract).
  - `38e145427` (api baseline).
- Tovu `codex/todos-a-tovu`:
  - `8cff2597ba` (wip snapshot).
  - `cf77668a74` (reviewed admin limit + accept).
  - `9eaafa36bc` (publish-content description).
  - `0f6cf35d5f` (todos.md notes).
  - The report commit is on top.

## Notes for the combine
- **Behaviour change:** a stored file with the `ftyp qt  ` major brand that is sniffed again now reads `video/quicktime`, not `video/mp4`. Chrome plays fewer QuickTime files, which is why the "may not play in Chrome" note exists.
- Classic QuickTime files without `ftyp` are deliberately not claimed. There is a why-comment in `content-type-sniffer.ts`.
- `convertMediaVideo` links the copy to its original through a host port (`linkDerivedMedia`), because `MediaProvenance` has no "derived" kind yet. A follow-up could add `{ kind: 'derived', fromMediaId, transform }` to provenance and drop the port.
- `findVideoBinaries` needs nice + ffmpeg + ffprobe. A host missing ffprobe, and Windows, get "Video conversion needs ffmpeg on this computer." **Owner question G7-10:** bundle ffmpeg? **Recommendation:** no; keep the local-binary adapter.
- `cms/src/forms/field-registry.ts:65` has its own mp4/webm extension map. Check whether form uploads should take .mov too.
- `runSiteUpdate` rollback is deliberately not abort-gated: by then a broken version is live, so a cancel must not stop the rollback.
- Subagents: 4 ran in parallel, all Opus high (upload validation, subprocesses and deploy safety were in scope). The coordinator split shared files by hunk, finished the two description pieces that were blocked in files another agent owned (`list-page.ts`, `tool-registrations.ts`) red-first, and committed each item.
