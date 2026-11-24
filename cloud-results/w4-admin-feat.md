PARTIAL 430354a7bb 181249562: 87 owned files SKIPPED (blocked by unowned K4 type files, the K4-i18n-common seam, non-admin deps such as tiptap/ui/cms, non-jini CSS, or other-lane siblings); 18 moved/removed, 77 STAYS-HOST

# w4-admin-feat — admin feature folders (wave 4)

Unattended Opus coordinator run, 2026-11-24. Branches: Jini `codex/w4-admin-feat-jini`, Tovu `codex/w4-admin-feat-tovu`, both cut from `origin/integ/merge-16-2026-11-23` (Jini `7490405a8`, Tovu `3a9332247`). Before the final push the merge-16 heads were re-fetched; they had not moved (0 commits behind), so no merge was needed.

`AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Its rules were applied: minimum change, architecture audit, pre-completion checklist, and honest test counts.

## Result

| | count |
|---|---|
| Owned files (`inputs/w4/admin-feat.txt`) | 182 |
| MOVE to `@jini-ai/admin` | 17 |
| Deleted as dead code | 1 (`redirects/api/redirects-api.types.ts`, 0 importers; Jini `core/ports/redirects.ts` already owns those shapes) |
| STAYS-HOST (counts as done) | 77 |
| SKIP (exact blocker per file below) | 87 |
| **FILES LEFT, owned list** | 182 → **164** present in Tovu, of which 77 are STAYS-HOST, so **87 Jini-bound left** |
| **FILES LEFT, plan tools** (`scan.mjs` + `plan.mjs` "moving") | **2,187 → 2,171** (base = merge-16, matching combine-16's 2,187) |

## Batches

| batch | model | files moved | importers edited | tests | status |
|---|---|---|---|---|---|
| A plugins (28) | Opus (opus-high) | 8: `plugins-api.types`, `plugins-api` (factory + `plugins-host-ports.ts`), `selected-skills`, `use-plugin-row-focus` (+ required `summarySelector`), 3 ports, `PluginProviderSettingField.hooks` | about 40 import lines (AssistantDock hooks, `lib/assistant-transport`, `lib/__tests__` request-shape suites, plugins screens/hooks/tests); call site `PluginRow.tsx:120` | `selected-skills` test moved, 8 → 8 | done |
| B posts/pages/redirects/trash (29) | Sonnet, high | 6 + 1 dead-delete: `Posts.hooks` (required `translate`, K3), `trash-api.types`, `theme-canvas-port`, `theme-pages-port`, `theme-canvas-wrapper`, `ThemePageDetailsModal.hooks` (kit values) | pages hooks/tests, `Trash.tsx`, trash api/hooks/tests, `Posts.tsx` call site | `theme-canvas-wrapper` test moved, 12 → 12 | done after review (2 moves backed out, see below) |
| C security/deploy/source-control/providers (42) | Opus (opus-high) | 3: `providers-api` (factory + `providers-host-ports.ts`), `SiteKeyTab.hooks`, `security-permissions-port` | `SiteKeyTab.tsx`, security dependency hooks, `lib/__tests__` clients | `useRevealedKeyCopy` case moved, Tovu 11 → 10 and Jini 0 → 1; new Jini `providers-api` wire test (1) | done |
| D integrations/settings/media/members/dicts/barrels (41) | Sonnet, high | 0 | none | n/a | done (all STAYS-HOST/SKIP) |
| Review | Opus (opus-high) | — | — | — | FIX NEEDED → fixed: README wiring, AdminPlugin wire-vs-port note, host-neutral comments |

Commits (Jini): `1ac4aae9`, `38d62c73`, `d3fd89c6f`, `181249562`. Commits (Tovu): `6f9651586`, `48b5a64acb`, `c569ae2c88`, `430354a7bb`, plus this report.

### Coordinator review fixes (before the final push)
- `use-plugin-row-focus`: Jini no longer hard-codes the host class `.plugin-row-summary`. The selector is now a REQUIRED `summarySelector` field on the existing args object, and the host passes the same string, so behaviour is identical.
- Backed out `posts/post-editor-route-key.ts`. Jini guard HW3 rejects its module-level mutable state; making it instance-owned would change behaviour. It is now SKIP.
- Backed out `pages/hooks/theme-canvas-dependencies.hooks.ts`. Jini guard HW4 rejects the global `fetch`, and the file is the host's fetch adapter. It is now STAYS-HOST. The error-gate debt entries were restored, so neither repo has a debt diff.
- Dropped the `redirects-api.types` move. The file was dead (0 importers), and moving it would have duplicated Jini `core/ports/redirects.ts`. The Tovu file was deleted.
- Reworded comments that named host source paths (Jini guard N2). Every reworded or deleted why-comment has a reasoned entry in Tovu `development/why-comments-debt.json` (17 entries, appended).

## Self-check (Codex failure list)
- No re-export or forwarding files. `plugins-host-ports.ts` and `providers-host-ports.ts` build bound singletons; they do not forward.
- Hooks that reach Jini code take their host collaborators as REQUIRED fields (`summarySelector`, `translate`). No Jini file defaults a hook, and `check:hooks` passes.
- No server-framework types and no host log formatters in Jini. Jini imports only relative files, `react` and `@jini-ai/core/*`; the admin kit is used for `ThemePageDetailsModal.hooks`.
- Jini components emit `jini-*` classes only. No moved file renders DOM classes, and the one host-class lookup was removed.
- No new size-exception entries. No function over 80 lines or complexity over 10 was added.
- Shared wire types: `plugins-api.types` and `trash-api.types` are admin-local wire DTOs, following the w3 posts precedent. The README notes that `core/ports/plugins.ts`'s `AdminPlugin` is the port view. No core owner was changed.
- New exported functions take object args with `_optional = {}`: `createPluginsApi`, `createProvidersApi`, `usePluginRowFocus`, `createPostsTranslator`.
- No behaviour change, so no mutation was needed. Wire parity is pinned by the Tovu `lib/__tests__` request-shape suites, which now run through the host-ports bindings, plus the new Jini `providers-api` test.
- Why-comments moved with the code (see the review fixes above).
- `## Wiring` sections:
  - Jini: `screens/plugins`, `screens/providers`, `screens/trash`, `pages`, `posts` and `security/host` READMEs.
  - Tovu: `plugins/README.md`, `posts/README.md` and `pages/README.md`, plus new `INFO.md` files for providers, trash and security.
- Shared files were union-edited, additively: Jini `packages/admin/package.json` (17 exports plus `jini.entries`), `api-baseline/jini-ai__admin.json` (additions only) and Tovu `development/why-comments-debt.json` (appended).

## Gates (base = merge-16; no new red)

Jini:

| gate | head | vs base |
|---|---|---|
| `pnpm -r build` (initial) | 0 | — |
| admin `tsc` build | 0 errors | — |
| `typecheck` for `...@jini-ai/admin` (admin and its dependents) | 0 | — |
| `guard` | only R13 environment notes plus `HW3 shell/lib/shell-failure-log.ts` | both also on base; the lane's HW3, HW4 and N2 hits were fixed |
| `api:check` | 0 after `api:update` | baseline additions only |
| `check:size` | exit 1 | no `packages/admin` entry; all reds are in untouched packages (cms redirects, daemon launch, sidecar stale debt) |
| `check:complexity` | exit 1 | no `packages/admin` entry; reds are in core, ui, chat, agent-runtime |
| `check:why-comments` | 377 lost | base 378; none are lane files |
| `check:hooks` | ok | — |
| XP `check:cross-package` | cannot run here | needs `JINI_DECLARATION_BASELINE_DIR`; lists no lane file |
| changed vitest (`src/screens`, `src/security/host`, `src/pages`, `src/posts`) | 14 files / 90 tests PASS | — |
| `check:errors` | WARN mode | no lane entry |

Tovu:

| gate | head | vs base |
|---|---|---|
| admin `tsc --noEmit` | 0 | base 0 |
| root `typecheck` | exit 2, 12 error lines | identical to base |
| `typecheck:tests` | exit 2, 46 error lines | identical to base (`@tovu/sdk` website tests) |
| `check:size` | exit 1 | same 10 lines as base |
| `check:complexity` | 0 | 0 |
| `check:hooks` | 0 | 0 |
| `check:admin-complexity-drift` | 0 | 0 |
| `check:why-comments` | exit 1, 78 lost, 0 from lane files | base worktree measured 2,071 in an unlinked worktree; the lane's own 17 are allow-listed with reasons |

Tovu tests:
- Admin vitest on every changed file and importer (plugins, pages, posts, trash, security, providers, skills, `lib/__tests__`, AssistantDock composer, fqfix, editor-session-expiry, theme-preview-dirty, app-dock-visibility): 264 files, 4,905 pass and 2 fail.
- After the review backouts, the touched dirs were re-run: 62 files, 1,543 pass and the same 2 fail.
- Both failures are base-red and outside the lane:
  - `admin-literal-copy` flags `features/collections/*Dialog` placeholders.
  - `credential-input-autocomplete` flags Jini `ui/react/testing.tsx:10`.
- Node tests: no changed file is node-tested. All changed code is admin/vitest, and `development/why-comments-debt.json` is data.

## Decisions per file

### Plan STAYS (42)
| file | decision | reason |
|---|---|---|
| `admin-themes/AdminThemes.tsx` | STAYS-HOST | admin composition and look: `admin-themes/` is listed under §5 "What stays" of `P9K-extraction.md`; themes lane excluded from this run |
| `admin-themes/admin-themes-i18n.ts` | STAYS-HOST | admin composition and look: `admin-themes/` is listed under §5 "What stays" of `P9K-extraction.md`; themes lane excluded from this run |
| `admin-themes/index.ts` | STAYS-HOST | admin composition and look: `admin-themes/` is listed under §5 "What stays" of `P9K-extraction.md`; themes lane excluded from this run |
| `ai-assistant/ai-assistant-layout-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `ai-assistant/hooks/use-admin-execution-mode.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `ai-assistant/index.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `ai-assistant/visitor-tools-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `dashboard/hooks/use-recent-activity-disclosure.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `playground/Playground.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `playground/Playground.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `playground/index.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `playground/playground-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/CreateSiteOnboarding.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/CredentialWarnings.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/StaticExportPicker.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/site-import-actions.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/site-transfer-rules.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/use-desktop-import.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/use-export-password.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/use-share-credential-gate.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/use-site-transfer.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/hooks/use-static-export-selection.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/site-export-error.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/site-publish-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/site-transfer-rules.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/sites-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `sites/sites-settings-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/PushToTalkMicButton.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/VoiceInputPlaceholder.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/mic-button-view.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/mic-capture.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/push-to-talk-state.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/space-hold-rules.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/use-composer-voice-input.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/use-push-to-talk.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/hooks/use-space-hold-to-talk.hooks.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/voice-input-config.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/voice-input-port.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `voice-input/voice-unavailability.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `workspace/WorkspaceRedirect.tsx` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `workspace/index.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |
| `workspace/workspace-i18n.ts` | STAYS-HOST | Tovu product screen (assistant dock / dashboard / sites switcher) (plan `stays-in-tovu.md`) |

### Batch A + B
Batch A (plugins; Opus): 8 MOVE, 3 STAYS-HOST, 17 SKIP.
| file | decision | destination / reason |
|---|---|---|
| plugins/api/plugins-api.types.ts | MOVE | `packages/admin/src/screens/plugins/api/plugins-api.types.ts` |
| plugins/api/plugins-api.ts | MOVE | `screens/plugins/api/plugins-api.ts`, `createPluginsApi({ request, workspaceId })`; Tovu binding `features/plugins/plugins-host-ports.ts`; paths/methods/bodies identical (Tovu `lib/__tests__` request-shape suites green) |
| plugins/selected-skills.ts | MOVE | `screens/plugins/selected-skills.ts` (test moved: 8 → 8) |
| plugins/hooks/use-plugin-row-focus.hooks.ts | MOVE | `screens/plugins/hooks/use-plugin-row-focus.hooks.ts`; the host's summary selector is now a REQUIRED `summarySelector` field (passed by `PluginRow.tsx`; the hook previously hard-coded `.plugin-row-summary`) |
| plugins/hooks/agent-plugin-memory-port.hooks.ts, plugins/hooks/plugin-install-port.hooks.ts, plugins/hooks/plugins-port.hooks.ts | MOVE | `screens/plugins/hooks/…` (port interfaces) |
| plugins/PluginProviderSettingField.hooks.ts | MOVE | `screens/plugins/PluginProviderSettingField.hooks.ts` |
| plugins/package-file-tree.ts | STAYS-HOST | binds the host locale over Jini's own `agent-plugins/package-file-tree`; moving it would be a Jini forwarding wrapper |
| plugins/hooks/agent-plugins-dependencies.hooks.ts | STAYS-HOST | binds the Tovu `integrationsApi` singleton |
| plugins/index.ts | STAYS-HOST | host barrel for `panel-pages.ts` |
| plugins/hooks/use-package-file-tree.hooks.ts | SKIP | duplicates Jini `useAgentPluginFileTree` (`agent-plugins/react/hooks/AgentPluginInspector.hooks.ts`), which returns a different row shape; follow-up: move the host `PackageFilesModal` onto Jini's hook and delete both |
| plugins/AgentPluginMemoryPanel.tsx | SKIP | non-`jini-` classes (`card`, `field-group`, `btn-primary`, …); controller type from the w3-addons hook |
| plugins/PluginPackageFilesModal.tsx | SKIP | renders the unowned Tovu `PackageFilesModal`; `useFiles` defaults to a Tovu wired hook |
| plugins/AgentPluginMaturity.tsx | SKIP | `InfoTip` from `@jini-ai/ui/admin-widgets` (no kit facade); unowned `integrations-api.types` |
| plugins/AgentPluginUpdateControl.tsx | SKIP | renders the Tovu `AddAgentPluginPanel`; type from a skipped hook |
| plugins/AgentPlugins.hooks.ts | SKIP | unowned `integrations-api.types`; w3-addons controller type |
| plugins/PluginProviderSettingField.tsx | SKIP | unowned Tovu `components/SecretInput` |
| plugins/PluginProviderSettingsDialog.tsx | SKIP | `@jini-ai/ui-kit/react` is not an admin dependency; w3-addons `rules.ts`; host CSS |
| plugins/PluginRemoveConfirmDialog.tsx | SKIP | `ConfirmActionDialog` (w4-admin-shell); w3-settings hook |
| plugins/admin-surface-theme.ts | SKIP | `@jini-ai/agent-plugins/admin-surfaces` is not an admin dependency (adding it = LOCK) |
| plugins/hooks/agent-plugin-install-port.hooks.ts, plugins/hooks/agent-plugins-port.hooks.ts | SKIP | unowned `integrations-api.types` (K4) |
| plugins/hooks/use-agent-plugin-details-modal.hooks.ts, plugins/hooks/use-plugin-package-files.hooks.ts, plugins/hooks/use-plugin-provider-settings.hooks.ts | SKIP | Tovu `useAdminLocale`, `plugins-i18n`, w3 `rules.ts` and default Tovu ports |
| plugins/hooks/use-agent-plugin-update.hooks.ts | SKIP | unowned `integrations-api.types`; w3 `rules.ts` |
| plugins/plugins-i18n.ts | SKIP | composes the host `lib/i18n-common` at load time (K4-i18n-common seam) |

Batch B (posts, pages, redirects, trash; Sonnet high): 6 MOVE, 1 deleted as dead, 6 STAYS-HOST, 16 SKIP (after review).
| file | decision | destination / reason |
|---|---|---|
| posts/Posts.hooks.ts | MOVE | `packages/admin/src/posts/Posts.hooks.ts`; `createPostsTranslator({ locale, translate })` takes the host dictionary lookup as a REQUIRED field (K3/K5); `Posts.tsx` passes `translate: translateForPosts` |
| trash/api/trash-api.types.ts | MOVE | `packages/admin/src/screens/trash/api/trash-api.types.ts` (9 importers repointed) |
| pages/hooks/theme-canvas-port.hooks.ts, pages/hooks/theme-pages-port.hooks.ts | MOVE | `packages/admin/src/pages/hooks/…` (interfaces) |
| pages/hooks/theme-canvas-wrapper.ts | MOVE | `packages/admin/src/pages/hooks/theme-canvas-wrapper.ts`; `CanvasContentWrapperNode` type from the admin kit (same shape); test moved (12 → 12) |
| pages/ThemePageDetailsModal.hooks.tsx | MOVE | `packages/admin/src/pages/ThemePageDetailsModal.hooks.tsx`; lightbox open/close through `useAdminKitValues()` (K2) |
| redirects/api/redirects-api.types.ts | DELETED (dead) | 0 importers in Tovu; Jini `core/ports/redirects.ts` already owns the redirect shapes, so moving it would add a duplicate |
| pages/hooks/theme-canvas-dependencies.hooks.ts | STAYS-HOST | the host's global-`fetch` adapter for `ThemeCanvasPort`; Jini guard HW4 (injected fetch) rejects it in Jini (moved then backed out in review) |
| pages/hooks/theme-pages-dependencies.hooks.ts | STAYS-HOST | binds the Tovu `themesApi` |
| pages/index.ts, posts/index.ts, trash/index.ts | STAYS-HOST | host barrels for `panel-pages.ts` |
| posts/post-editor-route-key.ts | SKIP | module-level mutable state (`renamedRouteKeys`, `draftCount`): Jini guard HW3 requires instance-owned state; a refactor would change behaviour (moved then backed out in review) |
| posts/PostCoverImage.tsx | SKIP | Tovu `MediaPickerDialog`, w3-content hooks/rules; non-`jini-` classes; `InfoTip` |
| posts/editor/header/PostEditorActions.tsx | SKIP | non-`jini-` classes (`editor-action-row`, `btn-danger`, `save-ok`) |
| posts/editor/notices/PostEditorSlugCollisionWarning.tsx | SKIP | w3-content `posts/rules.ts`; `notice warning` classes |
| posts/editor/toolbar/ToolbarColorGroup.tsx, ToolbarTypographyGroup.tsx | SKIP | w3-content `rules.ts`; tiptap `PostEditor.hooks`; `tb-*` classes |
| posts/PostEditor.hooks.ts, posts/editor/bubble-menu/{bubble-menu-state.ts,BubbleFormattingMenu.tsx}, posts/editor/toolbar/{toolbar-group-props.ts,toolbar-state.ts} | SKIP | `@tiptap/react` is not an admin dependency |
| posts/hooks/use-post-url-dialog.hooks.ts | SKIP | `@tiptap/extension-youtube` |
| posts/hooks/post-editor-file-upload.ts | SKIP | tiptap; w3 `rules.ts`, `post-editor-port.hooks`; w4-admin-shell `live-tiptap-editor` |
| posts/editor/view-bar/view-tabs.ts | SKIP | `import type { PostEditorView }` from the w3-content `use-post-editor.hooks` (move that type first) |
| pages/hooks/use-theme-canvas-styling.hooks.ts | SKIP | `@jini-ai/cms/themes/layout` and `@jini-ai/ui/html-editor` are not admin dependencies |
| pages/hooks/use-theme-pages.hooks.ts | SKIP | `@jini-ai/ui/fetch-query`, unowned `NO_THEME_ID` and `theme-page-publish-state`, w3 `pages/rules.ts`, default Tovu port |
| trash/rules.ts | SKIP | w3-settings `trash-i18n`; Tovu `ApiError` and `describeApiError` |

### Batch C
Batch C (security, deployment, source-control, providers; Opus): 3 MOVE, 13 STAYS-HOST, 26 SKIP.
| file | decision | destination / reason |
|---|---|---|
| providers/api/providers-api.ts | MOVE | `packages/admin/src/screens/providers/api/providers-api.ts`, `createProvidersApi({ request, workspaceId })`; Tovu binding `features/providers/providers-host-ports.ts`; path/method/body byte-identical |
| security/SiteKeyTab.hooks.tsx | MOVE | `packages/admin/src/security/host/SiteKeyTab.hooks.tsx` (`useRevealedKeyCopy`, pure React) |
| security/hooks/security-permissions-port.hooks.ts | MOVE | `packages/admin/src/security/host/hooks/security-permissions-port.hooks.ts` (interface) |
| deployment/hooks/{deployment-overview,dockerfile-source,publish-credentials}-dependencies.hooks.ts | STAYS-HOST | bind Tovu `deploymentApi`/`securityApi` singletons (host adapter) |
| security/hooks/{access-tokens,security-permissions,site-key}-dependencies.hooks.ts | STAYS-HOST | bind Tovu api singletons (security, deployment, source-control, providers, auth, sites) |
| source-control/hooks/source-control-credentials-dependencies.hooks.ts, providers/hooks/always-allow-dependencies.hooks.ts | STAYS-HOST | bind Tovu `sourceControlApi` / `integrationsApi` singletons |
| providers/Providers.tsx | STAYS-HOST | host screen composing Tovu theme, locale, `ExternalMcpSettingsPanel`, integrations hooks and `@jini-ai/ui/tab-strip` |
| deployment/index.ts, providers/index.ts, security/index.ts, source-control/index.ts | STAYS-HOST | host feature barrels for `panel-pages.ts` |
| deployment/api/deployment-api.types.ts, deployment/api/deployment-api.ts, deployment/hooks/{deployment-overview,dockerfile-source,publish-credentials}-port.hooks.ts | SKIP | `AdminPublishCredentialProviderId` comes from the unowned `security/api/security-api.types.ts` (K4 seam); the api and ports depend on those types |
| deployment/OverviewTab.tsx | SKIP | imports the w3-deploy `rules.ts` and `use-deployment-overview.hooks` and the unowned `deployment-visuals`; non-`jini-` classes |
| providers/AlwaysAllowPanel.tsx | SKIP | `./always-allow.css` and non-`jini-` classes; its hook depends on skipped files |
| providers/always-allow-rules.ts, providers/hooks/always-allow-port.hooks.ts | SKIP | unowned `integrations-api.types.ts` (K4) |
| providers/hooks/use-always-allow.hooks.ts | SKIP | Tovu `ApiError`, `useAdminLocale` and skipped rules/port |
| providers/hooks/use-providers.hooks.ts | SKIP | calls the Tovu hook `useExternalMcp` and has no args object to inject it into |
| providers/providers-i18n.ts | SKIP | product name in its values ("restart Tovu to connect") plus the host `COMMON_I18N` |
| security/hooks/use-security-permissions.hooks.ts | SKIP | needs `SITE_KEY_MANAGE_PERMISSION` from the non-movable Tovu `security/rules.ts`; the positional `(port)` signature has no args object |
| security/rules.ts, security/access-token-providers.ts, security/custom-credential-forms.ts, security/api/security-api.ts, security/hooks/access-tokens-port.hooks.ts | SKIP | unowned `security-api.types`, `source-control-api.types`, `access-token-rows`, `access-token-forms` and `source-control/rules` (K4) |
| security/other-credential-stores.ts | SKIP | Tovu `media/media-provider-catalog` (`@jini-ai/integrations`, `@jini-ai/ui`) |
| security/security-i18n.ts | SKIP | host `COMMON_I18N` plus unowned `security-api.types` |
| security/AccessTokensTab.hooks.tsx, security/OtherCredentialsSection.hooks.tsx | SKIP | unowned `access-token-rows`; w3-users-sec hook types |
| security/CopyKeysDialog.tsx, security/SiteKeyRecoveryCard.tsx | SKIP | CSS and non-`jini-` classes; Tovu `SecretInput` and w3 hooks |
| source-control/api/source-control-api.ts, source-control/hooks/source-control-credentials-port.hooks.ts | SKIP | unowned `source-control-api.types` (K4) |
Tests: Tovu `use-site-key.unit.test.tsx` went 11 → 10; its `useRevealedKeyCopy` case moved to Jini `security/host/__tests__/SiteKeyTab.hooks.test.tsx` (1). New Jini `providers-api.test.ts` (1) pins the wire shape. Tovu vitest: 22 files / 583 tests PASS.
Owner flags: (1) the K4 owner for `security-api.types`, `source-control-api.types`, `integrations-api.types` and `access-token-rows` unblocks about 15 files; (2) `use-security-permissions` needs `{ port, permission }` args (recommended as a separate change); (3) `providers-i18n` product copy → host-injected.

### Batch D
Batch D (integrations, settings, media, members, roles, users, dictionaries, barrels): 0 MOVE; 14 STAYS-HOST; 27 SKIP. No files changed.
| file | decision | reason / exact blocker |
|---|---|---|
| collections/collections-i18n.ts, comments/comments-i18n.ts, integrations/integrations-i18n.tsx, menus/menus-i18n.ts, settings/settings-capabilities-i18n.ts, taxonomy/taxonomy-i18n.ts | SKIP | line 1 imports the host `lib/i18n-common` `COMMON_I18N`, and the module builds `createDictionaryTranslator(…, { commonDictionary: COMMON_I18N })` at load time with no args object (K3/K4i; needs the K4-i18n-common seam) |
| collections, database, email, library, recovery, integrations, media, members, settings `index.ts` | STAYS-HOST | host feature barrels consumed by `panel-pages.ts`, `App.tsx` and `AdminUi.tsx` |
| integrations/hooks/integrations-dependencies.hooks.ts, integrations/hooks/integration-deliveries-dependencies.hooks.ts | STAYS-HOST | bind the Tovu `integrationsApi` singleton into the port (host adapter) |
| members/hooks/members-dependencies.hooks.ts, roles/hooks/roles-dependencies.hooks.ts, users/hooks/users-dependencies.hooks.ts | STAYS-HOST | bind the Tovu `membersApi`, `rolesApi`, `usersApi` and `authApi` singletons (host adapter) |
| integrations/hooks/integrations-port.hooks.ts, integrations/hooks/integration-deliveries-port.hooks.ts | SKIP | line 1 imports a type from the unowned Tovu `integrations/api/integrations-api.types.ts`; Jini has no copy (K4 seam) |
| integrations/api/integrations-api.ts | SKIP | its types come from the unowned `integrations-api.types.ts`, and it has 27 importers |
| integrations/hooks/use-integration-deliveries.hooks.ts | SKIP | unowned type; Tovu `describeApiError`, `useAdminLocale`, `integrations-i18n` and the default port binding |
| integrations/IntegrationDeliveries.tsx, integrations/Integrations.tsx | SKIP | import `@/components/status-labels`, the unowned `./rules` (→ Tovu `request` and i18n), a Tovu hook and the i18n dictionary |
| integrations/IntegrationsRedirect.tsx | SKIP | making its host hook a required prop means edits at `panels.tsx:620,626,632,823,1203`, `App.tsx:228` and `AdminUi.tsx:19`, and breaks the `panels-render.unit.test.tsx:128-148,376` element-type assertions (owner decision if wanted) |
| media/RemoteImageImport.tsx | SKIP | `@jini-ai/ui-kit/react` is not an admin dependency; it also uses `DockHeaderTip` and non-`jini-` CSS |
| media/hooks/use-remote-image-import.hooks.ts | SKIP | `@jini-ai/cms/media/import` is not an admin dependency; it also uses Tovu `describeApiError` and a w3-content port |
| media/media-provider-catalog.ts | SKIP | `@jini-ai/integrations` and `@jini-ai/ui` types are not admin dependencies |
| members/MembersPanel.hooks.ts, members/MembersPanel.tsx | SKIP | `@jini-ai/user-management/react` is not an admin dependency; they also use the unowned `members-controller.hooks` and `status-labels` |
| settings/ExternalMcpAdmissionsBanner.tsx | SKIP | non-`jini-` classes (lines 45, 61, 87, 121, 128); also imports the w3-settings rules and a SKIP hook |
| settings/ExternalMcpToolPicker.tsx | SKIP | `@jini-ai/ui` `useT` and `SeeMore` from admin-widgets; also imports w3-settings hooks (lines 6-16) |
| settings/external-mcp-tool-picker-rules.ts | SKIP | unowned type; Tovu `ApiError` and `describeApiError`; w3-settings rules |
| settings/hooks/use-admin-appearance-settings.hooks.ts | SKIP | 3 host hooks plus w3-settings `settings-tabs`; only a wrapper would move |
| settings/hooks/use-ai-agent-presentation.hooks.ts | SKIP | `@jini-ai/ui` types `DetectedAgent`, `ExecutionConfig` and `ExecutionPort` have no kit facade; w3-sites `ai-agent-presentation` |
| settings/hooks/use-external-mcp-admissions.hooks.ts | SKIP | 3 Tovu api singletons, Tovu `request`, and `@jini-ai/ui/panel-kit` |
| settings/hooks/use-external-mcp-tool-picker.hooks.ts | SKIP | unowned type; `integrationsApi` singleton |
| settings/hooks/use-settings-ui.hooks.ts, settings/rules.ts | SKIP | `@jini-ai/ui` / `ui/core` values; unowned `lib/execution-settings` and `use-settings-slice.hooks` |

## STOP / owner items (recommendation first)
1. **K4 type owners (largest unblock).** These Tovu type files are unowned by any lane: `features/integrations/api/integrations-api.types.ts`, `features/security/api/security-api.types.ts`, `features/source-control/api/source-control-api.types.ts` and `features/security/access-token-rows.ts`. They block about 30 owned files (the deployment types/api/ports, the security api/ports/rules/i18n, the source-control api/port, the integrations ports/api/hooks, and the agent-plugin ports). **Recommend:** a K4 step that moves them to `@jini-ai/admin` (or core when shared with the server), then re-run this lane.
2. **K4-i18n-common for feature dictionaries.** 9 dictionaries compose the host `COMMON_I18N` at load time: collections, comments, menus, taxonomy, integrations, plugins, providers, security and settings-capabilities. `providers-i18n` also carries the product name. **Recommend:** a factory `create<X>Dictionary({ commonDictionary })` in Jini, with the host binding in the existing `lib/i18n-common.ts`.
3. **`use-security-permissions.hooks.ts`.** The positional `(port)` signature has no args object, so `SITE_KEY_MANAGE_PERMISSION` cannot be injected under K5 without adding one. **Recommend:** `{ port, permission }` args as a separate, deliberate change.
4. **Duplicate file-tree hooks.** Tovu `usePackageFileTree` duplicates Jini `useAgentPluginFileTree`. **Recommend:** move the host `PackageFilesModal` onto Jini's hook, then delete `use-package-file-tree.hooks.ts` and `package-file-tree.ts`.
5. **`IntegrationsRedirect.tsx`.** Making its hook a required prop touches 7 render sites in `panels.tsx`, `App.tsx` and `AdminUi.tsx`, and breaks the element-type assertions in `panels-render.unit.test.tsx`. Owner call; **recommend** leaving it until the panels composition lane.
6. **Tiptap editor files (8).** `@tiptap/*` is not an `@jini-ai/admin` dependency, and adding it is a LOCK. **Recommend:** keep them in the host until a Jini rich-text package owns the editor.
