PARTIAL tovu 6b6df246a jini 3af075dc4: left — 13 SOL sheets Sol never built (Jini ST-17s.J, ST-6c.J, ST-1.J, ST-3.J; Tovu ST-6b.T, ST-6c.T, ST-10.T, ST-11b.T, ST-13.T, ST-15b.T, ST-15c.T, ST-17s.T, ST-17.T) + ST-9.T route mount; OPUS ST-11a.J PARTIAL (own branch), ST-2a.T PARTIAL (slice 4), ST-1.T, ST-3.T, ST-2c.T, ST-7b.T, ST-7c.T, ST-18a.T, ST-18b.T not built; ST-12b.T expiryChoices wire (Jini cms list body); ST-1a.T unverifiable in cloud

# P11 Storage budget — feature build (unattended cloud run, 2026-11-25)

- **Branches:** Tovu `integ/feat-p11-2026-11-25` and Jini `integ/feat-p11-2026-11-25`. Both are `integ/merge-21-2026-11-24` + the Sol branches (`codex/tv-f-p11`, `codex/f-p11j`), tested and fixed, + the OPUS sheets built this run. The working branch for both repos was `integ/wip-feat-p11`, pushed after every step.
- **Extra branch:** Jini `integ/wip-feat-p11-st11a` (`236aad6fd`) holds ST-11a.J, which is PARTIAL. It is **not** merged into the target (see the ST-11a.J row for why).
- **Programmer skill:** the coordinator read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. Every subagent brief required its Workflow 5a–5e loop: red, green, regressions, refactor. Each subagent says in the table whether it confirmed reading the file.
- **Who did the work:** Opus coordinated. Every OPUS sheet went to an `opus-high` subagent in its own git worktree. Each subagent had at most 50 tool calls, and no more than 4 ran at once. The coordinator did the Sol merge fixes, the migration pin and the OPUS-REVIEW mutation runs.
- **Setup:** Node 24.22.3. Jini: `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`, then `git fetch --unshallow` (the ST-7a donor `1b7dcff86` is not in a shallow clone). Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `JINI_PACKAGES_DIR=/home/user/Jini/packages npm run link:jini`; `prepare-desktop-hooks`; build `packages/{contracts,sdk}`.

