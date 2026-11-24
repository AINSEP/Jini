PARTIAL b01c8dd050 84e394489: ~45 lane files left (STAYS-HOST pending prerequisites or STOPPED with recommendation, listed below); all 10 Codex FIX items and coordinator decisions 1-7 applied

# w5-admin — admin feature + admin shell leftovers (wave 5)

Unattended Opus coordinator run, 2026-11-24 05:50–08:20 UTC. All builder work was done by `model: sonnet` high-effort subagents (≤4 at a time; one brief overshoot to 5 was stopped before it edited anything). No Opus subagents (no security-seam work arose). Programmer persona read first: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) — confirmed; its rules (object args, test-first + named mutation, why-comments move with code, no metric gaming) were put into the shared builder brief.

## Branches and setup
- **Jini** `codex/w5-admin-jini` = `origin/codex/w4-admin-feat-jini` + merge `origin/codex/w4-admin-shell-jini` (`bc3acc30`; `packages/admin/package.json` union-merged).
- **Tovu** `codex/w5-admin-tovu` = `origin/codex/w4-admin-feat-tovu` + merge `origin/codex/w4-admin-shell-tovu` (`eafc04dd5`; `development/why-comments-debt.json` union-merged).
- Setup: Node 22.23.5, pnpm 10.33.2. Jini `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build` 0/0 (0 `error TS`); Tovu `npm ci --ignore-scripts` (root, admin, desktop) 0; `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` 0 (per `combine-13-tovu.md` Setup); contracts tsc + sdk build 0.
- One Jini lockfile change: `pnpm install --no-frozen-lockfile` once for the new `@jini-ai/cms` react surface devDependencies (in `ee6ba90a`).
- No force-push, no `--no-verify`, hooksPath untouched, no RemoteTrigger, no codebase-memory tools, no tags/publish; `main`/`integ/*`/`plan/*`/`release/*`/other `codex/*` only fetched.

## FIX items applied (Codex rv1123q admin-feat, rv1123r admin-shell)
| # | Item | Result |
|---|---|---|
| q1 | plugins-api.types duplicates Core `AdminPluginDto` | DONE: client returns `AdminPluginDto` (legacy `conflicts` tolerance at the client boundary, test-first); plugin-file envelope/limits in Core `cms-plugins`; trash DTOs → new Core `contracts/site/cms-trash` consumed by Jini cms routes + Tovu website trash routes + admin; admin `screens/trash` deleted (no shell); README stale ref fixed. Jini `532838b5`, Tovu `5241befd5` |
| q2 | SiteKeyTab clipboard/timer | DONE: required `clipboard` + `scheduler` ports, bound in Tovu; 1500 ms reset + denied path tested (mutations 1500→1499, drop reset). Jini `532838b5` |
| q3 | use-export-password (DISAGREE) | MOVED → `@jini-ai/admin/sites/transfer/use-export-password.hooks` (clipboard, error formatter, labels injected; permission stays host). Jini `6eb7ec36`, Tovu `e8e3ba70f` |
| q4 | space-hold-rules (DISAGREE) | SPLIT → `@jini-ai/chat/react/features/voice-input/space-hold-rules` (required `holdKey`); key + duration stay host (`space-hold-config.ts`). Jini `bfc7c2f5`, Tovu `1eaaa039d` |
| q5 | voice-input-port mirrors desktop types (DISAGREE) | Neutral contract → `@jini-ai/core/contracts/speech-transcription`, used by desktop-host, Tovu admin and desktop preload; `window.tovuVoice` lookup stays host. Jini `049e08b1` |
| r6 | admin-shell hooks import `useFetchQuery`/`useInvalidate`/`useCachedLoader` | DONE: REQUIRED fields. Jini `5429b115` |
| r7 | DockSettingsMenu non-jini classes | DONE: `jini-row-menu-*` + scoped host CSS + DOM assertions |
| r8 | `live-tiptap-editor` positional | DONE: `isLiveEditor({ editor }, _optional = {})`; mutation (drop schema check) failed 2 Tovu tests |
| r9 | Tovu supplies r6 hooks | DONE (adapters + `MediaPickerDialog`). Tovu `c09e274df` |
| r10 | dev-proxy-upstream-close (DISAGREE) + forwarding exports | SPLIT → `@jini-ai/devops/local-dev/dev-proxy-upstream` (structural ports; Vite registration, refusal header, restart copy stay host); forwarding exports removed from `chat-attachment-liveness`, `assistant-chats`, `retry-unreachable`. Jini `d01b28c3`, Tovu `cb6af51f6` `59dcbca95` |

