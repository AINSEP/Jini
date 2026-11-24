PARTIAL c9661c834 eb6a17f80: 275 lane files left (274 blocked by the planner on K2/K4/K5 prerequisites, 1 STOPPED); all 58 ready files done

# x6-admin — the admin areas still Jini-bound on merge-20 (adm-other, adm-shell-components, adm-shell-lib, adm-shell-hooks)

- **Branches:** Tovu `codex/x6-admin-tovu` @ `c9661c834`; Jini `codex/x6-admin-jini` @ `eb6a17f80`. Both are based on `origin/integ/merge-20-2026-11-24` (Tovu `b115aa29b`, Jini `c10ebb88b`). No force-push, no `--no-verify`, nothing published or tagged.
- **Required reading:** I read `AI-Dev-Shop/agents/programmer/skills.md` (199 lines: Role, Workflow 0–12, Output Format, Escalation, Guardrails). Its relevant rules were included in the worker brief: minimum change, no test weakening, Architecture Audit, and Pre-Completion evidence.
- **Planner:** `cloud-results/combine-18-plan.mjs` (from `integ/merge-18`), with `plans/P9-data/tools/scan.mjs` from `plan/whats-left-1122`, both run on merge-20. Destinations come from the planner's step sheets (`A-adm-other-1/2/3`, `A-adm-shell-components-1`, `A-adm-shell-lib-1`). Domain-package check: no ready file needed a domain package, so every file went to `@jini-ai/admin` and no domain dependency was added.
- **Setup:**
  - Jini: `pnpm install --frozen-lockfile` and `pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` in root, admin and desktop. The `packages/contracts` `prepare` hook was neutralised for the install and then restored. After that, `link-jini`, `prepare-desktop-hooks`, and a hand build of `contracts` and `sdk`.
  - Each worker had its own worktree pair under `/home/user/wt/wN-{tovu,jini}`, with node_modules hardlinked and dist copied.
- **Execution:** 5 Sonnet high-effort workers (4 at a time at most) plus 1 Sonnet fix-up. Opus coordinated, merged and ran the gates.

## Batches (each was pushed after merging)
| batch | Jini commits | Tovu commits | content |
|---|---|---|---|
| 1 shell-lib-1 (w3) | `d647ca911` | `657c10bac` | admin-http config/urls/settings types, post-list sort, descriptor-i18n |
| 2 shell-components-1 (w4) | `e32ce463f`, `3501b43a1` (merge plus stray-file drop) | `f46d9d50d`, merge `13dff0b23` | confirm dialog, device preview, install tab card, plain text blocks, ports, selected-agent plugins, mail banner hook |
| 3 other-2 (w2, plus fix-up) | `bff6251c7`, `ea521c88a`, `208282928`, merge `2c3358b41` | `6ed12e8aa`, `8f0a9757d`, merge `7dca23591` | providers, seo types, external-MCP drift copy, skills, trash, voice-input, integrations redirect |
| 4 other-1 (w1) | `e35d1f544`, `1bc1c3250`, merge `a3371fe90` | `37b925470`, merge `baba60ed3` | auth/email/plugins CSS (token-routed), database/email/media/plugins hooks, import-export dedupe |
| 5 wave 2 (w5) | `eb6a17f80` | `c9661c834` | media-item-link and mic-button-view hooks, plus 4 stylesheets routed through `--jini-admin-*` |

## FILES LEFT (combine-18 planner, lane areas only)
| area | before (merge-20) | after (`c9661c834`) | ready before → after |
|---|---|---|---|
| adm-other | 208 | 180 | 30 → 2 (both STAYS-HOST) |
| adm-shell-components | 71 | 58 | 14 → 1 (STAYS-HOST) |
| adm-shell-lib | 39 | 35 | 14 → 10 (8 STAYS-HOST, 1 STOPPED, 1 new host binding) |
| adm-shell-hooks | 14 | 14 | 0 → 0 |
| **lane total** | **332** | **287** | 58 → 13 |

- Planner-wide: moving files went from **1308 to 1263**.
- Of the 287 that remain, 12 are STAYS-HOST files that the planner's `KEEP_RULES` do not list yet. Recommendation: add them to `KEEP_RULES` (list below). The 12 are the 11 STAYS-HOST rows in the table plus `lib/use-addons-redirect.hooks.ts`, the new host binding.
- That leaves **275 real files**: 274 planner-blocked and 1 STOPPED.
- The 274 blocked files all wait on K2 (admin kit names), K4 (type seams) or K5 (injection). The table shows the blocking dependency for each. None of them could move verbatim in this run.

## Gates (no new red vs merge-20)
- **Jini:**
  - `pnpm -r build`: 0.
  - `pnpm typecheck`: 0.
  - `pnpm guard`: 1 violation. It is the same as the base: HW3-module-state in `packages/admin/src/shell/lib/shell-failure-log.ts`, which predates this lane.
  - `api:check`: 0. Subpaths were only added.
  - `check:hooks`: ok.
  - `check:why-comments` (`WHY_COMMENTS_BASE_REF=origin/integ/merge-20-2026-11-24`): ok, 0 lost.
  - Changed vitest: 13 moved test files, 135/135. Admin `src/screens/{voice-input,media}` plus `src/shell/components`: 45 files, 360/360.
- **Tovu:**
  - Root `tsc -p tsconfig.json`: 0.
  - `apps/admin` `tsc --noEmit`: 0.
  - Admin vitest `--changed origin/integ/merge-20-2026-11-24 --maxWorkers=2` (changed files plus importers, on the batch 1–4 head): 618 files. 11079 passed and 9 failed.
  - Re-run after batch 5 (skills, voice-input, providers, plugins, media, InstallTabCard, MailStatusBanner, `src/__tests__`): 155 files. 1714 passed and 8 failed.
  - **Every failure is BASE-RED.** Reproduced on a pure merge-20 Tovu worktree:
    - `focus-ring-css`
    - `list-table-detail-card-css`
    - `locale-hook-required-props.source-pin`
    - `narrow-content-column-css` ×2
    - `phone-touch-targets-css` ×2
  - Reproduced on a tree with no lane changes to the suite or its imports:
    - `Media.unit` (accept list missing `video/quicktime`/`x-m4v`)
    - `use-dock-renderer-registry`
    - `CollectionEntries.unit` (`.status-draft`)
    - `security-panel` ×6 (`useAdminLocaleHook is not a function`)
- **Desktop:** `apps/desktop` was not touched, so the desktop gates were not needed.

## SELF-CHECK (each push)
- **No re-export or forwarding files.** Every moved source is deleted in Tovu and its importers point at `@jini-ai/admin/...`.
  - The 2 pre-existing duplicates (`import-export-links.ts`, `GitBackupCard.tsx`) were deleted and repointed.
  - The one new Tovu file, `lib/use-addons-redirect.hooks.ts`, binds the host's default route into the Jini hook. It is not a re-export.
- **Hooks are required props.** `useIntegrationsRedirectHook` is passed as a required prop in `App.tsx`, `panels.tsx` and `AdminUi.tsx`, and `check:hooks` is ok.
- **`jini-*` classes.** These were renamed in the host CSS, tests and e2e selectors so rendering is unchanged:
  - `jini-always-allow-*`
  - `jini-push-to-talk*`
  - `jini-install-tab-*`
  - The kept exceptions are shared host classes that moved components still use: `settings-dialog*`, `editor-actions`, `btn-*`, `page-preview-*`, `segmented`, `card*`, `field-*`.
