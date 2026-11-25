DONE 963b31ec3 a4f7cc26e

(SHAs are the code tips; the report commit sits on top of each.)
# feat-p5 (2026-11-25): P5 Import history, Tovu + Jini `integ/feat-p5-2026-11-25`

This was an unattended cloud run. Opus coordinated. Sonnet high-effort workers did the step-1 gate fixes (2 dispatches). Opus high-effort workers built T4.J and T4.T (3 dispatches). Never more than 3 ran at once. I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer, v1.7.5) first, and every brief carried its rules: root cause first, failing test first plus a named mutation, inject everything, fn ≤ 80 / complexity ≤ 10, no re-export shells, why-comments moved with code, no `--no-verify`.

- **Base:** Tovu `7c87b3c3f`, Jini `010c8cd87` (`integ/merge-21-2026-11-24`).
- **Merged Sol branches:** Tovu `codex/tv-f-p5` (`334478fee`), Jini `codex/f-p5j` (`7131f0684`). Both fast-forwarded with no conflicts.
- **Setup:** Node 24.22.3.
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` (root, admin, desktop, site-chat), then `JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini` and a build of `packages/{contracts,sdk}`.
- **Gate 0:** desktop `npm run gates` on merge-21 passed 6/6. After the work it passed 6/6 again.
- **Policy:** `cutoverPolicy` stays `"rollback"` (in `apps/website/src/server/runtime/composition/site-import-backend.ts`). No workspace cuts over in this build.
- **Rules held:**
  - No force-push, no `--no-verify`, hooks untouched.
  - No codebase-memory tools.
  - `main`, `plan/*`, `release/*`, `codex/*` and `integ/merge-*` were not touched. No tag, no publish.
  - No owner-data deletion path was added beyond the owner-decided automatic retention (the snapshot retirement, which by the sheet needs no approval card).
  - The sidecar DB `<ws>/site-imports.db` has its own runner and table `site_import_migrations`. The Tovu content chain is untouched.
- **Caps:**
  - Wall clock about 1 h 50 min. Coordinator about 125 tool calls.
  - Worker tool calls were 14, 37, 38, 43 and 47 (all under 50).
  - **Over the context cap:** three Opus workers went over the 120k context cap: T4.J 167k, T4.T part 1 133k, T4.T part 2 138k. Each finished its scoped sheet; none was cut off.

## Sheets

rev-p5 has no `SOL (OPUS-REVIEW)` sheets: all 6 Sol sheets are plain `SOL`. I reviewed the Sol code while fixing it; the findings are listed under "Review of the Sol code" below.

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| P5-T1.J payload namespace | Sol (`7131f0684`), fixed by Sonnet A (`0a68b5ae9`) | DONE | Sol's `payload-namespace.test.ts` 4/4. `ensurePayloadNamespace`/`expirePayloads` were split under the complexity cap. The 3 why-comments lost in the move were restored in Jini. |
| P5-T2.J SQL index, replay, paging, surfaces | Sol, fixed by me (`25106a44a`) + A | DONE | **Migration pin:** `483c2b21…549fb` = sha256(`IMPORT_INDEX_V1_DDL`), matching the reviewer's value. **HW3 module state** in `open.ts` → injected `createImportIndexIntegrityMemo` (4 tests). **M** shared module memo → 3 red. **Show more button slot** took a zero-arg `onPress` that the admin kit button cannot fill (admin tsc red). The slot is now the kit's two-object action, with a compile-time pin in the test. **M** old type → 1 tsc error. `rows.assertTransition`, `admitImport` and `openImportIndex` were split, and `replayFenceFor` de-duplicated. |
| P5-T3.J backfill | Sol, fixed by A | DONE | `backfill.test.ts` 8/8. The idempotent upsert from the sheet-check is present. `validateLegacyRow`/`deriveBackfillRows` were split under the cap. |
| P5-T1.T registry payloads | Sol (`334478fee`) | DONE | Covered by the site-backup suite. |
| P5-T2.T index seam + paged surfaces | Sol, fixed by me (`7311de91e`) + Sonnet B (`7eb06dc4c`) | DONE | **Golden catalog bytes:** the sheet said 762190, the real value is 762191 (only `catalog.bytes` differs, regenerated). The 4 copies of the "owner setup expired" projection became one `projectExpiredOwnerSetup` (4 tests; **M** `>=`→`>`, **M** drop the status check → red). Admission and paging were split under the cap (**M** drop `reset` on INVALID_CURSOR → red). |
| P5-T3.T legacy scan binding | Sol | DONE | `import-history-retention.unit.test.ts` green. |
| **P5-T4.J** mode, fence, retirement | **Opus C** (`2cbeb396f`, `063c98530`, `228d17f7e`) | DONE | 53 import-index tests. All 11 sheet titles are verbatim, plus 12 extra tests and 2 real temp-dir tests (fence order on real disk; 205 real files retired as 200 + 5 with resume, keeping a newer-mtime file, a uuid-named symlink and non-history files). Every sheet mutation went red: stale JSON, open without fileMustExist, state after commit, refuse pre-write missing DB, bypass replay, skip db_id, `>`, retire in cutover, drop mtime, drop evidence check, future schema = corrupt, generic `.json`, witness before state. `IMPORT_HISTORY_MISSING` 503 has the exact copy. Changeset `p5-t4-import-index-mode.md`. API baselines core/devops/cms regenerated (`a4f7cc26e`). |
| **P5-T4.T** bind authority, rollback, retire, docs | **Opus D1** (`172656807`, `3d97a808f`) + **Opus D2** (`e8aa35cc0`, `3bb415949`, `1326a6b69`, `963b31ec3`) | DONE | `import-history-mode.integration.test.ts` has **21 real-disk tests with real SQLite**. All 10 sheet titles are verbatim, plus: a refused read or locked entry touches nothing; corrupt and missing pre-write DB with WAL/SHM are quarantined (all three moved, none deleted); a state-write failure before admission leaves no SQL row and no witness; a refused process creates no `payloads/`; all 7 backend methods plus CLI tidy fail typed and touch nothing; a legacy put is refused after another process moved authority; tidy retires. 21 mutations, each → red (tables in the commit messages and worker reports): refusal served as legacy, no fileMustExist, beforeWrite no-op, skip db_id, witness ignored, future = corrupt, invalid state read as missing, quarantine main-only, witness before state, no read-only pre-check, no refusal before namespace, no CLI mapping, no `available()` guard, no `confirmLegacyAuthority`, no retire in tidy, refuse pre-write missing DB, `>`, retire in cutover, drop mtime, generic `.json`, skip replay lookup. README Wiring section (ADR-071 cite, host binding example, forbidden imports, detection limits). Release note `ADS-memory/specs_as_built/changelog/p5-import-history-downgrade.md` (`11b8505c8`). |

**Test-first deviation:** D1 wrote the binding before its tests. Its 10 mutations each turned a named test red, so the tests are proven able to fail. D2 wrote the 5 new behaviour tests first and saw them red. The 6 sheet tests D2 added passed on first run, because the Jini half already had that behaviour.

## Bugs found and fixed (all with a failing test first or a red mutation)

1. **Quarantine lost the WAL/SHM.** A read-write open of a damaged pre-write DB made SQLite delete `-wal`/`-shm` on close, before quarantine could move them. The locked open now validates read-only first. **M10** → quarantine test red.
2. **A refused process still touched disk.** `SiteImportRegistry.exclusive` ran `ensurePayloadNamespace` before the refusal check, so a refused process created `payloads/` and moved legacy payloads into it.
3. **CLI `tidy` printed a raw error and stack** for history errors. It now prints the plain-words message.
4. **Interruption tests broke silently.** The child-process backend in `import-interruption.fixture.ts` had no authority, which `tsc` cannot see. 8 interruption tests went red until the authority was added.
5. **Show more button slot type** was unusable with the real admin kit button (admin tsc red).
6. **Module-level integrity memo** in Jini `open.ts` (guard HW3).
7. **Golden byte count** off by one in the sheet.

## Review of the Sol code (OPUS review)

- **Sol tests use fakes.** The Jini-side Sol tests drive fake DB objects. Real-SQLite behaviour is now proven only at the Tovu binding, by D1/D2's 21 real-disk tests. The Jini devops suite has no real-driver test, because the package must stay driver-free.
- **Double resolve in `backend.get`.** It resolves authority twice: `registry.get` and then the view projection. It is harmless, but two fresh opens per get. Logged, not changed.

## Gates vs merge-21

| gate | merge-21 | feat-p5 |
|---|---|---|
| Tovu desktop `npm run gates` | 6/6 PASS | 6/6 PASS |
| Tovu `tsc -p tsconfig.json` | 0 | 0 |
| Tovu admin `tsc --noEmit` | 0 | 0 (was red after the Sol merge; fixed) |
| Tovu `check:hooks` / `check:boundaries` | ok / ok | ok / ok (0 errors, 143 warnings) |
| Tovu `check:why-comments` (base merge-21, other root Jini) | — | 0 blocks lost (Sol lost 4; restored) |
| Tovu `check:complexity` | red | red only on the same 5 untouched files: themes `use-held-back-themes`, `jini-admin/modules.hooks`, `agent-plugins/public-config`, `newsletter/confirmation`, `site-dir/site-databases`. 0 P5 entries (Sol added 5; fixed). |
| Tovu node tests: site-backup (all), its integration dir, import-local CLI, site-import routes, route-errors, moved-tools golden | — | 1374 tests: 1371 pass, 1 skipped, 2 fail. The 2 failures (`import-restore` "import keeps starter radio…" and `library-share.integration` ERR_MODULE_NOT_FOUND `features/members/index.js`) also fail on merge-21 in a clean worktree. |
| Tovu admin vitest `src/features/sites` | — | 498/498 |
| Tovu `check:openapi-contract` (after the Sol merge) | — | 437/438. The 1 mismatch is `disable_user` 403 vs 404, which P5 does not touch. |
| Jini `typecheck` | 0 | 0 |
| Jini `api:check` | 0 | 0, with baselines regenerated for core/devops/cms. Pre-existing admin/user-management additions were left as they were. |
| Jini `guard` | 1 violation (admin `shell-failure-log.ts` HW3) | the same 1 (Sol added `open.ts` HW3; fixed) |
| Jini `check:complexity` | 12 pre-existing | the identical 12 (diffed), 0 import-index |
| Jini `check:hooks` / `check:why-comments` (base merge-21) | ok | ok / 0 lost |
| Jini devops vitest `src/backup` | — | 113/113 |
| Jini cms vitest `admin-http/routes/system` | — | 273/273 |
| Jini core vitest | — | 3146/3149. The 3 failures are in `tool-metadata/provider-neutral.test.ts`; P5 changed no file under `core/src/tool-metadata`. They were not re-run on merge-21. |

## UNVERIFIABLE-IN-CLOUD (must pass before flipping `cutoverPolicy` to `"enable"`)

The flip is one line in `apps/website/src/server/runtime/composition/site-import-backend.ts`. Opus lands it only after all of these pass in **Chrome (dev server) and the packaged Electron app** on a **copy of a real legacy `site-imports/<ws>/` folder**:

1. **First locked import on enable:** backfill, then the state file `import-index.state.json` (0600) says `cutover`, and `site-imports.db` exists at 0600. The Admin import list is unchanged in content and order.
2. **Show more:** with more than 50 imports, Show more appends the next page with no duplicates. A stale cursor shows "This list of imports changed…" and reloads. The `site_import_list` tool pages with `cursor`.
3. **Owner setup after a pre-write rollback:** start an import that stops at owner setup, flip back to `"rollback"` before any indexed write, restart, then complete owner setup. The site is created and the stage in `payloads/` is kept until then.
4. **Restart replay:** after an indexed write, restart the app and repeat the same request (same requestId). The stored site comes back and no second site appears in the switcher.
5. **Missing indexed DB:** delete or rename `site-imports.db` after an indexed write. Every import surface (upload, import, list, Show more, get, owner setup, desktop tidy) shows "Import history is missing, so imports are paused…". The app never falls back to the old list, and nothing on disk changes.
6. **Crash ordering on real disk on macOS (APFS) and Windows (NTFS):** kill the process right after the state write and before the first SQL write (failure before the first SQL mutation). On next start the state is `indexed`, the witness `.history-indexed-v1` exists, and imports keep working through the index. The directory-flush limits of `fsyncDir` on Windows need a look.
7. **Packaged-app paths:** state, witness, DB and quarantine all live under the app-data workspace root, never under a served or source tree. Electron's sandbox can create the quarantine dir.
8. **Retirement:** not reachable in a manual check (30 days); it is covered by real-disk tests only. P11 schedules tidy.

The real-disk crash-ordering tests in this run cover Linux ext4/overlay only.

## New bugs logged (not fixed)

- **Pre-existing:** Tovu `library-share.integration.test.ts` imports a missing `features/members/index.js`.
- **Pre-existing:** Tovu `import-restore.unit.test.ts` "import keeps starter radio…" fails in Jini `admin/src/forms/html-rules.ts:181`.
- **Pre-existing:** Tovu openapi `disable_user` returns 404 where the spec says 403.
- **Pre-existing:** Jini core `tool-metadata/provider-neutral.test.ts` has 3 failures.
- **P5, minor:** `backend.get` resolves authority twice.

## Commits

Jini (`integ/feat-p5-2026-11-25`), in order:
- `7131f0684` Sol
- `25106a44a`
- `2cbeb396f`
- `063c98530`
- `228d17f7e`
- `0a68b5ae9`
- `a4f7cc26e`
- report copy

Tovu (`integ/feat-p5-2026-11-25`), in order:
- `334478fee` Sol
- `7311de91e`
- `11b8505c8`
- `6ce2356b1`
- `7eb06dc4c`
- `172656807`
- `3d97a808f`
- `e8aa35cc0`
- `3bb415949`
- `1326a6b69`
- `963b31ec3`
- this report

WIP refs (same history): Tovu and Jini `integ/wip-feat-p5`.