## Coordinator decisions 1–7
1. **K4 type owners** — `security-api.types`, `source-control-api.types` → `@jini-ai/admin` security / source-control modules (client-only; server does not share them); `deployment-api.types` split (product literal `tovu-peer` destination type stays host); `access-token-rows` moved with injected labels; `integrations-api.types` split: server-shared webhook types → new Core `contracts/site/cms-integrations` (website now imports them), external-MCP shapes → Core `cms-external-mcp`, agent-plugin list row → admin `agent-plugins/models`. Request-injected clients `createSecurityApi`/`createSourceControlApi`/`createDeploymentApi`/`createIntegrationsApi` with Tovu `*-host-ports.ts` bindings.
2. **Domain-react placement** — remote image import → new `@jini-ai/cms/react/media` browser surface (kit, hook, error formatter, header tip and media port injected; no ui/ui-kit runtime dep, guard L5/SI clean); members: Jini `user-management/react/members` already owned the screen, so the Tovu wrapper was deleted and `panels.tsx` renders the Jini `Members` with host props; media provider catalog adapter → `@jini-ai/integrations` (not `ui`: ui must evaluate without the integrations peer, pinned by `missing-peer.test.ts`). No domain dep added to `@jini-ai/admin`.
3. **i18n dictionary factory** — all 9 dictionaries (settings-capabilities, providers, integrations, comments, menus, taxonomy, collections, security, plugins) → `create<X>Dictionary({ commonDictionary, productName?, referenceProductName? }, _optional = {})` in Jini + `core/bind-dictionary-names`; product names are `{productName}` placeholders; host binds once in `lib/i18n-common.ts`. Every dictionary split into <500-line locale-data files (decision 13); merged dictionaries proven byte-identical by JSON dump `cmp`.
4. **Object args** — `useSecurityPermissions({ port, permission, useFetchQuery })`, `useChatDisplayPreferences({ port, namespace, defaults, … })`, `useAssistantChats({ port, client, lastConversation })`, `useThemePages({ port, noThemeId, … })`, `isLiveEditor({ editor })`, trash rules `translate`, … (test-first, named mutations).
5. **File-tree dedupe** — `PackageFilesModal` uses Jini `useAgentPluginFileTree` (now takes the host locale); Tovu `use-package-file-tree.hooks.ts` + `package-file-tree.ts` deleted (uncovered cases ported to Jini first: +13 Jini tests; locale test written first, failed, then passed).
6. **IntegrationsRedirect** — moved to `@jini-ai/admin/screens/integrations/IntegrationsRedirect` with a REQUIRED hook prop; render sites in `panels.tsx` (5), `App.tsx`, `AdminUi.tsx` pass the host hook; `panels-render` assertions updated.
7. **check:hooks** — Jini checker accepts hooks received as REQUIRED props/params (`32243fd5`; 4 new checker tests, mutation named); the 8 false-positive debt rows were removed (debt 8 → 0). Still flags imported custom hooks.

Coordinator review fixes applied on builder output: guard N1/N2 product refs in a moved file (`external-mcp-tool-picker-rules.ts`); a defaulted Jini hook prop in cms `RemoteImageImport` made REQUIRED; `useThemePages` and `useSecurityPermissions` no longer import kit-facade query hooks (REQUIRED fields instead, rv1123r fix-6 pattern); a leftover forwarding `export type { TranscriptionPort }` in Tovu desktop removed; Core webhook contract kept the server's `version` field (optional, server always sends it).

## Files (lane: 87 admin-feat SKIPPED + 14 admin-shell STOPPED, plus the Codex DISAGREE files)
Paths are under Tovu `apps/admin/src/`; Jini destinations under `packages/admin/src/` unless another package is named.