## Sheet table

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| ST-7b.J maintenance running record | Sol | merged, green | Sol test `contested claim returns the maintenance record…` was broken (undefined helper `workspace`); fixed to `plainWorkspace`. Platform 51/51 changed tests. Sol-only sheet: named mutation not run |
| ST-8a.J chat cleanup contracts/store/routes | Sol (OPUS-REVIEW) | reviewed, green | all 9 named tests present and pass (`a token cannot be replayed…` lives in platform `preview-store.test.ts`). Mutations run by Opus: **drop pin recheck** → `pinned after preview is kept` red; **reselect by date** → `chat that became old after preview is not deleted` red. Full chat suite 4676/4676 |
| ST-8b.J required hooks + cleanup dialog | Sol | merged, green (**chat major**) | 68 changed chat tests pass. Lost why-comment (old "defaults to the real ones") allow-listed with a reason: the default no longer exists |
| ST-12a.J share-create expiry seam | Sol | merged, green | cms changed tests 15/15 |
| ST-12b.J share expiry controls | Sol | merged, green after fix | strict-tsc error in the `Select` onChange event type fixed. 2/2 |
| ST-13.J revision thinning engine | Sol (OPUS-REVIEW) | reviewed, green | 5 named tests. Mutation **drop undo protection** → 2 red (`published / restore / undo targets kept`, `undo reference added after preview is kept`). Findings: the injected `clock` is unused; the preview count includes protected/newest rows, so apply may delete fewer than shown (kept rows are named on apply). Not a safety issue |
| ST-15a.J storage report/cleanup specs | Sol | merged, green | 4 named tests. Platform `exports.test.ts` pin updated for `./retention/routes` |
| ST-17.J shared Storage panel | Sol | merged, green | 2/2 |
| ST-17s.J, ST-6c.J, ST-1.J, ST-3.J | — | **NOT BUILT** (absent from `codex/f-p11j`) | — |
| ST-2b.J retirement ledger | Opus (SOL sheet, Opus by the login rule) | DONE | `T-2b.4`, `T-2b.5` (200 random transition sequences) + 4 more. Mutation **invalidated→pending allowed** → T-2b.5 red |
| ST-7a.J restore SQLite compaction | Opus | DONE | 25 tests including both owner-rule (b) pins and all 10 named tests; db sqlite 132/132. Mutations **drop exclusive admission** → 2 red; **mark before verification** → 4 red. `nodeCompactionFs` deleted, `fs` required, `copying` state, convert split into admit/budget/copy/rewrite/mark |
| ST-8c.J attempt-base reader proof | Opus | DONE (report-only) | 18 tests including all named ones. Mutation **drop deadline predicate** → `recoverable attempt untouched` red. `ATTEMPT_BASE_READERS` lists the Jini readers only. The Tovu readers (`assistant-chats.ts:288`, run-finalizer entry/watch-state/stream/recovery-binding) were read, look safe, and are **UNPROVEN**: no host registration may pass the proof until they are tested |
| ST-11a.J fence every media byte writer | Opus | **PARTIAL**, on `integ/wip-feat-p11-st11a` only | 13 tests: 10 fence + 3 for the newly fenced import and blob-PUT writers. Mutation **in-process lock only** → `cross-process same-hash re-upload keeps the file` + 2 red. **Still unfenced:** `uploadMedia`/`claimUploadBlob`, rendition-service, replace-media-file, hydrate-from-seed, purge-side rendition journaling, post-write size/hash check. **Why it is not merged:** it is a cms major with new required deps (`blobFence`, `storageKeyFor`), and Tovu's blob-put and import bindings cannot supply them until ST-11b.T exists. The cms full-suite failures it showed also fail on the integ tree without it (pglite timeouts, boundary scans) |
| ST-2a.J partition interlock | Opus | DONE | 19 tests (all named ones + T-2a.13 over 6 orderings); desktop-host 998/998. Mutations **unknown→empty** → T-2a.6/.7 red; **sync JSON lock** → T-2a.12, T-2a.1 red |
| ST-2c.J partition pass + manual sign-in removal | Opus | DONE | 19 tests: T-2c.1–.9, both manual tests, fault injection at each named write. Mutation **skip post-rename recheck** → T-2c.3 + restore-rename fault test red |
| ST-6a.T site retention lifecycle | Sol | merged, green | `retention.test.ts` 5/5 (now 6/6 after ST-12b) |
| ST-9.T pinned chat migration + mounts | Sol (OPUS-REVIEW) | **PARTIAL**: migration done; the `mountChatCleanup` route mount was never built | Opus generated the pin `chat/0004_chat_pinned` with the updater (temporary uncommitted `pinned()` bypass, re-run without the flag; only that one line added). `fresh bootstrap = migrated schema`, `migration manifest is complete`, adopted SQLite parity, `no migration performs vacuum` all pass. Mutation **add VACUUM to 0004** → `no-vacuum.test.ts` red. Fixed the `openSiteChatDb` ledger expectation (now lists 0004) |
| ST-10.T admin chat cleanup UI | — | **NOT BUILT** | compile-only fix: `DockHeader` passes `hooks={defaultConversationListHooks}` (the prop is now required) |
| ST-6b.T, ST-6c.T, ST-11b.T, ST-13.T, ST-15b.T, ST-15c.T, ST-17s.T, ST-17.T | — | **NOT BUILT** (absent from `codex/tv-f-p11`); OPUS-REVIEW of ST-13.T/15c.T therefore not possible | — |
| ST-1a.T packaged Mac cache probe | — | **UNVERIFIABLE IN CLOUD** | needs a packaged Electron app on a Mac |
| ST-2a.T desktop interlock binding | Opus | **PARTIAL** (slices 1–3) | T-2a.3 (static scan), T-2a.4, T-2a.8, T-2a.14 (binding level only). Mutations **permit unheld guest** → T-2a.4 red; **unknown tracked→empty** → T-2a.8 red. Desktop gates 6/6 in pre-push. **Left:** required `beforeAddedRows` on the `updateProjectsFile` writer deps for add/adopt/discover/relocate/IPC/CLI/MCP (~20 fixtures); a CLI-level T-2a.14; `site-window.ts`/`app-window.ts` do not acquire on their own (they rely on the backend acquire and the sticky held set) |
| ST-2b.T retirement proof in erase arm | Opus | DONE | 6 tests: `T-2b.1` (real ledger, order capture→append→untrack), `T-2b.2` (adopted + protected-root created rows; cookie file byte-identical), `T-2b.3` (throwing erase, erase that leaves the folder, failing append), fail-closed capture, `production binding is not NO_RETIREMENT`. Mutation **record for untrack** → T-2b.2 red. Merge fix by the coordinator: one module-level ledger per profile, shared by the erase arm and the ST-2a.T interlock (which used `NO_RETIREMENT` until ST-2b shipped) |
| ST-1.T, ST-3.T | — | not built | they need ST-1.J/ST-3.J (unbuilt) and ST-1a packaged evidence; with no evidence nothing may be enabled anyway |
| ST-2c.T desktop boot pass | — | not built | waits for ST-2a.T slice 4 |
| ST-16r.T restore storage report CLI | Opus | DONE | 7 tests including all 5 named ones. Mutation **mkdir-capable share resolver** → `report does not migrate` red |
| ST-16.T stopped-site storage CLI | Opus | DONE (compact not advertised) | 9 tests including the exact running-site text, `clean does not migrate`, `--dry-run never deletes`. Mutation **writable before lease** → 5 red. `claimSiteRunning` gains `purpose = "serve"` |
| ST-7b.T, ST-7c.T | — | not built | they wait for G1–G3 sign-off + ST-7b.T compaction binding (ST-7a.J helper now exists) |
| ST-12a.T restore share expiry | Opus | DONE | 9 + 12 + 2 tests, including all named ones. Mutation **default 14 days** → `no expiry by default` red. Also fixed a pre-existing broken import in `site-shares.wire.test.ts` |
| ST-12b.T share expiry retention + controls | Opus (2 agents) | DONE, with one wire gap | Website: 9 tests, all 5 named. Mutations **expire rows without expiresAt** → `active link without expiry untouched` red; **unlink first** → `interrupted expiry retried` red. Admin: 10 tests (Expired label in 21 locales, poll never sends expiresInDays, Never default). Mutation **missing date = expired** → 2 red. Coordinator fixed one strict-tsc narrowing. **Gap:** the Jini cms list route body is `{ shares }`, so the admin never receives `expiryChoices`, and owners see Never only (fails safe) |
| ST-18a.T, ST-18b.T | — | not built | need ST-2c.T / ST-7b.T |

