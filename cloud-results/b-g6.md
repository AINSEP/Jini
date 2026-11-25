PARTIAL e9a1c4322a 6d8b156fb3: left R01 R02 R03 K01 K02 K03 K03a K04 K05 K06 G01 G02 G03 G04 G05 G06 G07 G08 G09 G11 G13(stale) G14 G15 G16 G17 G18 G22 G23; rest of R05 R07 R09 G10

# b-g6: architecture cross-feature fixes, rule breaks, splits

Run from 2026-11-25 06:57 to 08:57 UTC (2 h, unattended cloud run).

**Branches.** Tovu and Jini both have `integ/b-g6-2026-11-25`. It equals `integ/wip-b-g6`, and it is built as merge-21 plus the Sol branches plus this run's work. The SHAs on the first line are the code heads; this report sits one commit on top of each.

- Tovu: `integ/merge-21-2026-11-24` (`7c87b3c3f`), then `codex/tv-b-arch` (`c59d8c5ef`), then this run (code head `e9a1c4322a`).
- Jini: `integ/merge-21-2026-11-24` (`010c8cd87`), then `codex/b-archj` (`9ce4aa2ff`, fast-forward), then this run (code head `6d8b156fb3`).
- Untouched: `main`, `plan/*`, `release/*`, `codex/*`, `integ/merge-*`. No force-push, no `--no-verify`, no tag, no publish, no codebase-memory tools.

**Programmer skills.** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. The work follows it: test first, root-cause debugging, coding-foundations and testable-design, the coverage-integrity policy, and why-comment preservation.

