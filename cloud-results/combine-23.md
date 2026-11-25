PARTIAL ac8d5af672 ebec2ca85 | FILES LEFT 1040 (excl. themes) / 507 | left: rv1125a FIX 1-4, 8-14, 16-25 (see Fixes); pending bugs 1, 5, 6; gates not run: Tovu hooks/boundaries/architecture/why-comments/admin vitest/node-tests sweep, Jini api:check/hooks/why-comments/complexity; Jini guard red (12); admin tsc 2 (chat-cleanup DockHeader)

> All 13 lanes are merged in both repos. The SHAs on the first line are the tested code tips: Tovu `ac8d5af672`, Jini `ebec2ca85`. FILES LEFT was measured at Tovu `abd42dae5b`, before feat-p11 and b-g6c merged. At `aa976cd5ef` it was 1039 / 506.

# combine-23 (2026-11-25): Tovu + Jini `integ/merge-23-2026-11-25`

Unattended cloud run. Opus coordinated and did the small merges itself. Every hard merge, port and fix went to an Opus-high worker; the FILES LEFT count and two small bugs went to Sonnet. No more than 4 workers ran at once. Some workers went over the 50-call cap: 53, 63, 69.

**Programmer skill confirmed.** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer v1.7.5) first. Every worker brief carried its rules:
- root cause first;
- failing test first, plus a named mutation, for every bug;
- merge-22's moves win on location, the lane's logic wins on behaviour;
- never drop a test case;
- inject everything;
- hooks as required props;
- fn ≤ 80, complexity ≤ 10;
- no re-export shells;
- Jini stays neutral;
- themes untouched;
- never `--no-verify`.

**Setup:**
- **Node:** 24.22.3.
- **Jini:** `pnpm install --frozen-lockfile && pnpm -r --filter './packages/*' build`.
- **Tovu:** `npm ci --ignore-scripts` in root, admin, desktop and site-chat; `link-jini`; hooks; build of `packages/{contracts,sdk}`.
- **Gate 0:** desktop `npm run gates` on merge-22 (`d4a934da86`), **6/6 PASS**.

**Rules held:**
- No force-push, no `--no-verify`, no tag, no publish, no codebase-memory tools, no RemoteTrigger.
- `main`, `plan/*`, `release/*`, `codex/*` and older `integ/merge-*` were not written to.

## Merge table

Lanes were merged in the order from rv1125a's MERGE-ORDER, not the brief's order. Lane groups were pre-merged in scratch branches `integ/wip24-lane-{a..e}` (Tovu) and `integ/wip24-*-jini` (Jini), then merged into merge-23.

**Tovu**

| # | branch | merged? | conflicts resolved | tests at merge time |
|---|---|---|---|---|
| 1 | b-g6 | yes, `e42a8a972e` | 25 | root + admin tsc 0 |
| 2 | b-g4 | yes, `45123aa4d6` | 8 | website credential 112/112; desktop gates 6/6 on push |
| 3 | b-g2 | yes, via lane-b, `76bf9c8f44` | 9 + 4 | — |
| 4 | feat-p4 | yes, via lane-a, `5166329d7d` | 0 | — |
| 5 | feat-p3 | yes, via lane-a | 8 | admin daemon-starting-label 8/8 |
| 6 | b-g3 | yes, via lane-a | 13 | — |
| 7 | b-g5b | yes, via lane-d, `0584dac1b4` | 13 | — |
| 8 | b-g6b | yes, via lane-d | 3 | xAI registry pin |
| 9 | b-g1 | yes, via lane-c, `5efbbb55f0` | 16 | edit-html-permission all; migrations 202/214 (12 environmental or pre-existing) |
| 10 | b-g5a | yes, via lane-c | 4 | newsletter 43/43 |
| 11 | feat-p5 | yes, via lane-b, `aa976cd5ef` | 10 | — |
| 12 | feat-p11 + FIX 6/7 | yes, via lane-e, `17b3e6ecbc` | 39 | storage-maintenance 11/11; blob-gc + actor-kind steps 6/6 |
| 13 | b-g6c | yes, via lane-e | 0 | — |