- **CSS tokens.** Moved stylesheets read only `--jini-admin-*` tokens, and Tovu binds each one to the same host value in `lib/jini-admin-tokens.css`. `--jini-admin-row-text-min` is bound on the same two row selectors that define `--row-text-min`.
- **No new size, complexity, debt or exception rows.**
- **Object args.**
  - New fields went onto existing args objects: `describeVoiceUnavailability({ reason, appName })` and `useIntegrationsRedirect({ defaultRoutePath, routePath })`.
  - `GitBackupCard` takes `agentHandle` as a required prop (the evolved Jini version).
  - `_optional = {}` pads were kept.
- **Why-comments** moved with the code. Product words were neutralised to "the host", and the why-comments gate is green.

## Breaks ledger rows (`plans/P9-BREAKS.md` does not exist on these bases)
| old | new | where | effect |
|---|---|---|---|
| `tovu.admin.mail-status-banner.dismissed` | `jini.admin.mail-status-banner.dismissed` | `shell/components/MailStatusBanner/hooks/use-mail-status-banner.hooks.ts` | A browser that dismissed the banner sees it once more. The banner is not mounted today, so there is no visible effect. |
| `--tovu-admin-settings-control-{bg,border}`, `--tovu-site-preview-bg` | `--jini-admin-settings-control-{bg,border}`, `--jini-admin-site-preview-bg` | Tovu themes and styles, moved CSS | None. Renamed everywhere in the same commit. |
| external-MCP drift copy product strings | `{productName}` placeholder keys | `screens/settings/external-mcp-drift-copy.ts` | None. The Jini dictionaries already key on the placeholder. |

## Caps, and honest deviations
- **Workers went over the per-worker cap.** By tool calls: w1 58, w2 52, w3 50, w4 57. Each used about 123k–141k tokens, against the 45-call / 100k cap. w5 (25 calls, 88k) and the fix-up (13 calls, 56k) stayed within it.
- **The coordinator stayed inside its caps:** about 1h20m of wall-clock and well under 250 tool calls.
- **Named mutations from the sheets were not run.** The target functions had no `if (`, or the target test stays host-side. Instead, each moved test suite ran green in Jini, and the Tovu importer suites ran green apart from the base-red tests.
- **Worker trees vs main.** Worker-tree guard runs showed 7 extra `SI-resolution` lines for `packages/agent-plugins/cloudflare`. These are untracked generated `.mjs` files missing from fresh worktrees. The main tree shows only the base HW3 line.

## Recommendations (no owner stop needed)
1. **`server-reconnect.ts` (STOPPED).** Move the class into `@jini-ai/admin/shell/lib/server-reconnect`, with the build `mode` and the upstream-status header name as constructor args. The module singleton (`import.meta.env.MODE`, `x-tovu-upstream-status`) becomes a host binding in Tovu.
2. **Add the 12 STAYS-HOST files to `combine-18-plan.mjs` `KEEP_RULES`** so the planner stops counting them: `lib/{addons-routes,admin-nav-i18n,agent-screenshot,admin-dev-origin,site-url,app-version,jini-admin-tokens.css,block-atom-insert,use-addons-redirect.hooks}`, `features/authentication/model/provider-schemas.ts`, `features/plugins/composer-capabilities.ts`, `components/TemplateSource/template-source-dependencies.hooks.ts`.
3. **Next lane work for the remaining 274.** Do the A-K2 kit completion and the K4 type seams first; those unblock the bulk of `adm-other` and `adm-shell-components`. `adm-shell-hooks` (14 files) waits on K5 locale/port injection.