| file | decision |
|---|---|
| `features/sites/hooks/use-export-password.hooks.ts` | MOVED `sites/transfer/use-export-password.hooks.ts` (q3) |
| `features/voice-input/hooks/space-hold-rules.ts` | SPLIT `@jini-ai/chat` `react/features/voice-input/space-hold-rules.ts`; key/duration stay host (q4) |
| `features/voice-input/voice-input-port.ts` | SPLIT contract → `@jini-ai/core/contracts/speech-transcription`; STAYS-HOST remainder (binds `window.tovuVoice`) (q5) |
| `apps/admin/dev-proxy-upstream-close.ts` | SPLIT `@jini-ai/devops/local-dev/dev-proxy-upstream`; host keeps Vite registration + refusal copy (r10) |
| `features/integrations/api/integrations-api.types.ts` | SPLIT → Core `cms-integrations` + `cms-external-mcp`, admin `agent-plugins/models`; deleted |
| `features/integrations/api/integrations-api.ts` | MOVED `screens/integrations/api/integrations-api.ts` (`createIntegrationsApi`; host binding `integrations-host-ports.ts`) |
| `features/integrations/hooks/integrations-port.hooks.ts`, `integration-deliveries-port.hooks.ts` | MOVED `screens/integrations/integrations-ports.ts` |
| `features/plugins/hooks/agent-plugin-install-port.hooks.ts`, `agent-plugins-port.hooks.ts` | MOVED `screens/integrations/agent-plugin-ports.ts` |
| `features/providers/always-allow-rules.ts` | MOVED `screens/providers/always-allow-rules.ts` |
| `features/providers/hooks/always-allow-port.hooks.ts` | MOVED `screens/providers/always-allow-ports.ts` |
| `features/integrations/IntegrationsRedirect.tsx` | MOVED `screens/integrations/IntegrationsRedirect.tsx` (required hook prop; decision 6) |
| `features/settings/external-mcp-tool-picker-rules.ts` | MOVED `screens/settings/external-mcp-tool-picker-rules.ts` (`isApiError`/`describeApiError` injected) |
| `features/settings/external-mcp-admissions-rules.ts` | SPLIT `screens/settings/external-mcp-{drift-types,tool-drift,connection-drift}.ts`; English drift copy STAYS-HOST (`external-mcp-drift-copy.ts`, product copy) |
| `features/security/api/security-api.types.ts` | MOVED `security/api/security-api.types.ts` |
| `features/source-control/api/source-control-api.types.ts` | MOVED `source-control/api/source-control-api.types.ts` |
| `features/security/access-token-rows.ts` | MOVED `security/access-token-rows.ts` (labels injected) |
| `features/deployment/api/deployment-api.types.ts` | SPLIT `deployment/api/deployment-api.types.ts`; `AdminPublishDestination` STAYS-HOST (product wire literal `tovu-peer`) |
| `features/deployment/api/deployment-api.ts` | MOVED `deployment/api/deployment-api.ts` (`createDeploymentApi`) |
| `features/security/api/security-api.ts` | MOVED `security/api/security-api.ts` |
| `features/source-control/api/source-control-api.ts` | MOVED `source-control/api/source-control-api.ts` |
| `features/deployment/hooks/{deployment-overview,dockerfile-source,publish-credentials}-port.hooks.ts` | MOVED `deployment/host/hooks/` |
| `features/security/hooks/access-tokens-port.hooks.ts` | MOVED `security/host/hooks/` |
| `features/source-control/hooks/source-control-credentials-port.hooks.ts` | MOVED `source-control/host/hooks/` |
| `features/security/hooks/use-security-permissions.hooks.ts` | MOVED `security/host/hooks/use-security-permissions.hooks.ts` (`{ port, permission, useFetchQuery }`; decision 4) |
| `features/security/rules.ts` | SPLIT `security/access-token-categories.ts` (categories injected); permission/resource policy STAYS-HOST |
| `features/security/access-token-providers.ts` | MOVED `security/access-token-providers.ts` (copy injected; copy constant stays host) |
| `features/security/custom-credential-forms.ts` | MOVED `security/custom-credential-forms.ts` |
| `features/{settings/settings-capabilities,providers,integrations,comments,menus,taxonomy,collections,security,plugins}-i18n` (9) | MOVED dictionary factories (`screens/<x>/<x>-i18n.ts` + `i18n/*` data; security under `security/`); host binds in `lib/i18n-common.ts` (decision 3) |
| `features/plugins/hooks/use-package-file-tree.hooks.ts`, `features/plugins/package-file-tree.ts` | DELETED (duplicate of Jini `useAgentPluginFileTree`; decision 5) |
| `features/members/MembersPanel.tsx`, `MembersPanel.hooks.ts` | DELETED (host renders Jini `user-management/react` `Members`; decision 2) |
| `features/media/RemoteImageImport.tsx`, `hooks/use-remote-image-import.hooks.ts` | MOVED `@jini-ai/cms` `react/media/` (decision 2) |
| `features/media/media-provider-catalog.ts` | MOVED `@jini-ai/integrations` `media-providers/configurable-catalog.ts`; pinned ids STAYS-HOST (owner policy) |
| `features/posts/post-editor-route-key.ts` | MOVED `posts/post-editor-route-keys.ts` (instance factory, HW3; decision 13) |
| `features/posts/editor/view-bar/view-tabs.ts` | MOVED `posts/view-tabs.ts` (+ `PostEditorView`) |
| `features/pages/hooks/use-theme-pages.hooks.ts` | SPLIT `pages/hooks/use-theme-pages.hooks.ts`; collision path / publish summary / wired binding STAYS-HOST (host routes + publish state) |
| `features/plugins/hooks/use-plugin-provider-settings.hooks.ts` | SPLIT `screens/plugins/hooks/use-plugin-provider-settings.hooks.ts`; wired binding stays host |
| `features/plugins/AgentPlugins.hooks.ts` | MOVED `screens/plugins/AgentPlugins.hooks.ts` |
| `features/providers/hooks/use-providers.hooks.ts` | MOVED `screens/providers/hooks/use-providers.hooks.ts` (`useExternalMcp` required) |
| `features/trash/rules.ts` | SPLIT `screens/trash/rules.ts`; `describeTrashLoadError` STAYS-HOST (Tovu API product copy) |
| `components/AssistantDock/hooks/use-chat-display-preferences.hooks.ts` (+ generic part of `chat-display-preferences.ts`) | MOVED `shell/components/AssistantDock/hooks/use-chat-display-preferences.hooks.ts`; namespace/defaults stay host |
| `hooks/use-assistant-chats.hooks.ts` | SPLIT `shell/hooks/use-assistant-chats.hooks.ts` (`client` required); client singleton + `useWiredAssistantChats` STAYS-HOST |
| `components/AssistantDock/hooks/assistant-mcp-ui.ts` | SPLIT `shell/.../open-mcp-ui-link.ts` (origin/openWindow injected); sandbox-proxy URL builder stays host (website pin) |
| `components/AssistantDock/DockHeader.tsx` | STAYS-HOST (host composition: host tip, i18n, dock props) |
| `lib/{block-atom-insert,post-title-extension}.ts`, `lib/{media-image-extension,media-embed-extension}.tsx` | STAYS-HOST (tiptap editor stays in host; owner 11-23) |
| `features/posts/PostEditor.hooks.ts`, `editor/bubble-menu/*`, `editor/toolbar/{toolbar-group-props,toolbar-state}.ts`, `hooks/use-post-url-dialog.hooks.ts`, `hooks/post-editor-file-upload.ts` | STAYS-HOST (tiptap; owner 11-23) |
| `features/security/access-token-forms.ts` | STAYS-HOST for now (composes host deployment/source-control rules + `ApiError`); move after those rules |
| `features/settings/hooks/use-admin-appearance-settings.hooks.ts` | STAYS-HOST (21-line composition of three host hooks; moving = wrapper) |
| `features/settings/hooks/use-settings-ui.hooks.ts` | STAYS-HOST (host settings-slice wiring) |
| `features/settings/hooks/use-external-mcp-tool-picker.hooks.ts`, `features/plugins/hooks/use-agent-plugin-update.hooks.ts` | STAYS-HOST (bind host `integrationsApi` / compose host install hook) |
| `features/plugins/hooks/{use-plugin-package-files,use-agent-plugin-details-modal}.hooks.ts`, `features/providers/hooks/use-always-allow.hooks.ts`, `features/integrations/hooks/use-integration-deliveries.hooks.ts`, `features/settings/hooks/use-external-mcp-admissions.hooks.ts` | STOPPED (budget): call `@jini-ai/ui` query hooks + host singletons. Recommendation: same recipe as `useThemePages` — kit query hooks and api client as REQUIRED fields — then move |
| `features/settings/rules.ts`, `features/settings/hooks/use-ai-agent-presentation.hooks.ts` | STOPPED: need `@jini-ai/ui` types (`ExecutionConfig`, `ByokConfig`, `DetectedAgent`, …) and `ACCENT_SWATCH_PRESETS`. Recommendation: move those ui types to Core contracts first |
| `features/pages/hooks/use-theme-canvas-styling.hooks.ts` | STOPPED: needs `CanvasStyling` (ui html-editor), `resolveThemeLayout` (cms value), host error class. Recommendation: `CanvasStyling` → Core, inject the other two, own batch |
| `components/ConfirmActionDialog.tsx` | STOPPED: needs the kit `KitConfirmDialogProps` extension (`dialogRef`, `titleId`, per-action attrs, `extra`) across every kit implementation + ~150 host CSS rules; recommend one owner-reviewed kit batch, then move the 3 callers |
| `components/AssistantDock/DockHeaderTip.tsx` | STOPPED: 8 importers would each pass `useTip` + `bubbleStyle`; recommend exposing `bubbleStyle` on the kit `InfoTipController` so the Jini component needs no props |
| `lib/assistant-daemon-activation.ts` | STOPPED (owner): needs `@jini-ai/admin` in Tovu root devDependencies (manifest + lockfile). Recommendation: approve it, then re-apply the ready move |
| `components/AssistantDock/hooks/byok-runtime.hooks.ts`, `components/WidgetConfigFields/HtmlAttributeRows.tsx`, `components/MediaEditDialog/MediaEditDialog.tsx` | NOT ATTEMPTED (budget): prerequisites unchanged from w4 (K4-seam-20 preset type; kit ghost-icon-button / Dialog slots + visual review) |
| plugins components (`AgentPluginMemoryPanel`, `PluginPackageFilesModal`, `AgentPluginMaturity`, `AgentPluginUpdateControl`, `PluginProviderSettingField.tsx`, `PluginProviderSettingsDialog`, `PluginRemoveConfirmDialog`, `admin-surface-theme`), posts components (`PostCoverImage`, `PostEditorActions`, `PostEditorSlugCollisionWarning`, `ToolbarColorGroup`, `ToolbarTypographyGroup`), `deployment/OverviewTab`, `providers/AlwaysAllowPanel`, security `AccessTokensTab.hooks`, `OtherCredentialsSection.hooks`, `CopyKeysDialog`, `SiteKeyRecoveryCard`, `other-credential-stores`, `integrations/{Integrations,IntegrationDeliveries}.tsx`, settings `ExternalMcpAdmissionsBanner`, `ExternalMcpToolPicker` | NOT ATTEMPTED (budget; mostly non-`jini-` CSS + host components). Their K4/i18n/hook prerequisites are now landed, so a next lane can move them |