## Owner safety rules: pinning tests

- **(a) Logins never erased for a live or other site.**
  - Jini ST-2a.J: `T-2a.5/.6/.7` (unknown presence = skip), `unregistered process cannot acquire`, `T-2a.12/.13`.
  - Jini ST-2b.J: `T-2b.5 invalidated record never returns to pending`.
  - Jini ST-2c.J: `T-2c.1` (all four checks, each failing alone), `T-2c.2/.3/.4/.5`, `T-2c.6 ambiguous partition keeps Cookies`, `T-2c.8` crash restore, `manual sign-in removal without confirmation is refused`, `holder appearing after confirm keeps the partition`.
  - Tovu ST-2a.T: `T-2a.3`, `T-2a.4`, `T-2a.8`.
  - Tovu ST-2b.T: `T-2b.1 erase writes a record after the folder is gone`, `T-2b.2 untrack + re-add keeps the login`, `T-2b.3 failed erase writes no record`, `production binding is not NO_RETIREMENT`.
- **(b) No VACUUM inside a migration.**
  - Tovu `apps/website/src/platform/db/migrations/__tests__/no-vacuum.test.ts` scans every non-test `.ts` under `migrations/`; the mutation was caught.
  - Jini `packages/db/src/sqlite/__tests__/compaction.test.ts`: `step inside an open transaction throws` and `conversion refuses a handle inside a transaction`.
- **(c) Live share links never break.**
  - Jini `no expiry by default` (cms) and `active link without expiry untouched` (devops).
  - Tovu `share-expiry.unit.test.ts`: `no expiry by default`, `peer-uploaded row without URL or storage still served`.
  - Tovu `share-retention.unit.test.ts`: `active link without expiry untouched` (covers no-expiry, future, peer, failed and remote rows), `token stays reserved`, `download admitted just before expiry completes`.
  - Tovu admin `SiteExportTab.expiry.unit.test.tsx`.
  - Expiry is opt-in (Never is the default). Scheduled retention stays `scheduledDryRun: true`.