**Setup.**
- Node 24.22.3.
- Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link:jini` (needs `JINI_PACKAGES_DIR=/home/user/Jini/packages`); hooks; and a build of `packages/{contracts,sdk}`.
- Builders worked in their own Tovu git worktrees under `/home/user/wt/*`, with `node_modules` symlinked from the main checkout.

## Sheet table

| sheet | built by | status | tests + mutation |
|---|---|---|---|
| R06.J | Sol, reviewed by Opus | DONE | json-event-stream pins. `M-swap-required-fields` turned 3 tests red. |
| G12 | Sol | DONE | template-byte-parity 2/2 (vitest). `M-drop-template-final-newline` turned 1 red. |
| G13 | — | NOT BUILT: sheet is stale | Sol did not build it. On merge-21, neither `content-duplication/agent-tools.ts` nor `media/tool-registrations.ts` has a size or complexity debt row. The duplication catalog is a single tool with no replace/import operations to split. Upload caps live in `uploadMedia`, not in `mediaUploadHandlers`. Needs a re-sheet. |
| G20 | Sol | DONE | session.handlers 87 tests. `M-rpc-cleanup-falls-through` turned 1 red. |
| K03a | — | NOT BUILT | Depends on K01, which was not built. |
| A07 | Sol | DONE | Forms and post duplicate pins pass. Opus did not re-run the mutation. |
| A09 | Sol, fixed by Opus | DONE | Fixed a name clash: `AssetToolDeps.resolvePublicUrls` clashed with `MediaToolDeps.resolvePublicUrls` and broke tsc. The field is now `resolveImportedMediaUrls` (`4e24eb31e`). Media pins pass. Opus did not re-run the mutation. |
| A13 | Sol | DONE | cms-search. `M-search-use-raw-row` turned 8 red. |
| R04 | Sol, fixed by Opus | DONE | Fixed the AdminExecutionMode test's hook spread, which overrode the desktop policy, and changed the AgentPlugins/AiAssistant root hooks to `props.` access. Hook debt went down by 26. Admin 33 files / 655 tests pass. The typecheck pin uses `@ts-expect-error`, and admin tsc is green. |
| R06.T | Sol, reviewed by Opus | DONE | held-back-themes. `M-swap-required-fields` turned 1 red. |
| R08 | Sol | DONE | no-ports-shell. `M-restore-tovu-oauth-shell` turned it red (0/1). |
| A15 | Sol, reviewed by Opus | DONE | The diff removes exactly 12 edges and 1 debt object, with no additions. `check:architecture` and `check:errors` are green. |
| A01 | Opus builder | DONE (`b4920d0f5`) | Closes 12 rows, plus row 40 as a side effect. Bag slices are parameterized. New `platform/publish-contracts.ts`, and the `post/contracts.ts` shell is deleted. `M-publish-bag-snapshot` turns the active-theme pin red. |
| A02 | Opus builder | DONE (`2d0a8f2cf` code, `a6ce69cfa` pin) | Closes 5 rows. The new pin file has 3 tests. `M-unscoped-vault-reader` turns 2 of 3 red. |
| A03 | Sonnet/Opus builder, last row by Opus | DONE (`adecfc491`, `37ab8b0b2`) | Closes 5 rows: a required `assetHost` port plus `themeImportFetch`. `M-theme-check-after-write` turns the no-write pin red. `M-copy-cap-drift` turns 2 red. `M-theme-fetch-policy-copy` turns 1 red. |
| A04 | Opus builder | DONE (`f82b172d6`) | Closes 4 rows. `M-write-before-target-check` turns 1 red. The builder's own abort-guard bug was caught by an existing test and fixed before commit. |
| A05 | Opus builder | DONE (`d9abaeb75`) | Closes row 12. `M-repair-fallback-on-registry-hit` turns 4 of 13 red. The postgres variant was updated but cannot run here. |
| A06 | Opus builder | DONE (`4e710e1ab`, `457a63e0d`) | Closes row 13. `M-link-uses-default-workspace` turns 11 red. |
| A08 | Opus builder | DONE (`4dff6ba6f`) | Closes row 17. `M-capture-clear-before-confirm` turns 6 of 8 red. |
| A10 | Sonnet builder | DONE (`7d75ebf67`) | Closes row 26. `M-provision-from-cwd` turns 2 red. Opus reworded the why-comment debt (`65ac50b1c`). |
| A11 | Opus builder | DONE (`7f4a95a63`) | Closes 3 rows. The production `selection ??` fallback is removed. `M-import-missing-soon-policy` turns 1 red. |
| A12 | Opus builder | DONE (`707d74b27`, `3bc2ad943`) | Closes rows 31 and 33. `M-restore-skip-containment` and `M-share-default-search-config` each turn their pin red. |
| A14 | Opus builder | DONE (`cc1db295f`, plus fixture follow-up `e9a1c4322`) | Closes 2 rows. `M-widget-spread-post-repo` turns 2 red. |
| R05 | Opus/Sonnet builders | PARTIAL | Jini canaries (`5f4f4aa98`): CommentsPage and EditMediaPanel take a required hook, with typecheck pins. Restoring the default fails tsc with TS2578. Tovu checker (`278b0a315`): accepts body-destructured and aliased required prop hooks, and the fix hint now recommends a required prop. `M-checker-accept-default` turns 11 of 19 red. **Left:** about 537 candidates, the Jini checker, and `useCommentsHook` / `LibraryTab` defaults. |
| R07 | Sonnet builder | PARTIAL (merge `ba9b3801c`) | 5 Tovu exports converted (assistant-daemon-client ×4, `isAbsent`). The audit lists 41 flags; the list is in the builder notes below. I dropped the builder's 2 migration-file conversions: migration sources are checksum-pinned. `M-drop-optional-default` on `readFrozenChain` turned it red. **Left:** 36 Tovu flags (mostly middleware, port callbacks and type guards that need an owner decision) and all 414 Jini flags. |
| R09 | Sonnet builder | PARTIAL (`8d7cd5e85`) | xml-escape group only: the shell is deleted and consumers use `@jini-ai/core/text`. The public `escapeXml` export is unchanged and api:check passes. **Left:** the oauth args/ports, mail, and secrets shell groups, and `cms/settings` (waits for the release decision). |
| G10 | Opus builder | PARTIAL (`fe19c390f`) | activation.ts: `buildModule` went from 314 lines to about 7, split into read, lock and durable-write factories, and its size debt row is removed. The phase-order pin has 6 tests. Two lock-order mutations turn it red. **Left:** trusted-plugin-files, capability-projection, package-paths, set-enabled, search, and surface-handlers. |
| G19 | Opus builder | DONE (`ef0e0da40`) | writeFrameOutcome 13 → split; readConfirmationResume 11 → split; describeToolCallDetail 11 → split. `M-resume-ignore-parent` turns 1 red. `M-wire-original-daemon-error` turns 2 red. `M-truncate-before-redact` turns 1 red. |
| G21 | Opus builder | DONE (`a1cae24b7`, `b84328277`) | refusalError, prepareTermSync, readOriginalVideo and ffmpeg transcode are each down from 11. `M-refusal-show-auth-sentence`, `M-term-write-on-deny`, `M-video-read-before-size-guard` and a lock-leak mutation all turn their pins red. |
| (extra) | Opus builder | DONE (`6d8b156fb`) | The last two Jini complexity reds: provisionPluginMcp (cognitive 11 → 3) and ErrorNotice (11 → 9). Both mutations turn 3 tests red. |
| R01 R02 R03, K01–K06, G01–G09, G11, G14–G18, G22, G23 | — | NOT STARTED | Out of time and caps. |

## Counts, before → after

- **Tovu architecture, cross-feature rows:** 43 → **0**.
  - Sol fixed 5, A01–A14 fixed 38, and A15 pruned 12 stale baseline rows.
  - There are no `crossFeatureEdges` additions and no `--update`. Rows 11, 38 and 43 were fixed at source (owner default).
  - Back-edges stay 0 and the cycles/SCC are unchanged.
  - The non-blocking runtime propagation-cost warning went from 3.58 to 3.54 (baseline 3.06).
  - `check:architecture` exits **0**.
- **Jini complexity ratchet, new violations:** 10 → **0**, and `check:complexity` exits 0.
- **Jini size ratchet:** 9 → 9 new/worsened entries. They are pre-existing and in files this run did not change; the G10 `buildModule` row is removed. Still red.
- **Tovu hook-injection debt:** shrank twice (R04 and the R05 checker). Both baselines were updated, shrink only.
- **Owner-rule census:** not recounted (R02, R03 and most of R07 are not built).

## Gates against merge-21

| gate | merge-21 | final |
|---|---|---|
| desktop `npm run gates` | First run: 5/6 (the tests output was truncated; a standalone rerun passed 2,796/0). Second run: PASS. | **6/6 PASS** |
| Tovu `tsc` / admin `tsc` | 0 / 0 | 0 / 0 |
| Tovu hooks / boundaries / errors | ok | ok |
| Tovu `check:architecture` | FAIL (43 rows) | **ok** |
| Tovu why-comments (base merge-21, with Jini) | — | ok |
| Jini typecheck / api:check / hooks / errors / why-comments | ok | ok |
| Jini guard | 1 (HW3 `admin/src/shell/lib/shell-failure-log.ts`) | same 1 |
| Jini complexity | FAIL 10 | **ok** |
| Jini size / log-safety | FAIL (9 / 64) | same (9 / 64) |
| Admin vitest, changed tests | — | 33 files / 655 pass |
| Website node tests, changed files plus their folders' tests (827 files) | 45 failing | 44 failing. Both runs stalled after about 7,150 tests and were stopped. |

The two new failures that appeared on g6 were fixed in `e9a1c4322`: widgets characterization tests (e) and (f), whose fixture did not bind A14's post writes. Every other failure was already present on merge-21 (see bugs).

## UNVERIFIABLE-IN-CLOUD

- Postgres tests need a running server; there is no psql socket here:
  - `unreadable-owner-entries-repair.postgres`
  - `external-mcp-frozen-db.postgres`
  - `access-choice.postgres`
- Real CLI model-freshness probes (`codex`, `agy`) were skipped by guard.
- No visual or browser checks were run: R01 was not built, and R04/R05 are covered by DOM tests only.

## Bugs

- **Fixed:**
  - Sol A09 type clash (`4e24eb31e`).
  - R04 test hook spread overriding the desktop policy (`4e24eb31e`).
  - `content-read-get-by-id` media pin that predated J-DESC (`8c73967f2`; it was red on merge-21).
  - A14 characterization fixture (`e9a1c4322`).
  - Why-comments: A10 rewording was recorded as debt with reasons; A12, A04 and R05 comments were restored verbatim.
- **Logged in `development/open-bugs.md`:**
  - `g6-stale-test-imports`: test files that import moved or deleted modules, plus other failures already present on merge-21.
  - `g6-publish-connect-candidate`: suspected; `findPublishCandidate` is not in the connect tool's `routeDeps`.
- **Not logged in open-bugs:**
  - `migrations/__tests__/checksums.test.ts`: 2 failures, which the R07 builder also saw before its change. Not compared against merge-21 here.
  - Jini size and log-safety ratchets are still red. These are pre-existing and need their own sheet.

## Run notes

- **Incident, fixed.** The R07 builder's commit carried its worktree's `node_modules` symlinks. Merging it replaced the main checkout's ignored `apps/{admin,desktop,site-chat}/node_modules` with self-links. I removed them, re-ran `npm ci` and `link:jini`, and dropped the links from the merge commit. The tree has no tracked `node_modules`.
- **Caps.**
  - Coordinator: about 190 tool calls, about 2 h.
  - Never more than 4 subagents at a time.
  - Most builders stayed within 50 calls, but some ran past the per-agent caps:
    - A04 builder: 63 calls.
    - First-round builders (A01/A14, credentials, deletion, misc) and the A04 builder: 107k–143k subagent tokens against the 120k context cap.
  - Each one stopped and handed back, and leftovers went to a fresh builder.
- **R07 builder's flag list (41).**
  - Website (35): `ask-choice-tool:buildAskChoiceRegistrations`, `desktop-mcp-runtime:isDesktopMcpCapability`, `analytics/warn:warnAnalytics`, `external-mcp-oauth:tovuSealExternalMcpOAuthPayload`, mail-status `buildMailDeliveryRegistrations` and `buildMailProviderRegistrations`, `media:buildMediaRegistrationsForTovu`, `settings-write-policies:set`, `held-back-choice:isAbsent` ✓, `theme-manifest-fields:isObject`, `sqlite:openNativeSqlite`, 9 migration steps, `legacy-sqlite` ×2 (dropped), `content-db:openContentDb`, `theme-content-security-headers`, `forms-multipart`, `pages:registerSiteRoutes`, `json-body-parsers` ×3, `observability-middleware:captureRouteError`, `assistant-daemon-client` ×4 ✓, `external-mcp:createExternalMcpModule`, `plugin-tier2/worker:importPluginModule`.
  - Admin (6): `dev-proxy-upstream-close`, `use-media-preview` ×2, `sites-dependencies`, `kit:tovuAgentAttrs`, `settings-external-mcp-shared-choice:toAdminApiError`.