## FILES LEFT (`scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, clean worktree per commit; themes = `theme` + `adm-themes` areas)
| | FILES LEFT | excl. themes |
|---|---:|---:|
| before (base `eafc04dd5`) | 2,147 | 2,036 |
| after (`b01c8dd050`) | 2,109 | 1,998 |

That is **−38** in both columns.

## Gates (tip vs base; base measured in clean worktrees at `bc3acc30` / `eafc04dd5`)
**Jini** (tip vs base `bc3acc30`):
| gate | base | tip |
|---|---|---|
| build (core, platform, integrations, chat, devops, desktop-host, cms, user-management, admin) | 0 `error TS` | 0 `error TS` |
| `pnpm typecheck` | — | 0 (0 `error TS`) |
| `pnpm api:check` (after `api:update`) | — | 0 |
| `pnpm guard` | 9 rows in a clean worktree (7 worktree-artifact SI/R13 rows + HW3 `shell-failure-log.ts`) | 1 row: the same pre-existing HW3 `shell-failure-log.ts` |
| `pnpm check:hooks` | ok | ok (hook debt 8 → 0; decision 7) |
| `pnpm check:why-comments` | 10 ids | 10 ids (same set; one new id got a debt row for the generalised checker doc) |
| `pnpm check:size` | red: cms `redirects.ts`, daemon `launch.ts` ×2, stale sidecar rows | identical rows (new >500-line dictionaries were split instead) |
| `pnpm check:complexity` | red: 4 rows (agent-runtime, chat, core, ui) | identical 4 rows |
| vitest core / chat / devops / desktop-host / admin | — | 3028 / 4520 (+1 skip) / 1390 / 832 (+1 skip) / 3963 — all pass |
| vitest integrations | — | 2110/2111 under load; the failing postgres webhook dialect test passes in isolation (14/14) |
| vitest cms | — | 26 failed under load; 18 still fail in an isolated rerun of those 21 files: 9 × 5 s timeouts in pglite/postgres dialect repos, 7 × `RegExp.escape is not a function` (Node 22 here; combine-13 ran Node 24), 1 `universal-entries.boundary` "document-ingress → jsdom unresolved", 1 more. None of these files were edited by this lane (cms diff = plugin routes typing + new `react/media`); base not re-run for cms (budget) → **NOT-CONFIRMED vs base**, reviewer please re-run on Node 24 |