- **(d) No automatic chat deletion.**
  - Tovu `retention.test.ts` `no chat, revision, screenshot or media policy is registered`, now also scanning `retention.ts`, plus `the only serving policy is the share expiry pass, an old-copy class`.
  - Jini `delete-selected without confirm is refused` (chat-cleanup-routes), `pinned after preview is kept`.
  - The bulk delete never removes a pinned chat: the SQL also guards `pinned_at IS NULL`.

## Gates vs merge-21

| gate | merge-21 | this branch |
|---|---|---|
| Tovu desktop `npm run gates` | 6/6 PASS | 6/6 PASS in pre-push on the ST-2a.T push and 6/6 PASS on the final push (one earlier pre-push run failed the coverage gate on a flaky suite run; standalone the coverage run was 2076/2076, and the retry passed) |
| Tovu root `tsc` / admin `tsc` | 0 / 0 | 0 / 0 |
| Tovu check:hooks / boundaries / why-comments | green | green |
| Tovu node tests, P11-changed files + importers (105 files) | 101 red (no PostgreSQL in cloud; serve-wiring, boot-order and checksum source scans) | identical set, except for 1 new red (`openSiteChatDb` ledger list), now fixed.. Final run on all 30 P11-changed website test files: 361/361. Admin changed files + `features/sites`: 483/483 |
| Tovu migration `checksums.test.ts` | red (`0002_drop_empty_legacy_chat_tables changed after it was pinned`, `0012 activation…`) | same 2 red, pre-existing. New pin verified |
| Jini `pnpm typecheck` (strict) | — | 0 |
| Jini api:check | 0 | 0 (P11 baselines updated for core, platform, chat, cms, devops, admin, db, desktop-host) |
| Jini guard | 1 (HW3 `admin/src/shell/lib/shell-failure-log.ts`) | same 1, none new |
| Jini check:hooks / why-comments | ok / no base ref (fixed with `WHY_COMMENTS_BASE_REF`) | ok / ok (1 allow-listed) |
| Jini vitest | — | chat 4676/4676; db sqlite 132/132; desktop-host 998/998; platform 3497/3499 (2 red: `exports.test` pin, fixed; `source-boundaries` vs `durable-json.boundaries.test.ts`, pre-existing on merge-21) |

## UNVERIFIABLE IN CLOUD

- ST-1a.T: the packaged Mac Electron cache probe and its evidence JSON (`plans/evidence/ST-1a-electron-<ver>-<platform>.json`). These cannot be measured here:
  - the per-partition cache cap,
  - cookie, Local Storage and IndexedDB survival under `clearCache` and `clearCodeCaches`,
  - macOS update detection.
- So ST-1.T and ST-3.T stay disabled: no switch and no clear without GO evidence.
- No real PostgreSQL in the container. All `*.postgres.test.ts` and the PG halves of the dialect tests were red on merge-21 and still are. The two-connection PG lock tests (ST-13.T) could not be run.

## New bugs / notes

- Tovu `checksums.test.ts` is red on merge-21 (`0002_drop_empty_legacy_chat_tables` source digest mismatch). It may come from a newer source edit or from environment line endings. It needs owner triage.
- Jini platform `source-boundaries.test.ts` flags `src/fs/__tests__/durable-json.boundaries.test.ts`. Pre-existing on merge-21.
- Jini `check:why-comments` defaults its base to `origin/refactor/terra`, which no longer exists. Runs must set `WHY_COMMENTS_BASE_REF`.
- `@jini-ai/chat` is now a **major**: ConversationList `hooks` is required. Tovu consumes it through the local link. No release was published or tagged, so Tovu's manifest still says `^0.7.3-next.2`, and it must take the released major when one exists.
- `ShareExpiryControls` (Jini) always renders its Dismiss button and uses `copy.never` as the select's aria-label. Minor.
- ST-16r.T: `storage-report.ts` still reads with node:fs `readdirSync`/`statSync` directly, not an injected fs (read-only). A database kept outside the site folder now reports an unreadable size as `null`, so the desktop side must accept null.
- ST-12b.T: revoke and acknowledge do not take `shareMutex`. This is safe because both tombstones are create-only and revoked wins. Acknowledging an expired share answers 400 EXPIRED (410 may be wanted).
- ST-11a.J: the passthrough fence stub in `import-media-entity.test.ts` always reports `existing: null`, so that file no longer exercises the existing-blob branch.
- ST-16.T: a server starting during a `clean` attaches to the maintenance record. ST-7b.T must make serve wait (500 ms poll, up to 180 s).