## Per-file table (every lane file; `NOT REACHED` = planner-blocked, blocking dependency shown)
| area | file | outcome |
|---|---|---|
| adm-other | `apps/admin/src/features/admin-themes/admin-themes-i18n.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE (dir)) |
| adm-other | `apps/admin/src/features/admin-themes/admin-themes.css` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE (dir)) |
| adm-other | `apps/admin/src/features/admin-themes/AdminThemes.tsx` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE (dir)) |
| adm-other | `apps/admin/src/features/admin-themes/index.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE (dir)) |
| adm-other | `apps/admin/src/features/admin-ui/admin-ui.css` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/admin-ui/AdminUi.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/ai-assistant-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/ai-assistant-layout-i18n.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE) |
| adm-other | `apps/admin/src/features/ai-assistant/ai-assistant.css` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/AiAssistant.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/AiAssistant.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/api/ai-assistant-api.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/ai-assistant-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/assistant-daemon-restart-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/assistant-owner-grant-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/permanent-deletes-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/use-admin-execution-mode.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/use-admin-subagents.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/use-ai-assistant-locale-sync.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/use-ai-assistant.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/visitor-credential-form-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/hooks/visitor-tools-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/index.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/owner-grant-bindings.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/rules.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/ai-assistant/visitor-tools-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/analytics/api/analytics-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/analytics/api/analytics-api.ts`) |
| adm-other | `apps/admin/src/features/auth/api/auth-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/auth/api/auth-api.ts`) |
| adm-other | `apps/admin/src/features/auth/auth-host-binding.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/auth/auth-host-binding.tsx`) |
| adm-other | `apps/admin/src/features/auth/hooks/login-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/auth/api/auth-api.ts; planned dest `packages/admin/src/screens/auth/hooks/login-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/auth/hooks/use-wired-login.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/auth/hooks/use-wired-login.hooks.ts`) |
| adm-other | `apps/admin/src/features/auth/index.tsx` | NOT REACHED (blocked: via apps/admin/src/components/SecretInput/SecretInput.tsx; planned dest `packages/admin/src/screens/auth/index.tsx`) |
| adm-other | `apps/admin/src/features/authentication/authentication-host-binding.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/authentication/authentication-host-binding.tsx`) |
| adm-other | `apps/admin/src/features/authentication/authentication.css` | MOVED -> `packages/admin/src/screens/authentication/authentication.css` |
| adm-other | `apps/admin/src/features/authentication/index.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/authentication/index.tsx`) |
| adm-other | `apps/admin/src/features/authentication/model/provider-schemas.ts` | STAYS-HOST (Tovu provider catalog policy passed to the Jini screen as providers) |
| adm-other | `apps/admin/src/features/collections/CollectionEntriesScreen.tsx` | NOT REACHED (blocked: via apps/admin/src/components/status-labels.ts; planned dest `packages/admin/src/screens/collections/CollectionEntriesScreen.tsx`) |
| adm-other | `apps/admin/src/features/collections/CollectionEntryEditor.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/collections/CollectionEntryEditor.tsx`) |
| adm-other | `apps/admin/src/features/collections/collections-host-ports.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/collections/collections-host-ports.ts`) |
| adm-other | `apps/admin/src/features/collections/collections-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/collections/collections-i18n.ts`) |
| adm-other | `apps/admin/src/features/collections/CollectionsScreen.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/collections/CollectionsScreen.tsx`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-collection-entries.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/collections/hooks/use-collection-entries.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-collection-entry-editor.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/widget-embed-extension.tsx; planned dest `packages/admin/src/screens/collections/hooks/use-collection-entry-editor.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-collections.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/collections/hooks/use-collections.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-edit-fields-dialog.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/collections/hooks/use-edit-fields-dialog.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-lifecycle-confirm-dialog.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/collections/hooks/use-lifecycle-confirm-dialog.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/hooks/use-new-content-type-dialog.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/collections/hooks/use-new-content-type-dialog.hooks.ts`) |
| adm-other | `apps/admin/src/features/collections/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/collections/CollectionsScreen.tsx; planned dest `packages/admin/src/screens/collections/index.ts`) |
| adm-other | `apps/admin/src/features/comments/comments-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/comments/comments-host-ports.ts`) |
| adm-other | `apps/admin/src/features/comments/comments-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/comments/comments-i18n.ts`) |
| adm-other | `apps/admin/src/features/content-analysis/hooks/content-analysis-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/content-analysis/hooks/content-analysis-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/content-analysis/hooks/use-content-analysis.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/content-analysis/hooks/use-content-analysis.hooks.ts`) |
| adm-other | `apps/admin/src/features/dashboard/dashboard-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/dashboard/hooks/dashboard-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/dashboard/hooks/use-dashboard.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/dashboard/hooks/use-recent-activity-disclosure.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE) |
| adm-other | `apps/admin/src/features/dashboard/index.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/database/api/database-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/database/api/database-api.ts`) |
| adm-other | `apps/admin/src/features/database/Database.hooks.ts` | MOVED -> `packages/admin/src/screens/database/Database.hooks.ts` |
| adm-other | `apps/admin/src/features/database/Database.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/database/Database.tsx`) |
| adm-other | `apps/admin/src/features/database/hooks/migrate-forward-section-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/database/api/database-api.ts; planned dest `packages/admin/src/screens/database/hooks/migrate-forward-section-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/database/hooks/schema-state-section-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/database/api/database-api.ts; planned dest `packages/admin/src/screens/database/hooks/schema-state-section-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/database/hooks/timeline-section-dependencies.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/database/hooks/timeline-section-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/database/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/database/Database.tsx; planned dest `packages/admin/src/screens/database/index.ts`) |
| adm-other | `apps/admin/src/features/email/api/mail-status-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/email/api/mail-status-api.ts`) |
| adm-other | `apps/admin/src/features/email/email-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/email/email-api.ts`) |
| adm-other | `apps/admin/src/features/email/email-hooks-host.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124a W3rest AGREE) |
| adm-other | `apps/admin/src/features/email/email.css` | MOVED -> `packages/admin/src/screens/email/email.css` |
| adm-other | `apps/admin/src/features/email/Email.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/email/Email.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailActivityTab.tsx` | NOT REACHED (blocked: via apps/admin/src/features/email/EmailParts.tsx; planned dest `packages/admin/src/screens/email/EmailActivityTab.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailOverviewTab.tsx` | NOT REACHED (blocked: via apps/admin/src/features/email/EmailParts.tsx; planned dest `packages/admin/src/screens/email/EmailOverviewTab.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailParts.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/email/EmailParts.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailProviderTab.hooks.ts` | MOVED -> `packages/admin/src/screens/email/EmailProviderTab.hooks.ts` |
| adm-other | `apps/admin/src/features/email/EmailProviderTab.tsx` | NOT REACHED (blocked: via apps/admin/src/components/SecretInput/SecretInput.tsx; planned dest `packages/admin/src/screens/email/EmailProviderTab.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailSenderTab.tsx` | NOT REACHED (blocked: via apps/admin/src/features/email/EmailParts.tsx; planned dest `packages/admin/src/screens/email/EmailSenderTab.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailTemplateEditor.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/email/EmailTemplateEditor.tsx`) |
| adm-other | `apps/admin/src/features/email/EmailTemplatesTab.tsx` | NOT REACHED (blocked: via apps/admin/src/features/email/EmailParts.tsx; planned dest `packages/admin/src/screens/email/EmailTemplatesTab.tsx`) |
| adm-other | `apps/admin/src/features/email/hooks/use-email-template-view.hooks.ts` | MOVED -> `packages/admin/src/screens/email/hooks/use-email-template-view.hooks.ts` |
| adm-other | `apps/admin/src/features/email/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/email/Email.tsx; planned dest `packages/admin/src/screens/email/index.ts`) |
| adm-other | `apps/admin/src/features/forms/forms-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/forms/forms-host-ports.ts`) |
| adm-other | `apps/admin/src/features/forms/forms-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/forms/forms-i18n.ts`) |
| adm-other | `apps/admin/src/features/fs-files/api/fs-files-api.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/fs-files/api/fs-files-api.ts`) |
| adm-other | `apps/admin/src/features/import-export/api/import-export-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/import-export/api/import-export-api.ts`) |
| adm-other | `apps/admin/src/features/import-export/GitBackupCard.tsx` | MOVED (evolved Jini copy already existed; Tovu copy deleted, ImportExport passes agentHandle) |
| adm-other | `apps/admin/src/features/import-export/hooks/git-backup-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/source-control/source-control-host-ports.ts; planned dest `packages/admin/src/screens/import-export/hooks/git-backup-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/import-export/hooks/import-export-dependencies.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/import-export/hooks/import-export-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/import-export/import-export-links.ts` | MOVED (byte-identical Jini copy already existed; Tovu copy deleted, importers repointed) |
| adm-other | `apps/admin/src/features/import-export/import-export-tabs.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/import-export/import-export-tabs.tsx`) |
| adm-other | `apps/admin/src/features/import-export/ImportExport.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/import-export/ImportExport.tsx`) |
| adm-other | `apps/admin/src/features/import-export/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/import-export/ImportExport.tsx; planned dest `packages/admin/src/screens/import-export/index.ts`) |
| adm-other | `apps/admin/src/features/integrations/hooks/integration-deliveries-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/integrations/integrations-host-ports.ts; planned dest `packages/admin/src/screens/integrations/hooks/integration-deliveries-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/integrations/hooks/integrations-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/integrations/integrations-host-ports.ts; planned dest `packages/admin/src/screens/integrations/hooks/integrations-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/integrations/hooks/use-integration-deliveries.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/integrations/hooks/use-integration-deliveries.hooks.ts`) |
| adm-other | `apps/admin/src/features/integrations/hooks/use-integrations-redirect.hooks.ts` | MOVED -> `packages/admin/src/screens/integrations/hooks/use-integrations-redirect.hooks.ts` |
| adm-other | `apps/admin/src/features/integrations/hooks/use-integrations.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/integrations/hooks/use-integrations.hooks.ts`) |
| adm-other | `apps/admin/src/features/integrations/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/integrations/IntegrationDeliveries.tsx; planned dest `packages/admin/src/screens/integrations/index.ts`) |
| adm-other | `apps/admin/src/features/integrations/IntegrationDeliveries.tsx` | NOT REACHED (blocked: via apps/admin/src/components/status-labels.ts; planned dest `packages/admin/src/screens/integrations/IntegrationDeliveries.tsx`) |
| adm-other | `apps/admin/src/features/integrations/integrations-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/integrations/integrations-host-ports.ts`) |
| adm-other | `apps/admin/src/features/integrations/Integrations.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/integrations/Integrations.tsx`) |
| adm-other | `apps/admin/src/features/integrations/rules.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/integrations/rules.ts`) |
| adm-other | `apps/admin/src/features/library/hooks/library-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/api/media-api.ts; planned dest `packages/admin/src/screens/library/hooks/library-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/library/hooks/use-wired-library.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/library/hooks/use-wired-library.hooks.ts`) |
| adm-other | `apps/admin/src/features/library/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/library/Library.tsx; planned dest `packages/admin/src/screens/library/index.ts`) |
| adm-other | `apps/admin/src/features/library/library-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/library/library-i18n.ts`) |
| adm-other | `apps/admin/src/features/library/Library.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/library/Library.tsx`) |
| adm-other | `apps/admin/src/features/media/api/media-api.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/media/api/media-api.ts`) |
| adm-other | `apps/admin/src/features/media/hooks/media-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/api/media-api.ts; planned dest `packages/admin/src/screens/media/hooks/media-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/media/hooks/media-import-dependencies.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/media/hooks/media-import-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/media/hooks/use-edit-media-panel.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/media/hooks/use-edit-media-panel.hooks.ts`) |
| adm-other | `apps/admin/src/features/media/hooks/use-media-item-link.hooks.ts` | MOVED -> `packages/admin/src/screens/media/hooks/use-media-item-link.hooks.ts` |
| adm-other | `apps/admin/src/features/media/hooks/use-media-preview.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/rules.ts; planned dest `packages/admin/src/screens/media/hooks/use-media-preview.hooks.ts`) |
| adm-other | `apps/admin/src/features/media/hooks/use-media-tabs.hooks.ts` | MOVED -> `packages/admin/src/screens/media/hooks/use-media-tabs.hooks.ts` |
| adm-other | `apps/admin/src/features/media/hooks/use-media.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/media/hooks/use-media.hooks.ts`) |
| adm-other | `apps/admin/src/features/media/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/Media.tsx; planned dest `packages/admin/src/screens/media/index.ts`) |
| adm-other | `apps/admin/src/features/media/media-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/media/media-i18n.ts`) |
| adm-other | `apps/admin/src/features/media/media-providers-port.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/media/media-providers-port.ts`) |
| adm-other | `apps/admin/src/features/media/Media.hooks.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/media/Media.hooks.tsx`) |
| adm-other | `apps/admin/src/features/media/Media.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/media/Media.tsx`) |
| adm-other | `apps/admin/src/features/media/pinned-media-providers.ts` | MOVED -> `packages/admin/src/screens/media/pinned-media-providers.ts` |
| adm-other | `apps/admin/src/features/media/rules.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/media/rules.ts`) |
| adm-other | `apps/admin/src/features/menus/hooks/use-menu-editor.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/menus/hooks/use-menu-editor.hooks.ts`) |
| adm-other | `apps/admin/src/features/menus/hooks/use-menus.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/menus/hooks/use-menus.hooks.ts`) |
| adm-other | `apps/admin/src/features/menus/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/menus/menus-panel.tsx; planned dest `packages/admin/src/screens/menus/index.ts`) |
| adm-other | `apps/admin/src/features/menus/menu-editor-panel.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/menus/menu-editor-panel.tsx`) |
| adm-other | `apps/admin/src/features/menus/menus-host-ports.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/menus/menus-host-ports.ts`) |
| adm-other | `apps/admin/src/features/menus/menus-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/menus/menus-i18n.ts`) |
| adm-other | `apps/admin/src/features/menus/menus-panel.tsx` | NOT REACHED (blocked: via apps/admin/src/features/menus/hooks/use-menus.hooks.ts; planned dest `packages/admin/src/screens/menus/menus-panel.tsx`) |
| adm-other | `apps/admin/src/features/observability/api/observability-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/observability/api/observability-api.ts`) |
| adm-other | `apps/admin/src/features/observability/hooks/observability-wiring.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/observability/hooks/observability-wiring.hooks.ts`) |
| adm-other | `apps/admin/src/features/observability/index.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/observability/index.ts`) |
| adm-other | `apps/admin/src/features/playground/hooks/use-playground-canvas.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/playground/index.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/playground/playground-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/playground/Playground.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/playground/Playground.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/plugins/AddAgentPluginPanel.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/use-agent-plugin-install.hooks.ts; planned dest `packages/admin/src/screens/plugins/AddAgentPluginPanel.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AddPluginPanel.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/use-plugin-install.hooks.ts; planned dest `packages/admin/src/screens/plugins/AddPluginPanel.tsx`) |
| adm-other | `apps/admin/src/features/plugins/admin-surface-theme.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/admin-surface-theme.ts`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginDetailsModal.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/AgentPluginMemoryPanel.tsx; planned dest `packages/admin/src/screens/plugins/AgentPluginDetailsModal.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginDisableConfirmDialog.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/use-agent-plugin-disable-confirm.hooks.ts; planned dest `packages/admin/src/screens/plugins/AgentPluginDisableConfirmDialog.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginLinkedLock.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/AgentPluginLinkedLock.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginManageButton.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/agent-plugin-surfaces-dependencies.hooks.ts; planned dest `packages/admin/src/screens/plugins/AgentPluginManageButton.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginMaturity.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/AgentPluginMaturity.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginMemoryPanel.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/use-agent-plugin-memory.hooks.ts; planned dest `packages/admin/src/screens/plugins/AgentPluginMemoryPanel.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginRow.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/AgentPluginRow.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPlugins.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/AgentPlugins.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginSurfaceFrame.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/AgentPluginSurfaceFrame.tsx`) |
| adm-other | `apps/admin/src/features/plugins/AgentPluginUpdateControl.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/AddAgentPluginPanel.tsx; planned dest `packages/admin/src/screens/plugins/AgentPluginUpdateControl.tsx`) |
| adm-other | `apps/admin/src/features/plugins/composer-capabilities.ts` | STAYS-HOST (host-binding half of the composer projection; Jini owns the contract half) |
| adm-other | `apps/admin/src/features/plugins/hooks/agent-plugin-install-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/hooks/agent-plugin-install-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/agent-plugin-memory-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/hooks/agent-plugin-memory-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/agent-plugin-surfaces-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/hooks/agent-plugin-surfaces-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/agent-plugins-dependencies.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123q Admin-feat AGREE) |
| adm-other | `apps/admin/src/features/plugins/hooks/plugin-install-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/hooks/plugin-install-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/plugins-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/plugins/plugins-host-ports.ts; planned dest `packages/admin/src/screens/plugins/hooks/plugins-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-admin-surface-frame.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-admin-surface-frame.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-details-modal.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugin-details-modal.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-disable-confirm.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugin-disable-confirm.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-install.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugin-install.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-memory.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugin-memory.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-surfaces.hooks.ts` | MOVED -> `packages/admin/src/screens/plugins/hooks/use-agent-plugin-surfaces.hooks.ts` |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-tab.hooks.ts` | MOVED -> `packages/admin/src/screens/plugins/hooks/use-agent-plugin-tab.hooks.ts` |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugin-update.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/plugins/rules.ts; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugin-update.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-agent-plugins.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/hooks/use-agent-plugins.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-plugin-install.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-plugin-install.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-plugin-package-files.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/hooks/use-plugin-package-files.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-plugin-provider-settings.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/hooks/use-plugin-provider-settings.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-plugin-remove-confirm.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/hooks/use-plugin-remove-confirm.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/hooks/use-plugins.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/hooks/use-plugins.hooks.ts`) |
| adm-other | `apps/admin/src/features/plugins/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/plugins/Plugins.tsx; planned dest `packages/admin/src/screens/plugins/index.ts`) |
| adm-other | `apps/admin/src/features/plugins/installed-skills-composer-source.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/installed-skills-composer-source.ts`) |
| adm-other | `apps/admin/src/features/plugins/PackageFilesModal.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/PackageFilesModal.tsx`) |
| adm-other | `apps/admin/src/features/plugins/PluginPackageFilesModal.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/PackageFilesModal.tsx; planned dest `packages/admin/src/screens/plugins/PluginPackageFilesModal.tsx`) |
| adm-other | `apps/admin/src/features/plugins/PluginProviderSettingField.tsx` | NOT REACHED (blocked: via apps/admin/src/components/SecretInput/SecretInput.tsx; planned dest `packages/admin/src/screens/plugins/PluginProviderSettingField.tsx`) |
| adm-other | `apps/admin/src/features/plugins/PluginProviderSettingsDialog.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/PluginProviderSettingsDialog.tsx`) |
| adm-other | `apps/admin/src/features/plugins/PluginRemoveConfirmDialog.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/hooks/use-plugin-remove-confirm.hooks.ts; planned dest `packages/admin/src/screens/plugins/PluginRemoveConfirmDialog.tsx`) |
| adm-other | `apps/admin/src/features/plugins/PluginRow.tsx` | NOT REACHED (blocked: via apps/admin/src/features/plugins/plugins-visuals.tsx; planned dest `packages/admin/src/screens/plugins/PluginRow.tsx`) |
| adm-other | `apps/admin/src/features/plugins/plugins-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/plugins/plugins-host-ports.ts`) |
| adm-other | `apps/admin/src/features/plugins/plugins-visuals.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/plugins-visuals.tsx`) |
| adm-other | `apps/admin/src/features/plugins/Plugins.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/plugins/Plugins.tsx`) |
| adm-other | `apps/admin/src/features/plugins/provider-settings-dialog.css` | MOVED -> `packages/admin/src/screens/plugins/provider-settings-dialog.css` |
| adm-other | `apps/admin/src/features/plugins/rules.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/plugins/rules.ts`) |
| adm-other | `apps/admin/src/features/providers/always-allow.css` | MOVED -> `packages/admin/src/screens/providers/always-allow.css` |
| adm-other | `apps/admin/src/features/providers/AlwaysAllowPanel.tsx` | NOT REACHED (blocked: via apps/admin/src/features/providers/hooks/use-always-allow.hooks.ts; planned dest `packages/admin/src/screens/providers/AlwaysAllowPanel.tsx`) |
| adm-other | `apps/admin/src/features/providers/hooks/always-allow-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/integrations/integrations-host-ports.ts; planned dest `packages/admin/src/screens/providers/hooks/always-allow-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/providers/hooks/use-always-allow.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/providers/hooks/use-always-allow.hooks.ts`) |
| adm-other | `apps/admin/src/features/providers/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/providers/Providers.tsx; planned dest `packages/admin/src/screens/providers/index.ts`) |
| adm-other | `apps/admin/src/features/providers/providers-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/providers/providers-host-ports.ts`) |
| adm-other | `apps/admin/src/features/providers/Providers.hooks.ts` | MOVED -> `packages/admin/src/screens/providers/Providers.hooks.ts` |
| adm-other | `apps/admin/src/features/providers/Providers.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/providers/Providers.tsx`) |
| adm-other | `apps/admin/src/features/seo/api/seo-api.types.ts` | MOVED -> `packages/admin/src/screens/seo/api/seo-api.types.ts` |
| adm-other | `apps/admin/src/features/settings/AdminAppearance.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/AdminAppearance.tsx`) |
| adm-other | `apps/admin/src/features/settings/ai-agent-presentation.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/ai-agent-presentation.ts`) |
| adm-other | `apps/admin/src/features/settings/external-mcp-drift-copy.ts` | MOVED -> `packages/admin/src/screens/settings/external-mcp-drift-copy.ts` |
| adm-other | `apps/admin/src/features/settings/ExternalMcpAdmissionsBanner.tsx` | NOT REACHED (blocked: via apps/admin/src/features/settings/hooks/use-external-mcp-admissions.hooks.ts; planned dest `packages/admin/src/screens/settings/ExternalMcpAdmissionsBanner.tsx`) |
| adm-other | `apps/admin/src/features/settings/ExternalMcpSettingsPanel.hooks.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/settings/ExternalMcpSettingsPanel.hooks.tsx`) |
| adm-other | `apps/admin/src/features/settings/ExternalMcpSettingsPanel.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/ExternalMcpSettingsPanel.tsx`) |
| adm-other | `apps/admin/src/features/settings/ExternalMcpToolPicker.hooks.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/ExternalMcpToolPicker.hooks.tsx`) |
| adm-other | `apps/admin/src/features/settings/ExternalMcpToolPicker.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/settings/ExternalMcpToolPicker.tsx`) |
| adm-other | `apps/admin/src/features/settings/ExternalMcpToolsModal.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/settings/ExternalMcpToolsModal.tsx`) |
| adm-other | `apps/admin/src/features/settings/hooks/use-admin-appearance-settings.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124b Admin AGREE) |
| adm-other | `apps/admin/src/features/settings/hooks/use-ai-agent-presentation.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/settings/ai-agent-presentation.ts; planned dest `packages/admin/src/screens/settings/hooks/use-ai-agent-presentation.hooks.ts`) |
| adm-other | `apps/admin/src/features/settings/hooks/use-external-mcp-admissions.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/hooks/use-external-mcp-admissions.hooks.ts`) |
| adm-other | `apps/admin/src/features/settings/hooks/use-external-mcp-tool-picker.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/settings/hooks/use-external-mcp-tool-picker.hooks.ts`) |
| adm-other | `apps/admin/src/features/settings/hooks/use-external-mcp.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/hooks/use-external-mcp.hooks.ts`) |
| adm-other | `apps/admin/src/features/settings/hooks/use-settings-ui.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124b Admin AGREE) |
| adm-other | `apps/admin/src/features/settings/hooks/use-user-interface-tab.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/settings-tabs.ts; planned dest `packages/admin/src/screens/settings/hooks/use-user-interface-tab.hooks.ts`) |
| adm-other | `apps/admin/src/features/settings/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/settings/SettingsUi.tsx; planned dest `packages/admin/src/screens/settings/index.ts`) |
| adm-other | `apps/admin/src/features/settings/rules.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/settings/rules.ts`) |
| adm-other | `apps/admin/src/features/settings/SettingsUi.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/settings/SettingsUi.tsx`) |
| adm-other | `apps/admin/src/features/sites/api/sites-api.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/api/sites-api.types.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/CreateSiteOnboarding.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/CredentialWarnings.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/site-export-actions.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/site-import-actions.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/site-import-controller.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/site-transfer-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/site-transfer-rules.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/sites-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-create-site-plugin-tokens.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-desktop-import.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-live-import-site.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-share-credential-gate.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-site-export-state.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-site-import-state.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-site-list-prefs.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-site-transfer.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-sites.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/hooks/use-static-export-selection.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/import-handoff-port.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/index.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/rules.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/site-export-error.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/site-publish-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/site-transfer-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/site-transfer-rules.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/SiteExportTab.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/SiteImportTab.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/sites-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/sites-list-tabs.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/sites-settings-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/Sites.hooks.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/Sites.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/SitesHomeSetting.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/sites/StaticExportPicker.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/skills/api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/skills/api.ts`) |
| adm-other | `apps/admin/src/features/skills/skill-drop.ts` | MOVED -> `packages/admin/src/screens/skills/skill-drop.ts` |
| adm-other | `apps/admin/src/features/skills/skill-failure-host.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/skills/skill-failure-host.ts`) |
| adm-other | `apps/admin/src/features/skills/skill-install-confirmation-host.ts` | NOT REACHED (blocked: via apps/admin/src/features/skills/skill-failure-host.ts; planned dest `packages/admin/src/screens/skills/skill-install-confirmation-host.ts`) |
| adm-other | `apps/admin/src/features/skills/skills.css` | MOVED -> `packages/admin/src/screens/skills/skills.css` |
| adm-other | `apps/admin/src/features/skills/SkillsPage.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/skills/SkillsPage.tsx`) |
| adm-other | `apps/admin/src/features/skills/use-skill-files.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/skills/use-skill-files.hooks.ts`) |
| adm-other | `apps/admin/src/features/skills/use-skill-install.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/skills/api.ts; planned dest `packages/admin/src/screens/skills/use-skill-install.hooks.ts`) |
| adm-other | `apps/admin/src/features/skills/use-skills-tabs.hooks.ts` | MOVED -> `packages/admin/src/screens/skills/use-skills-tabs.hooks.ts` |
| adm-other | `apps/admin/src/features/skills/use-skills.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/skills/use-skills.hooks.ts`) |
| adm-other | `apps/admin/src/features/taxonomy/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/taxonomy/TaxonomyScreen.tsx; planned dest `packages/admin/src/screens/taxonomy/index.ts`) |
| adm-other | `apps/admin/src/features/taxonomy/taxonomy-host-ports.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/taxonomy/taxonomy-host-ports.ts`) |
| adm-other | `apps/admin/src/features/taxonomy/taxonomy-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/taxonomy/taxonomy-i18n.ts`) |
| adm-other | `apps/admin/src/features/taxonomy/taxonomy-wired.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/screens/taxonomy/taxonomy-wired.hooks.ts`) |
| adm-other | `apps/admin/src/features/taxonomy/TaxonomyScreen.tsx` | NOT REACHED (blocked: via apps/admin/src/components/status-labels.ts; planned dest `packages/admin/src/screens/taxonomy/TaxonomyScreen.tsx`) |
| adm-other | `apps/admin/src/features/trash/api/trash-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/trash/api/trash-api.ts`) |
| adm-other | `apps/admin/src/features/trash/hooks/trash-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/users/api/users-api.ts; planned dest `packages/admin/src/screens/trash/hooks/trash-dependencies.hooks.ts`) |
| adm-other | `apps/admin/src/features/trash/hooks/trash-port.hooks.ts` | MOVED -> `packages/admin/src/screens/trash/hooks/trash-port.hooks.ts` |
| adm-other | `apps/admin/src/features/trash/hooks/use-trash.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/trash/hooks/use-trash.hooks.ts`) |
| adm-other | `apps/admin/src/features/trash/index.ts` | NOT REACHED (blocked: via apps/admin/src/features/trash/Trash.tsx; planned dest `packages/admin/src/screens/trash/index.ts`) |
| adm-other | `apps/admin/src/features/trash/rules.ts` | NOT REACHED (blocked: via apps/admin/src/features/trash/trash-i18n.ts; planned dest `packages/admin/src/screens/trash/rules.ts`) |
| adm-other | `apps/admin/src/features/trash/trash-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/trash/trash-i18n.ts`) |
| adm-other | `apps/admin/src/features/trash/Trash.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/trash/Trash.tsx`) |
| adm-other | `apps/admin/src/features/voice-input/hooks/mic-button-view.hooks.ts` | MOVED -> `packages/admin/src/screens/voice-input/hooks/mic-button-view.hooks.ts` |
| adm-other | `apps/admin/src/features/voice-input/hooks/mic-capture.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/voice-input/hooks/mic-capture.ts`) |
| adm-other | `apps/admin/src/features/voice-input/hooks/push-to-talk-state.hooks.ts` | MOVED -> `packages/admin/src/screens/voice-input/hooks/push-to-talk-state.hooks.ts` |
| adm-other | `apps/admin/src/features/voice-input/hooks/space-hold-config.ts` | MOVED -> `packages/admin/src/screens/voice-input/hooks/space-hold-config.ts` |
| adm-other | `apps/admin/src/features/voice-input/hooks/use-composer-voice-input.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/voice-input/hooks/use-composer-voice-input.hooks.ts`) |
| adm-other | `apps/admin/src/features/voice-input/hooks/use-push-to-talk.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/voice-input/hooks/use-push-to-talk.hooks.ts`) |
| adm-other | `apps/admin/src/features/voice-input/hooks/use-space-hold-to-talk.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/voice-input/hooks/use-space-hold-to-talk.hooks.ts`) |
| adm-other | `apps/admin/src/features/voice-input/push-to-talk-mic-button.css` | MOVED -> `packages/admin/src/screens/voice-input/push-to-talk-mic-button.css` |
| adm-other | `apps/admin/src/features/voice-input/PushToTalkMicButton.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/voice-input/PushToTalkMicButton.tsx`) |
| adm-other | `apps/admin/src/features/voice-input/voice-input-config.ts` | MOVED -> `packages/admin/src/screens/voice-input/voice-input-config.ts` |
| adm-other | `apps/admin/src/features/voice-input/voice-input-port.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124b Admin AGREE) |
| adm-other | `apps/admin/src/features/voice-input/voice-unavailability.ts` | MOVED -> `packages/admin/src/screens/voice-input/voice-unavailability.ts` |
| adm-other | `apps/admin/src/features/voice-input/VoiceInputPlaceholder.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/screens/voice-input/VoiceInputPlaceholder.tsx`) |
| adm-other | `apps/admin/src/features/webmcp/browser-agent-settings.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/webmcp/browser-agent-settings.hooks.ts`) |
| adm-other | `apps/admin/src/features/widgets/widgets-host-ports.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/screens/widgets/widgets-host-ports.ts`) |
| adm-other | `apps/admin/src/features/widgets/widgets-i18n.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/screens/widgets/widgets-i18n.ts`) |
| adm-other | `apps/admin/src/features/workspace/api/workspace-api.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/hooks/use-workspace-redirect.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/hooks/workspace-dependencies.hooks.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/index.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/rules.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/workspace-i18n.ts` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/workspace.css` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/Workspace.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-other | `apps/admin/src/features/workspace/WorkspaceRedirect.tsx` | STAYS-HOST (Tovu product screen (assistant dock / dashboard / sites switcher)) |
| adm-shell-components | `apps/admin/src/components/AdminByokKeyPanel.tsx` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/shell/components/AdminByokKeyPanel.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/assistant-dock-props.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/assistant-dock-props.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/assistant-runtime-preferences.adapter.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/assistant-runtime-preferences.adapter.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/assistant-runtime-preferences.ts` | NOT REACHED (blocked: via apps/admin/src/components/AssistantDock/chat-display-preferences.ts; planned dest `packages/admin/src/shell/components/AssistantDock/assistant-runtime-preferences.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/AssistantDock.state.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/AssistantDock.state.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/AssistantDock.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/AssistantDock.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/chat-agent-plugin-preferences.adapter.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/chat-agent-plugin-preferences.adapter.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/chat-display-preferences.adapter.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/chat-display-preferences.adapter.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/chat-display-preferences.ts` | NOT REACHED (blocked: via apps/admin/src/lib/settings-tabs.ts; planned dest `packages/admin/src/shell/components/AssistantDock/chat-display-preferences.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/DockChatPane.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/DockChatPane.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/DockHeader.tsx` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124b Admin AGREE) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/DockHeaderTip.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/DockHeaderTip.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/DockLeadingAccessory.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/DockLeadingAccessory.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/execution-config-write.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/execution-config-write.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/FolderDropNotice.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/FolderDropNotice.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/agents-inventory.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/agents-inventory.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/assistant-mcp-ui.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/assistant-mcp-ui.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/assistant-transport.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/assistant-transport.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/byok-runtime.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/byok-runtime.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/composer-discovery.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/composer-discovery.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/composer-files.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/composer-files.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/composer-skills.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/composer-skills.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/dock-chrome.hooks.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123r AGREE (basenames resolved in tree)) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/execution-config-ledger.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/execution-config-ledger.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/execution-config.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/execution-config.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/local-cli-selection.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/local-cli-selection.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/messages-change.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/messages-change.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/resolve-composer-discovery-outcome.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/resolve-composer-discovery-outcome.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/run-context.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/run-context.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/runtime-access.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/runtime-access.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/selected-agent-plugins.hooks.ts` | MOVED -> `packages/admin/src/shell/components/AssistantDock/hooks/selected-agent-plugins.hooks.ts` |
| adm-shell-components | `apps/admin/src/components/AssistantDock/hooks/use-dock-renderer-registry.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/hooks/use-dock-renderer-registry.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/OverflowAwareMcpUiSurfaceCard.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/AssistantDock/OverflowAwareMcpUiSurfaceCard.tsx`) |
| adm-shell-components | `apps/admin/src/components/AssistantDock/RoutedA2uiSurfaceCard.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/AssistantDock/RoutedA2uiSurfaceCard.tsx`) |
| adm-shell-components | `apps/admin/src/components/ChatFab/ChatFab.tsx` | NOT REACHED (blocked: via apps/admin/src/lib/settings-tabs.ts; planned dest `packages/admin/src/shell/components/ChatFab/ChatFab.tsx`) |
| adm-shell-components | `apps/admin/src/components/ConfirmActionDialog.tsx` | MOVED -> `packages/admin/src/shell/components/ConfirmActionDialog.tsx` |
| adm-shell-components | `apps/admin/src/components/CredentialHint.tsx` | NOT REACHED (blocked: via apps/admin/src/hooks/use-credential-hint.hooks.ts; planned dest `packages/admin/src/shell/components/CredentialHint.tsx`) |
| adm-shell-components | `apps/admin/src/components/device-preview-icons.tsx` | MOVED -> `packages/admin/src/shell/components/device-preview-icons.tsx` |
| adm-shell-components | `apps/admin/src/components/DevicePreview/DevicePreviewFrame.tsx` | MOVED -> `packages/admin/src/shell/components/DevicePreview/DevicePreviewFrame.tsx` |
| adm-shell-components | `apps/admin/src/components/DevicePreview/DevicePreviewToggle.tsx` | MOVED -> `packages/admin/src/shell/components/DevicePreview/DevicePreviewToggle.tsx` |
| adm-shell-components | `apps/admin/src/components/EmbedInsertControl/EmbedInsertControl.hooks.tsx` | NOT REACHED (blocked: via apps/admin/src/components/WidgetPickerDialog/WidgetPickerDialog.tsx; planned dest `packages/admin/src/shell/components/EmbedInsertControl/EmbedInsertControl.hooks.tsx`) |
| adm-shell-components | `apps/admin/src/components/EmbedInsertControl/EmbedInsertControl.tsx` | NOT REACHED (blocked: via apps/admin/src/components/EmbedInsertControl/EmbedInsertControl.hooks.tsx; planned dest `packages/admin/src/shell/components/EmbedInsertControl/EmbedInsertControl.tsx`) |
| adm-shell-components | `apps/admin/src/components/InstallTabCard/install-tab-card.css` | MOVED -> `packages/admin/src/shell/components/InstallTabCard/install-tab-card.css` |
| adm-shell-components | `apps/admin/src/components/InstallTabCard/InstallTabCard.tsx` | MOVED -> `packages/admin/src/shell/components/InstallTabCard/InstallTabCard.tsx` |
| adm-shell-components | `apps/admin/src/components/MailStatusBanner/hooks/use-mail-status-banner.hooks.ts` | MOVED -> `packages/admin/src/shell/components/MailStatusBanner/hooks/use-mail-status-banner.hooks.ts` |
| adm-shell-components | `apps/admin/src/components/MailStatusBanner/mail-status-banner.css` | MOVED -> `packages/admin/src/shell/components/MailStatusBanner/mail-status-banner.css` |
| adm-shell-components | `apps/admin/src/components/MediaEditDialog/MediaEditDialog.hooks.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/MediaEditDialog/MediaEditDialog.hooks.tsx`) |
| adm-shell-components | `apps/admin/src/components/MediaEditDialog/MediaEditDialog.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/MediaEditDialog/MediaEditDialog.tsx`) |
| adm-shell-components | `apps/admin/src/components/MediaPickerDialog/media-picker-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/api/media-api.ts; planned dest `packages/admin/src/shell/components/MediaPickerDialog/media-picker-dependencies.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/MediaPickerDialog/media-picker-port.hooks.ts` | MOVED -> `packages/admin/src/shell/components/MediaPickerDialog/media-picker-port.hooks.ts` |
| adm-shell-components | `apps/admin/src/components/MediaPickerDialog/MediaPickerDialog.hooks.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/MediaPickerDialog/MediaPickerDialog.hooks.tsx`) |
| adm-shell-components | `apps/admin/src/components/MediaPickerDialog/MediaPickerDialog.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/MediaPickerDialog/MediaPickerDialog.tsx`) |
| adm-shell-components | `apps/admin/src/components/Placeholder.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/Placeholder.tsx`) |
| adm-shell-components | `apps/admin/src/components/PlainTextBlocks.tsx` | MOVED -> `packages/admin/src/shell/components/PlainTextBlocks.tsx` |
| adm-shell-components | `apps/admin/src/components/SecretInput/SecretInput.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/SecretInput/SecretInput.tsx`) |
| adm-shell-components | `apps/admin/src/components/Select/Select.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/Select/Select.tsx`) |
| adm-shell-components | `apps/admin/src/components/status-labels.ts` | NOT REACHED (blocked: via apps/admin/src/hooks/use-admin-locale.hooks.ts; planned dest `packages/admin/src/shell/components/status-labels.ts`) |
| adm-shell-components | `apps/admin/src/components/TemplateSource/template-source-dependencies.hooks.ts` | STAYS-HOST (default port bound to global fetch (host wiring; Jini HW4-injected-fetch)) |
| adm-shell-components | `apps/admin/src/components/TemplateSource/TemplateSourceModal.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/components/TemplateSource/use-template-source.hooks.ts; planned dest `packages/admin/src/shell/components/TemplateSource/TemplateSourceModal.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/TemplateSource/TemplateSourceModal.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/TemplateSource/TemplateSourceModal.tsx`) |
| adm-shell-components | `apps/admin/src/components/TemplateSource/use-template-source.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/TemplateSource/use-template-source.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/HtmlAttributeRows.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/WidgetConfigFields/HtmlAttributeRows.tsx`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/media-content-rules.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/WidgetConfigFields/media-content-rules.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/MediaContentEditor.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/components/MediaPickerDialog/MediaPickerDialog.hooks.tsx; planned dest `packages/admin/src/shell/components/WidgetConfigFields/MediaContentEditor.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/MediaContentEditor.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/WidgetConfigFields/MediaContentEditor.tsx`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/widget-config-fields-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/collections/collections-host-ports.ts; planned dest `packages/admin/src/shell/components/WidgetConfigFields/widget-config-fields-dependencies.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/widget-config-fields-port.hooks.ts` | MOVED -> `packages/admin/src/shell/components/WidgetConfigFields/widget-config-fields-port.hooks.ts` |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/WidgetConfigFields.tsx` | NOT REACHED (blocked: via apps/admin/src/components/WidgetConfigFields/MediaContentEditor.tsx; planned dest `packages/admin/src/shell/components/WidgetConfigFields/WidgetConfigFields.tsx`) |
| adm-shell-components | `apps/admin/src/components/WidgetConfigFields/WidgetPreview.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/WidgetConfigFields/WidgetPreview.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetPickerDialog/widget-picker-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/widgets/widgets-host-ports.ts; planned dest `packages/admin/src/shell/components/WidgetPickerDialog/widget-picker-dependencies.hooks.ts`) |
| adm-shell-components | `apps/admin/src/components/WidgetPickerDialog/widget-picker-port.hooks.ts` | MOVED -> `packages/admin/src/shell/components/WidgetPickerDialog/widget-picker-port.hooks.ts` |
| adm-shell-components | `apps/admin/src/components/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/components/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`) |
| adm-shell-components | `apps/admin/src/components/WidgetPickerDialog/WidgetPickerDialog.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/components/WidgetPickerDialog/WidgetPickerDialog.tsx`) |
| adm-shell-lib | `apps/admin/src/lib/addons-routes.ts` | STAYS-HOST (host URL-migration policy; Jini owns the generic half at the same path) |
| adm-shell-lib | `apps/admin/src/lib/admin-dev-origin.ts` | STAYS-HOST (reads the host build-time define __TOVU_ADMIN_DEV_PORT__ by default) |
| adm-shell-lib | `apps/admin/src/lib/admin-failure-channel.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/admin-failure-channel.ts`) |
| adm-shell-lib | `apps/admin/src/lib/admin-http/config.ts` | MOVED -> `packages/admin/src/shell/lib/admin-http/config.ts` |
| adm-shell-lib | `apps/admin/src/lib/admin-http/request.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/admin-http/request.ts`) |
| adm-shell-lib | `apps/admin/src/lib/admin-http/settings-api.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/shell/lib/admin-http/settings-api.ts`) |
| adm-shell-lib | `apps/admin/src/lib/admin-http/settings-api.types.ts` | MOVED -> `packages/admin/src/shell/lib/admin-http/settings-api.types.ts` |
| adm-shell-lib | `apps/admin/src/lib/admin-http/urls.ts` | MOVED -> `packages/admin/src/shell/lib/admin-http/urls.ts` |
| adm-shell-lib | `apps/admin/src/lib/admin-nav-i18n.ts` | STAYS-HOST (binds the host dictionary; Jini owns ADMIN_NAV_DICT) |
| adm-shell-lib | `apps/admin/src/lib/admin-post-list-sort.ts` | MOVED -> `packages/admin/src/shell/lib/admin-post-list-sort.ts` |
| adm-shell-lib | `apps/admin/src/lib/agent-navigation-entities.ts` | NOT REACHED (blocked: via apps/admin/src/features/integrations/integrations-host-ports.ts; planned dest `packages/admin/src/shell/lib/agent-navigation-entities.ts`) |
| adm-shell-lib | `apps/admin/src/lib/agent-pages.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/agent-pages.ts`) |
| adm-shell-lib | `apps/admin/src/lib/agent-screenshot.ts` | STAYS-HOST (html2canvas host adapter; Jini owns the executor) |
| adm-shell-lib | `apps/admin/src/lib/app-version.ts` | STAYS-HOST (exports the host build-time version defines) |
| adm-shell-lib | `apps/admin/src/lib/assistant-chats.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123r AGREE (basenames resolved in tree) (basename assistant-chats)) |
| adm-shell-lib | `apps/admin/src/lib/assistant-daemon-activation.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/assistant-daemon-activation.ts`) |
| adm-shell-lib | `apps/admin/src/lib/assistant-transport-ag-ui.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/assistant-transport-ag-ui.ts`) |
| adm-shell-lib | `apps/admin/src/lib/assistant-transport.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/assistant-transport.ts`) |
| adm-shell-lib | `apps/admin/src/lib/block-atom-insert.ts` | STAYS-HOST (tiptap editor code stays in host (owner 11-23, coordinator-decisions-wave5 §13)) |
| adm-shell-lib | `apps/admin/src/lib/browser-telemetry.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/request.ts; planned dest `packages/admin/src/shell/lib/browser-telemetry.ts`) |
| adm-shell-lib | `apps/admin/src/lib/chat-attachment-liveness.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123r AGREE (basenames resolved in tree)) |
| adm-shell-lib | `apps/admin/src/lib/credential-copy.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/credential-copy.ts`) |
| adm-shell-lib | `apps/admin/src/lib/descriptor-i18n.ts` | MOVED -> `packages/admin/src/shell/lib/descriptor-i18n.ts` |
| adm-shell-lib | `apps/admin/src/lib/durable-run-subscription.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/durable-run-subscription.ts`) |
| adm-shell-lib | `apps/admin/src/lib/execution-settings.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/execution-settings.ts`) |
| adm-shell-lib | `apps/admin/src/lib/fetch-query/provider.tsx` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/fetch-query/provider.tsx`) |
| adm-shell-lib | `apps/admin/src/lib/i18n-common.ts` | STAYS-HOST (Tovu product words) |
| adm-shell-lib | `apps/admin/src/lib/jini-admin-tokens.css` | STAYS-HOST (the host binding of --jini-admin-* to host theme tokens) |
| adm-shell-lib | `apps/admin/src/lib/ledger-slice.ts` | NOT REACHED (blocked: via apps/admin/src/lib/admin-http/settings-api.ts; planned dest `packages/admin/src/shell/lib/ledger-slice.ts`) |
| adm-shell-lib | `apps/admin/src/lib/media-embed-extension.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/features/media/api/media-api.ts; planned dest `packages/admin/src/shell/lib/media-embed-extension.hooks.ts`) |
| adm-shell-lib | `apps/admin/src/lib/media-embed-extension.tsx` | NOT REACHED (blocked: via apps/admin/src/components/MediaPickerDialog/MediaPickerDialog.tsx; planned dest `packages/admin/src/shell/lib/media-embed-extension.tsx`) |
| adm-shell-lib | `apps/admin/src/lib/media-image-extension.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/media-image-extension.tsx`) |
| adm-shell-lib | `apps/admin/src/lib/owner-clients.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/owner-clients.ts`) |
| adm-shell-lib | `apps/admin/src/lib/post-title-extension.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1124b Admin AGREE) |
| adm-shell-lib | `apps/admin/src/lib/publish-criteria-deep-link.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/publish-criteria-deep-link.ts`) |
| adm-shell-lib | `apps/admin/src/lib/retry-unreachable.ts` | STAYS-HOST (Codex AGREE STAYS-HOST: rv1123r AGREE (basenames resolved in tree)) |
| adm-shell-lib | `apps/admin/src/lib/server-reconnect.ts` | STOPPED (module singleton reads import.meta.env.MODE and a host header literal; recommend: class moves with mode+header as args, the singleton becomes a Tovu binding) |
| adm-shell-lib | `apps/admin/src/lib/settings-events.ts` | NOT REACHED (blocked: via apps/admin/src/features/themes/theme-preview-refresh.ts; planned dest `packages/admin/src/shell/lib/settings-events.ts`) |
| adm-shell-lib | `apps/admin/src/lib/settings-tabs.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/settings-tabs.ts`) |
| adm-shell-lib | `apps/admin/src/lib/shell-collaborators.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/lib/shell-collaborators.ts`) |
| adm-shell-lib | `apps/admin/src/lib/shell-notices-wiring.tsx` | NOT REACHED (blocked: via apps/admin/src/lib/admin-failure-channel.ts; planned dest `packages/admin/src/shell/lib/shell-notices-wiring.tsx`) |
| adm-shell-lib | `apps/admin/src/lib/site-url.ts` | STAYS-HOST (reads the host env VITE_TOVU_SITE_URL; ~20 callers would need a new arg) |
| adm-shell-lib | `apps/admin/src/lib/tovu-execution-policy.ts` | STAYS-HOST (product-named file (tovu-*)) |
| adm-shell-lib | `apps/admin/src/lib/widget-embed-extension.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/widget-embed-extension.hooks.ts`) |
| adm-shell-lib | `apps/admin/src/lib/widget-embed-extension.tsx` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/lib/widget-embed-extension.tsx`) |
| adm-shell-hooks | `apps/admin/src/hooks/admin-execution-credential-dependencies.hooks.ts` | NOT REACHED (blocked: via apps/admin/src/lib/execution-settings.ts; planned dest `packages/admin/src/shell/hooks/admin-execution-credential-dependencies.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/admin-locale-dependencies.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/admin-locale-dependencies.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/assistant-chats-dependencies.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/assistant-chats-dependencies.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-admin-appearance-snapshot.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-admin-appearance-snapshot.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-admin-appearance.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/use-admin-appearance.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-admin-execution-credential.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-admin-execution-credential.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-admin-locale.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-admin-locale.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-assistant-chats.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/use-assistant-chats.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-credential-hint.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/use-credential-hint.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-interface-preferences.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-interface-preferences.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-settings-slice.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-settings-slice.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-standing-draft-autosave.hooks.ts` | NOT REACHED (blocked: xp3; planned dest `packages/admin/src/shell/hooks/use-standing-draft-autosave.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-tovu-execution-adapters.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/use-tovu-execution-adapters.hooks.ts`) |
| adm-shell-hooks | `apps/admin/src/hooks/use-tovu-execution-policy.hooks.ts` | NOT REACHED (blocked: tovu-dep; planned dest `packages/admin/src/shell/hooks/use-tovu-execution-policy.hooks.ts`) |