**Tovu** (tip vs base `eafc04dd5`):
| gate | base | tip |
|---|---|---|
| root `tsc -p tsconfig.json` | — | 0 errors (one `version` contract regression found and fixed in `5051e971`/`eec2e059`) |
| admin `tsc` | w4 reports: green | 0 errors |
| desktop `tsc` main / preload / renderer | — | 0 / 0 / 0 |
| `apps/desktop` `npm run gates` | — | typecheck/tree-quiet/js-backslide PASS; tests FAIL = 4 permission tests that fail because this container runs as root (unrelated files); complexity FAIL = 3 renderer files untouched by this lane (pre-existing); coverage FAIL follows tests |
| `check:hooks` | ok | ok |
| `check:why-comments` (vs `origin/refactor/terra`) | 2,224 flagged ids | 80 flagged ids, **0 new vs base** (every comment moved to Jini has a verified debt row) |
| admin vitest (all, `--maxWorkers=2`) | — | 844/852 files, 14,228 passed / 10 failed / 2 skipped. Base-red: `JiniMediaPicker.hooks` (3, known since merge-16), `admin-literal-copy`, `credential-input-autocomplete` (both fail on base too). New-red at measurement: `kit.unit`, `dictionary-lookup-sinks`, `external-mcp-tool-picker-css`, `api-request-shapes` (listPlugins snapshot), `api-workspace-taxonomy-plugins…` (listPlugins `conflicts: []` from fix q1) → all 5 fixed in `b01c8dd050` (test-side repoints to the `jini-` selector lists and the bound dictionary factories; `conflicts: []` expectation from fix q1). **Flag for review:** the `listPlugins` characterization snapshot changed from `resolved` to `rejected: TypeError` for a `{}` body (the harness answers every call with `{}`); the Jini client now maps `plugins` and throws when the envelope is missing. Real servers always send `{ plugins }`; if the old tolerance is wanted, add `plugins ?? []` in Jini test-first. After the fix: 0 new-red files vs base in the admin suite |