Tovu notes:
- **b-g6:** the injected values (A11/A12) became required parameters on merge-22's thin host bindings.
- **b-g4:** theme deltas were held at merge-22 (FIX 15). Per-provider PATCH/DELETE was ported into Jini's `createMediaApi` and `createMediaProvidersPort`.
- **b-g2:** the theme plugin delta was held (FIX 12).
- **feat-p3:** P4's reporter and P3's routines are both kept. `ROUTINES_RELEASE_ENABLED` is still false.
- **b-g3:** P3's acceptance is kept. b-g3's `acceptOwnedAssistantRun` is added, with the browser marker stripped (`sanitizeBrowserRunContext`). Admin AG-UI stays off by default.
- **b-g6b:** xAI is registered once: `@jini-ai/provider-plugins/xai/media`, id `grok`, alias `xai-grok-imagine`→`grok`.
- **b-g1:** `viewerTimeZone` was adopted (Jini `formatUploadDate`).
- **b-g5a:** site-update apply stays check-only (FIX 16).
- **feat-p5:** the Jini port is `1796cc7e3`. `cutoverPolicy` stays `rollback`.
- **feat-p11:** the Jini port is `655f83038` (share expiry and owned temp roots, as injected hooks). Migration `0046_blob_gc_journal` was renumbered to **`0048_blob_gc_journal`**, re-pinned through `UPDATE_MIGRATION_CHECKSUMS`.

**Jini.** Lanes were merged into `integ/merge-23-2026-11-25` in the same order. Conflicts:
- api-baseline and debt ledgers were unioned.
- feat-p4 http-kit adapter and raw-route: the two-mode structure is kept, with every merge-22 gate carried into both modes.
- b-g2 chat tool-call-detail, b-g3 AG-UI resume, b-g1 media `viewerTimeZone` and b-g5a `tool.failures kind` were resolved by hand on merge-22's structure.
- b-g5b had 7 files.
- b-g6b had 17 files (the xAI convergence).
- feat-p11 package.json exports were repaired in `19065a481`.
- b-g6c had 8 files: the split structure is kept and HEAD's behaviour carried into the split modules.

Port branches merged into Jini: wip24-b-g4-jini, lane-b-jini, lane-c-jini, lane-d-jini, p5-jini, p11-jini, bugs34-jini, bug2-jini. Build fixes: `6703e07f3`, `70ded23e3`, `90aceee08`, and the opencode-acp test import.

## Fixes table

| item | status | evidence |
|---|---|---|
| rv FIX 5 (P11 live cleanup approval) | **NOT DONE** | Live cleanup is still reachable through the HTTP/tool path with `dryRun:false`. Pinned single-use approval is not built. |
| rv FIX 6 (`storage clean` live by default) | **DONE** `3b602c2537` | Preview by default, explicit `--apply`. New test red → green. **M `storage-clean-default-live`** turned 1 of 11 red. |
| rv FIX 7 (raw `error.message` log) | **DONE** `3b602c2537` | Logs the incident id plus class and errno only. Test red → green. |
| rv FIX 12, FIX 15 (theme deltas) | **DONE** | Held at merge-22. Owner to decide on b-g2's tovu-theme plugin and b-g4's theme-toggle and classic fonts. |
| rv FIX 18 (migration ordinal) | **DONE** | b-g5b keeps 0046/0047; P11 becomes 0048. |
| rv FIX 20, FIX 23 (xAI twice / id) | **DONE** (merge) | One registry; `grok` is kept; alias pin. A clean packed-install check was not run. |
| rv FIX 1-4, 8-11, 13, 14, 16, 17, 19, 21, 22, 24, 25 | **NOT DONE** | Out of time. FIX 16 and 17 hold, because nothing was turned on. |
| bug 2 (trash retention) | **DONE** Jini `05713c898`, Tovu `f3420375c4` | The engine default (60) is removed and `retentionDays` is required. Tovu owns `TRASH_RETENTION_DAYS = 30`. **M `trash-default-60`**, **M `trash-retention-not-injected`**. |
| bug 3 ("Cleared 1 … messages") | **DONE** Jini `766c0bb05` | `pickPlural` plus a singular key in 21 locales. **M `plural-cleared-always-other`**: 2 red. |
| bug 4 (llms.txt Posts) | **DONE** Jini `0de69e21c` | `## Posts` and `## Pages` sections. **M `llms-all-pages`**: 2 red. |
| bug 1 (Source Control providers empty) | **NOT DONE** | Diagnosed only. The likely cause is that the trust gate's `archiveDigest` does not match `bundled-digests.json` after the x8/x9 moves. The server log line `[source-control-providers]` names the refusal. |
| bug 5 (merge-21 reds) | **NOT DONE** | Located only. publish-zero-setup's stale test import; wiring-identity row 7; postgres stale-save; CollectionEntries; missing modules. |
| bug 6 (x9-testfix debt) | **NOT DONE** | There are no stale comments. Guard stale-debt rows: see Gates. |