## Self-check (Codex failure list)
- No re-export/forwarding files added; three pre-existing forwarding exports removed (r10) plus the desktop `TranscriptionPort` one.
- Custom hooks reach Jini only as REQUIRED props/fields (diff grep for defaulted `useX = useY` in Jini: 0; kit-facade hook imports removed from moved hooks; `check:hooks` green).
- No server-framework types or host log formatters in Jini (dev-proxy port is structural; refusal copy injected).
- `jini-*` classes for moved rendering (dock menu, cms import dialog) with host CSS aliases.
- No new size/complexity exception or debt rows (Jini size/complexity output identical to base; oversized dictionaries split instead).
- Shared wire types in Core (`cms-trash`, `cms-integrations`, `cms-plugins`, `cms-external-mcp`, `speech-transcription`).
- Object args with `_optional = {}` on new/changed exported functions and hooks.
- Behaviour changes test-first with named mutations (SiteKey reset, plugins legacy conflicts, hook checker, dev-proxy writableEnded, display prefs, assistant chats resume, MCP-UI link origin, theme pages noThemeId, route-keys isolation, security permission, access-token sort/copy, file-tree locale).
- Why-comments moved with the code; debt rows only where the comment was found at the destination or deleted with its code (see Gates).
- api baselines regenerated (`d066e46c`), changeset `.changeset/p9-w5-admin.md` (admin/desktop-host/cms minor = breaking for direct callers, others patch).

## Commits (all pushed)

Jini `codex/w5-admin-jini` (`bc3acc30..84e394489`):
```
84e394489 w5-admin: why-comment row for the generalised hook-checker doc
eec2e0591 w5-admin: webhook subscription version is optional on the shared contract (server sends it; client placeholder
5051e9718 w5-admin: core webhook subscription contract keeps the server's version field
d066e46c4 w5-admin: regenerate api baselines; changeset for the w5-admin surface
e813c2631 w5-admin: useSecurityPermissions takes the host useFetchQuery as a REQUIRED field
edbe581c8 w5-admin: useThemePages takes the host query hooks as REQUIRED fields (no kit-facade hook import)
9c0384cb0 w5-admin: guard-conformant import in view-tabs test; reword host path in theme pages doc
423d02f0c w5-admin: cms import dialog takes its hook as a REQUIRED prop (no Jini default)
4196de451 w5-admin: tool-picker rules comments name the host generically (guard N1/N2)
c30de7f46 w5-admin: cms import dialog takes its hook as a defaulted prop (check:hooks)
d33b6715d w5-admin: useThemePages and its fake port move to admin pages/hooks (noThemeId injected)
fb636aa69 w5-admin: .js import suffix in moved-hook tests (guard R11)
10def5b56 w5-admin: post editor view tabs and PostEditorView type move to admin posts
076233fbc w5-admin: post editor route keys become an instance factory in admin posts (isolation test; no module state)
ee6ba90a0 w5-admin: remote image import dialog moves to cms react/media (kit, error formatter, tip and media port inject
dded507b5 w5-admin: external-MCP admission drift and tool-picker rules move to admin screens/settings (copy and error vo
63f2cd956 w5-admin: Trash rules move to admin screens/trash (translator injected)
3a9a8fa5f w5-admin: carry sort-test why-comments into the admin categories test
f4c608328 w5-admin: plugins dictionary factory moves to admin screens/plugins (split into locale data files)
5b6c75768 w5-admin: plugin provider-settings, agent-plugin confirmation and providers hooks move to admin screens (host 
8b5a71094 w5-admin: guard-clean test import; keep the ToolCallDisplay mirror note
f949b746d w5-admin: security dictionary factory moves to admin security (split into locale data files)
821a20ea2 w5-admin: access-token categories, provider info and custom-credential forms move to admin security (copy/cate
4958c4e94 w5-admin: media provider configurable catalog moves into @jini-ai/integrations media-providers/catalog
0fde235f8 w5-admin: collections dictionary factory moves to admin screens/collections (split into locale data files)
39639f1df w5-admin: openMcpUiLink moves to admin shell with injected origin and openWindow
084a02767 w5-admin: split comments/integrations/menus i18n dictionaries by locale group
f1ae8b290 w5-admin: useAssistantChats takes the chat client as a required field
20fda47a3 w5-admin: dedupe admin package.json deployment host-hook rows
a4f101c12 w5-admin: taxonomy dictionary factory moves to admin screens/taxonomy (split into locale data files)
331ae7a59 w5-admin: dedupe admin package.json port-hook export rows
33912ae3f w5-admin: move deployment/security/source-control port interfaces into @jini-ai/admin host/hooks
636e8b973 w5-admin: useChatDisplayPreferences moves to admin shell hooks with object args
d10559712 w5-admin: split createIntegrationsApi into webhook/external-mcp/agent-plugin builders (size gate)
bf249d6ce w5-admin: keep port docs verbatim in admin ports
fc38d5103 w5-admin: export admin comments dictionary factory subpath
f2f7e2acc w5-admin: menus dictionary factory moves to admin screens/menus
0bb4062fc w5-admin: always-allow rules/ports and IntegrationsRedirect (required host hook) to admin, integrations api re
7ad83f34f w5-admin: comments dictionary factory moves to admin screens/comments
8c8b9f24c w5-admin: integrations dictionary factory moves to admin screens/integrations
2a05512a5 w5-admin: jsdom env for useSecurityPermissions test
e4c61de30 w5-admin: useSecurityPermissions takes object args with the host's permission and moves to admin security host
b7654c27d w5-admin: useAgentPluginFileTree takes host locale, export from agent-plugins/react, port file-tree tests
633644f13 w5-admin: providers dictionary factory moves to admin screens/providers
624adccae w5-admin: settings-capabilities dictionary factory + bindDictionaryNames
1538310bb w5-admin: integrations wire DTOs to core contracts, agent-plugin list row to admin models, createIntegrationsA
cc5392dc9 w5-admin: credential wire types, request-injected API clients and access-token rows move to admin security/sou
d01b28c30 w5-admin: devops local-dev dev-proxy-upstream (dropped-upstream lifecycle over structural ports)
049e08b1a w5-admin: share the neutral speech transcription contract through core
532838b5c w5-admin: plugin/trash wire DTOs to Core contracts; SiteKeyTab copy takes clipboard+scheduler ports
bfc7c2f5d w5-admin: add chat/react voice-input space-hold-rules with host-supplied hold key
5429b1152 w5-admin: required host query hooks, jini-row-menu dock classes, object-arg isLiveEditor
6eb7ec368 w5-admin: move useExportPassword to @jini-ai/admin sites/transfer with injected clipboard, error formatter and
32243fd5c w5-admin: check:hooks accepts hooks received as required props
```