## Gates (final)

**Jini `ebec2ca85`:**
- build: 0.
- `pnpm typecheck`: 0.
- `pnpm guard`: **12 violations**. Not compared against merge-22, which had at least one base-red, HW3.
- Not run: `api:check` (api-baseline was union-merged, so it needs `api:update` + changeset), hooks, why-comments, complexity, full vitest.

**Tovu:**
- root tsc: **0**.
- admin tsc: **2**. Both are in `chat-cleanup.unit.test.tsx`, which imports the deleted local `DockHeader`. See New bugs.
- Desktop gates: see the line below.
- Not run: hooks, boundaries, architecture, why-comments, the admin vitest sweep, node tests on changed files and their importers.
- Targeted tests per merge: see the merge table.
- Desktop gates at `ac8d5af672` (`apps/desktop npm run gates`, also the pre-push hook): **6/6 PASS** (tree-quiet, tests, typecheck, coverage, complexity, js-backslide). Red at `322267817c` (tests/typecheck/coverage) was p11 x b-g1 drift. Fixed in `d064a667fd`: project-ipc tests now pass the required `beforeAddedRows`. Fixed in `ac8d5af672`: the removed-site cache trim uses the interlock's new `heldSiteSession` instead of a bare `session.fromPartition`, which T-2a.3 forbids; an unheld partition is skipped and left to the boot partition pass. That commit also adds the trim/warn deps to the site-retirement fixture.

## UNVERIFIABLE IN CLOUD (owner must check)

- Packaged desktop: P11's retirement interlock with the b-g1 cache trim, and that sign-in state survives an untrack.
- Packaged desktop: routines stay dark.
- Real-app check of the source-control providers list (bug 1).
- Share links: 7/30/90-day expiry, plus an expired-link page in a browser.
- The admin media grid: paging, the provider catalog and the viewer-zone date on a real site.
- The xAI `grok` key saved before the merge still resolves.
- Admin AG-UI off by default; the Stop-across-routes witness in Chrome and Electron.
- The `/llms.txt` output on the live site.
- `tovu storage clean` previews and deletes nothing without `--apply`.

## New bugs

1. P11's ST-10 chat-cleanup entry is not mounted. merge-22 moved DockHeader into `@jini-ai/admin`, which has no cleanup slot, so `useChatCleanup` and `ChatCleanupPanel` are orphaned. The admin test is red, 2 tsc errors. Fix: add a required cleanup slot to Jini's DockHeader.
2. Jini `KitConversationListProps` lacks `hooks`. Tovu binds `defaultConversationListHooks` in `jini-kits.ts` as a stopgap.
3. Jini's `createFakeMediaPort` lacks `listMediaGrid`. A Tovu host wrapper is the stopgap.
4. Jini's import-registry payload type is not exported by name, so Tovu needed explicit parameter types.
5. A lane commit (`4b88d1be43`) tracked `apps/*/node_modules` symlinks, which broke the installs. They were untracked in `c9501915f1`.
6. Transport double-close: b-g6c's single close was kept. This changes behaviour from merge-22, which closed twice; please confirm.
7. The migrations checksum test fails on the pinned `0002` digest. This is pre-existing. The Postgres runner tests need a server.