Tovu `codex/w5-admin-tovu` (`eafc04dd5..b01c8dd050`, report commit follows):
```
b01c8dd050 w5-admin: repoint 5 admin tests to moved/renamed code
733e18f989 w5-admin: why-comment debt rows for comments moved to Jini in wave 5
1d13e97409 w5-admin: security permissions binding supplies useFetchQuery
5029e64f0d w5-admin: theme pages binding supplies the query hooks
ee08185f33 w5-admin: Media passes the cms import hook as a required prop
2dcc4e63ea w5-admin: why-comment debt rows for theme pages hook and PostEditorView moves
4dca07d5b9 w5-admin: Media test follows the jini- dialog class
e63a087e15 w5-admin: theme pages hook consumes admin useThemePages (Tovu keeps collision path, publish summary, wired bi
98a784ab4e w5-admin: other credential stores read the row category type from @jini-ai/admin
819b54c423 w5-admin: media URL import dialog consumed from cms react/media; post editor route keys injected as one host 
dba82a11af w5-admin: why-comments debt rows for moved external-MCP rules comments
9b89bb0434 w5-admin: external-MCP drift and tool-picker rules bind from @jini-ai/admin (drift copy and probe errors host
53a5f389cc w5-admin: post editor view tabs consume admin posts/view-tabs
f51e699278 w5-admin: why-comment debt rows for plugin/providers/trash hook moves
442a92dab4 w5-admin: trash dictionary coverage test also scans the Jini Trash rules
2da0fea429 w5-admin: Trash binds Jini rules with the Trash dictionary translator
a05fa7c2d1 w5-admin: why-comments debt rows for moved security category/forms comments
68bc95895c w5-admin: plugins dictionary binds from Jini admin
80991d3369 w5-admin: bind Jini provider-settings, agent-plugin confirmation and providers hooks; drop moved Tovu files
17174dbbd4 w5-admin: security rules split, access-token providers and custom-credential forms bind from @jini-ai/admin
e30aea5c1c w5-admin: why-comment debt rows for dock hooks moved to Jini admin
80025a09a4 w5-admin: security test aliases read the bound translator
cc89d009e7 w5-admin: security dictionary binds from Jini admin
40206d39d2 w5-admin: consume configurable media catalog from @jini-ai/integrations, keep pinned ids in host
a81cefb872 w5-admin: collections dictionary binds from Jini admin
5e844d6fcd w5-admin: why-comments debt rows for moved/deleted plugin file-tree, plugin/trash types, abort classifier
da335a9035 w5-admin: dock binds openMcpUiLink from @jini-ai/admin with window.open injected
5832bf0138 w5-admin: repoint deployment/security/source-control port importers to @jini-ai/admin host hooks
4b3c76a55b w5-admin: host keeps the chat client singleton; useAssistantChats comes from @jini-ai/admin
9a07db9ca1 w5-admin: taxonomy dictionary binds from Jini admin
7d1f0586a0 w5-admin: render Jini Members directly, delete MembersPanel wrapper
6155f0264e w5-admin: dock display preferences hook comes from @jini-ai/admin
529cc4dbc3 w5-admin: comments test aliases the bound translator
ac97306f3c w5-admin: menus test and comments ports read the bound translators
a0ee9b6287 w5-admin: why-comment debt row for file-tree focus comment
cc96bf50bc w5-admin: wired permissions test mounts the admin kit
4f608f106f w5-admin: menus dictionary binds from Jini admin
964e2c23eb w5-admin: PackageFilesModal uses Jini useAgentPluginFileTree; drop duplicate file-tree hook/helpers
bc7f9287ae w5-admin: useSecurityPermissions comes from @jini-ai/admin; host wires its site-key permission
b57324342d w5-admin: comments dictionary test reads the bound translator
613edf257a w5-admin: integrations api bound via createIntegrationsApi; ports and always-allow rules from admin; Integrat
a5ff38b1d9 w5-admin: comments dictionary binds from Jini admin
ea6bee6216 w5-admin: integrations dictionary binds from Jini admin
2c8f63c721 w5-admin: providers dictionary binds from Jini admin
5b72684f20 w5-admin: security/source-control/deployment wire types, API clients and token rows come from @jini-ai/admin;
2cf8030bfc w5-admin: split integrations-api.types to core contracts + admin models; repoint importers
fe7aeb2b67 w5-admin: settings-capabilities dictionary binds from Jini admin
be1a6791d9 w5-admin: drop the TranscriptionPort forwarding export (importers use @jini-ai/desktop-host/speech)
5241befd53 w5-admin: consume Core plugin/trash DTOs; bind clipboard+scheduler ports for site-key copy
4943a2b78e w5-admin: why-comments debt rows for useExportPassword and space-hold-rules moved to Jini
7c2781bad3 w5-admin: why-comments rows for comments moved to Jini dev-proxy-upstream
59dcbca95a w5-admin: dev proxy uses Jini dropped-upstream lifecycle; host keeps refusal copy
1eaaa039d6 w5-admin: voice input uses Jini space-hold-rules and the shared speech contract
c09e274df2 w5-admin: supply required query hooks, jini-row-menu dock classes, object-arg isLiveEditor
cb6af51f6b w5-admin: drop forwarding exports; point users at Jini owners
e8e3ba70fc w5-admin: repoint useExportPassword at Jini and inject clipboard/error formatter/labels
```