## Per-area Jini-bound list (true count; full table in Jini/Tovu `cloud-results/combine-23.md` method section)

| area | true | planner |
|---|---:|---:|
| adm-other | 66 | 166 |
| public-http | 47 | 86 |
| admin-http | 30 | 65 |
| adm-shell-components | 28 | 45 |
| agent-plugins | 28 | 44 |
| site-backup | 25 | 33 |
| deployments | 23 | 28 |

Comparison: merge-22 was 1008 / 474, so the count went up by 32 / 33. The rise is new Tovu feature code in Jini-bound folders (P3's routines screen, b-g5b's media grid, b-g2's html revert), not regressions. Method: `combine-18-plan.mjs` with `scan.mjs`, plus the KEEP_RULES from `plans/count-1124/*.md`, calibrated against combine-22's exact numbers on merge-22.
| merge-22 (d4a934da86, recomputed) | 1128 | 1008 | 594 | 474 | 79 |
| merge-23 @ aa976cd5ef | 1159 | 1039 | 626 | 506 | 91 |
| **merge-23 @ abd42dae5b (origin tip)** | **1160** | **1040** | **627** | **507** | **92** |
- Why up: the added files are new Tovu feature code that landed after merge-22 in Jini-bound dirs, not regressions in Jini ports: admin `routines/*` screen (9 files) + `tool-metadata/routines.ts`, admin media grid/provider panel (9), pages HTML revert (`html-inverse/html-reverter/html-change-recording`, 3), media-generation provider catalog (2), `web-screenshot/capture-retention.ts`, `outbox-trace-parent.ts`, `site-granted-vault.ts`, `ag-ui-approval-relay.ts`; the only file that left the true set is `site-backup/import-registry.ts`.
- The count went UP vs merge-22 (+32 planner, +33 true), not down: true set +34 files / -1, planner set +34 / -2. Per-area delta planner/true: adm-other +19/+19, contracts-core +3/+3, pages +3/+3, admin-http +2/+2, adm-pages +2/+2, media-generation +2/+2, adm-shell-lib +1/+1, media +1/+1, web-screenshot +1/+1, site-backup -1/-1, post -1/+0.

## Per-area Jini-bound files left (merge-23 tip; true count, planner in parens, ready(true) after; 5 examples = first by path, relative to apps/*/src/, `features/` dropped)
- theme (themes, held out): 88 (88), ready 31 | contracts/core/tool-metadata/theme.ts ; theme/active-theme-publish-content.ts ; theme/active-theme.ts ; theme/agent-tools.ts ; theme/asset-operations.ts
- adm-other: 66 (166), ready 6 | collections/CollectionEntryEditor.tsx ; database/Database.tsx ; email/Email.tsx ; email/EmailProviderTab.tsx ; email/EmailSegments.tsx
- public-http: 47 (86), ready 2 | inbound/public-http/http/members.ts ; inbound/public-http/http/site/bare-page.ts ; inbound/public-http/http/site/render-site.ts ; inbound/public-http/http/site/render/blocks.ts ; inbound/public-http/http/site/render/components/entry-lists.ts
- adm-themes (themes, held out): 32 (32), ready 10 | themes/HeldBackThemes.tsx ; themes/ThemeExplore.hooks.tsx ; themes/ThemeExplore.tsx ; themes/ThemePreviewReloadButton.tsx ; themes/Themes.tsx
- admin-http: 30 (65), ready 2 | inbound/admin-http/http/presentation.ts ; inbound/admin-http/owner-mfa-routes.ts ; inbound/admin-http/owner-passkey-routes.ts ; inbound/admin-http/owner-recovery-routes.ts ; inbound/admin-http/routes/agent-plugins/install-response.ts
- adm-shell-components: 28 (45), ready 0 | components/AdminByokKeyPanel.tsx ; components/AssistantDock/AssistantDock.state.hooks.ts ; components/AssistantDock/AssistantDock.tsx ; components/AssistantDock/DockChatPane.tsx ; components/AssistantDock/RoutedA2uiSurfaceCard.tsx
- agent-plugins: 28 (44), ready 3 | agent-plugins/activation-effects.ts ; agent-plugins/apply-connect-defaults.ts ; agent-plugins/apply-tool-renames.ts ; agent-plugins/automatic-agent-plugins.ts ; agent-plugins/connect-destination.ts
- site-backup: 25 (33), ready 1 | site-backup/archive-extensions.ts ; site-backup/archive-manifest.ts ; site-backup/backup-service.ts ; site-backup/import-backend.ts ; site-backup/import-database.ts
- deployments: 23 (28), ready 1 | deployments/capability-card.ts ; deployments/deploy-ops/agent-tools.ts ; deployments/deploy-ops/registry.ts ; deployments/deploy-ops/run-ops.ts ; deployments/deploy-ops/secrets.ts
- post: 21 (28), ready 3 | post/agent-tools.ts ; post/content-stats-tool.ts ; post/post-create.ts ; post/post-retire.ts ; post/post-tool-delete.ts
- adm-posts: 15 (38), ready 1 | posts/Posts.tsx ; posts/editor/header/PostEditorActions.tsx ; posts/editor/header/PostEditorHeader.tsx ; posts/editor/notices/PostEditorNotices.tsx ; posts/editor/preview/PostPreview.tsx
- adm-security: 15 (23), ready 0 | security/AccessTokensTab.hooks.tsx ; security/AccessTokensTab.tsx ; security/OtherCredentialsSection.hooks.tsx ; security/OtherCredentialsSection.tsx ; security/RecoveryCodesCard.tsx
- adm-deployment: 14 (23), ready 4 | deployment/Deployment.tsx ; deployment/DockerfileTab.tsx ; deployment/OverviewTab.tsx ; deployment/StaticSiteTab.tsx ; deployment/api/publish-destination.types.ts
- publish-content: 13 (15), ready 0 | publish-content/backstop-service.ts ; publish-content/destination-credential.ts ; publish-content/disconnect-tool.ts ; publish-content/peer-transport-binding.ts ; publish-content/peers.ts
- media: 12 (15), ready 2 | media/derived-media-link.ts ; media/import-video-conversion.ts ; media/large-upload-routing-copy.ts ; media/library-save-attachment.ts ; media/media-search-source.ts
- adm-shell-lib: 9 (36), ready 1 | lib/ag-ui-approval-relay.ts ; lib/browser-telemetry.ts ; lib/credential-copy.ts ; lib/durable-run-subscription.ts ; lib/execution-settings.ts
- trash: 9 (14), ready 0 | trash/adapters/media.ts ; trash/adapters/member.ts ; trash/adapters/post.ts ; trash/adapters/redirect.ts ; trash/adapters/user.ts
- contracts-core: 8 (30), ready 6 | contracts/core/approval-i18n.ts ; contracts/core/chat-delete-grant.ts ; contracts/core/events/outbox-trace-parent.ts ; contracts/core/human-confirm.ts ; contracts/core/site-granted-vault.ts
- adm-pages: 8 (22), ready 2 | pages/PageEditor.tsx ; pages/PageEditorPreview.tsx ; pages/hooks/page-editor-port.hooks.ts ; pages/hooks/page-editor-save.ts ; pages/hooks/use-page-editor.hooks.ts
- custom-credentials: 8 (14), ready 1 | custom-credentials/agent-tools.ts ; custom-credentials/credential-copy-tool.ts ; custom-credentials/credential-save-tool.ts ; custom-credentials/credentialed-request.ts ; custom-credentials/delete-request-confirmation-ui.ts
- project-keys: 8 (8), ready 1 | project-keys/attached-vault.ts ; project-keys/attachments.ts ; project-keys/create-vault.ts ; project-keys/service.ts ; project-keys/shared-oauth-disconnect.ts
- external-mcp: 7 (11), ready 0 | external-mcp/deps.ts ; external-mcp/external-mcp-oauth.ts ; external-mcp/external-mcp-repo.ts ; external-mcp/external-mcp-repo.writes.ts ; external-mcp/external-mcp-store.ts
- pages: 7 (11), ready 0 | pages/agent-tools.ts ; pages/html-change-recording.ts ; pages/html-document-store.memory.ts ; pages/html-document-store.ts ; pages/html-inverse.ts
- identity: 6 (13), ready 0 | identity/permission-list-tool.ts ; identity/repo.authentication.ts ; identity/repo.authorization.ts ; identity/repo.ts ; identity/tool-registrations.ts
- adm-publish-content: 6 (11), ready 0 | publish-content/PublishContentDialog.hooks.tsx ; publish-content/PublishContentDialog.tsx ; publish-content/api/publish-content-api.ts ; publish-content/hooks/publish-content-port.hooks.ts ; publish-content/hooks/use-publish-content-confirm.hooks.ts
- site-export: 6 (10), ready 1 | site-export/export-html-policy.ts ; site-export/export-preflight-copy.ts ; site-export/media-original-urls.ts ; site-export/route-manifest.ts ; site-export/site-exporter.ts
- source-control: 5 (12), ready 0 | source-control/credential-setup.ts ; source-control/source-control-credential-repo.ts ; source-control/store.ts ; source-control/tool-registrations.ts ; source-control/types.ts
- adm-source-control: 5 (8), ready 0 | source-control/ProvidersTab.tsx ; source-control/hooks/use-source-control-credentials.hooks.ts ; source-control/rules.ts ; source-control/source-control-panel.tsx ; source-control/source-control-visuals.tsx
- newsletter: 5 (7), ready 0 | newsletter/confirmation.ts ; newsletter/delivery/tool-registrations.ts ; newsletter/http-error-responses.ts ; newsletter/subscriptions.ts ; newsletter/tool-registrations.ts
- webhooks: 5 (7), ready 1 | webhooks/keyring.env.ts ; webhooks/seal-aad-invariant.ts ; webhooks/secret-scan-guard.ts ; webhooks/site-key-ensure.ts ; webhooks/site-key-sources.ts
- media-generation: 5 (5), ready 0 | media-generation/host-media-providers.ts ; media-generation/media-provider-catalog.ts ; media-generation/provider-credential-save.ts ; media-generation/providers-tools.ts ; media-generation/tool-registrations.ts
- other areas with 1-4 true files (35 areas, 63 files): plugin-runtime 4, adm-shell-hooks 3, api-connections 3, database-transfer 2, forms 2, vendor-credentials 2, database 3, site-inspection 2, adm-recovery 1, desktop 1, contracts-headless 1, mail-status 4, form-destinations 3, member-login 3, consent 2, fs-files 2, taxonomy 2, content-types 1, navigation 1, widgets 1, web-screenshot 3, asset-transfer 2, publish-trust 2, entries 1, members 1, recovery 1, web 1, platform-html 1, email-templates 2, mail 1, object-storage 1, content-duplication 1, image-transform 1, media-import 1, permanent-delete 1
- planner-only (all kept by the count docs): settings 7, adm-members 6, adm-roles 5, platform-mail 5, adm-users 4, publish-content-ui 4, presentation 3, analytics 2, comments 2, skills 2, observability 1, redirects 1, seo 1, server-logs 1, site-search 1, tool-audit 1, webmcp 1, platform-routing 1
