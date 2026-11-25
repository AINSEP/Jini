PARTIAL e801d9286 b0c486e04: 240 lane files left by the planner (adm-other 147, adm-shell-components 45, adm-shell-lib 35, adm-shell-hooks 13), of which ~70 are now host bindings. Not moved: Media.tsx + 2 big media hooks, settings tabs/SettingsUi/AdminAppearance (settings-tabs seam), plugins Details/ProviderSettings dialogs, 3 dock hooks + AssistantDock composition, most security screens, adm-themes

# x8-admin: chat kit names, plugins, settings, media, dock, trash/library/database, security leaves

- **Branches:** Tovu `codex/x8-admin-tovu`, Jini `codex/x8-admin-jini`. Both branch from `origin/codex/x7-admin-*` and were pushed after every merged batch (14 pushes per repo). No force-push, no `--no-verify`, `core.hooksPath` untouched, nothing published or tagged, no RemoteTrigger. `apps/desktop` was not touched, so its gates were not needed.
- **Required reading:** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer agent v1.7.5: Base Skills, Conditional Skills, Role "minimum viable change, no behaviour outside scope", Workflow). Its rules went into the shared worker brief: minimum change, no test weakening or coverage gaming, why-comments and inline docs, fresh evidence before completion claims.
- **Inputs:** `x7-admin.md` and `x6-admin.md`; P9K §2 recipes; `coordinator-decisions-wave5.md`. Coordinator decisions 1-3 (factory bindings, `productName` seam, domain destinations) were applied unchanged.
- **Setup:**
  - Jini: `pnpm install --frozen-lockfile && pnpm -r build`.
  - Tovu: `npm ci --ignore-scripts` in the root and `apps/admin`, with the contracts `prepare` hook neutralised for the install and then restored. Then `link:jini`, and `contracts` and `sdk` built.
  - Baseline on the untouched x7 heads: root `tsc` 0 errors, admin `tsc` 0, Jini typecheck/api/hooks 0. Jini guard had the 1 known base HW3 violation. why-comments was ok on both.
- **Execution:**
  - 14 Sonnet worker dispatches, plus 1 Opus dispatch for security. At most 4 ran at a time, each in its own worktree pair `/home/user/wt/wN/{Jini,Tovu}`.
  - Every worker followed one shared brief: the iron rules, a 50-call cap, and the report format.
  - The coordinator merged each batch into the x8 branches, resolved the `package.json` and kit conflicts as unions, re-ran the gates, then pushed.

## Per-file table (Tovu `apps/admin/src/`)
### Kit (prerequisite)
| item | outcome |
|---|---|
| AdminKit chat names `ChatPane`, `ChatSettingsDialog`, `JiniChatProvider`, `ConversationList`, `ChatSettingsSegmented`, `McpUiSurfaceCard`, `A2uiSurfaceCard`, `createDaemonAttachmentUploader`, `FrontendSessionBridge` type, `useAdminKitChatRunValues` | ADDED (kit.tsx + `kit-chat-component-types.ts` + testing kit + kit unit tests; Tovu wiring in `integrations/jini-kits.ts`) |
| `SeeMore`, `SearchableModelSelect`, `FileDropzone`, `useAgentPluginFileTree` | ADDED (same pattern) |
| `followDurableRun` | NOT ADDED. `@jini-ai/chat` exports it from no public subpath, and no admin call site uses it. Owner decision needed. |
| `createMidRunMessagePoster` | already present (x7) |

### features/plugins (39 files)
| file | outcome |
|---|---|
| `PluginProviderSettingField`, `PluginRemoveConfirmDialog`, `AgentPluginDisableConfirmDialog`, `AgentPluginManageButton`, `PluginRow`, `AgentPluginRow`, `PackageFilesModal`, `PluginPackageFilesModal`, `AddPluginPanel`, `AddAgentPluginPanel`, `AgentPluginUpdateControl` | MOVED -> `@jini-ai/admin/screens/plugins/*`. UI comes via the kit; classes are `jini-*`. Rules arrive through the new `rules-context.tsx` (`PluginRulesProvider`) or a required `rules` prop. |
| `hooks/use-plugin-remove-confirm`, `use-agent-plugin-disable-confirm`, `use-plugin-install`, `use-agent-plugin-install`, `use-agent-plugin-update` | MOVED -> `screens/plugins/hooks/*` (Tovu file deleted) |
| `hooks/use-plugins`, `use-plugin-package-files`, `use-agent-plugin-details-modal` | MOVED (pure hook). Tovu file = `useWired*` = STAYS-HOST (binding) |
| `rules.ts`, `plugins-host-ports.ts`, `hooks/use-host-admin-surface-frame`, `hooks/use-plugin-provider-settings`, `hooks/use-agent-plugin-memory` | STAYS-HOST (binding) |
| `hooks/{agent-plugin-surfaces,agent-plugin-install,agent-plugin-memory,plugin-install,agent-plugins,plugins}-dependencies.hooks.ts` | STAYS-HOST (host `request` / port wiring) |
| `Plugins.tsx`, `AgentPlugins.tsx` | STAYS-HOST (screen wiring: mounts the rules provider, passes hook props, imports host css) |
| `index.ts`, `admin-token-sources.ts`, `composer-capabilities.ts`, `installed-skills-composer-source.ts`, `README.md` | STAYS-HOST (barrel / host design tokens / host catalog / docs) |
| `PluginProviderSettingsDialog.tsx` | STOPPED. Product-named dictionary key, host `native-domain-dialogs.css`, needs a `productName` seam. |
| `AgentPluginDetailsModal.tsx` | STOPPED. Needs 4-5 host-bound hooks as props (memory, details, surface frame, port). |
| `hooks/use-agent-plugins.hooks.ts` | STOPPED. Host `request` + integrations ports. |

### features/settings (18 files)
| file | outcome |
|---|---|
| `ExternalMcpToolsModal.tsx`, `ExternalMcpToolPicker.tsx`, `ExternalMcpToolPicker.hooks.tsx` | MOVED -> `screens/settings/*`. Hooks are required props; product vars are a required prop; classes are `jini-external-mcp-*`. |
| `hooks/use-external-mcp-tool-picker.hooks.ts` | MOVED (pure hook + its tests to Jini, 16 tests). Tovu file = STAYS-HOST (binding: port, `ApiError` vocabulary, collaborators). |
| `ExternalMcpSettingsPanel.tsx` | STAYS-HOST (repointed; passes the hooks) |
| `ExternalMcpSettingsPanel.hooks.tsx` | STAYS-HOST (no kit slot for the source-config form hook) |
| `ai-agent-presentation.ts` + `hooks/use-ai-agent-presentation.hooks.ts` | STAYS-HOST (host voice port, product bridge key) |
| `index.ts`, `README.md` | STAYS-HOST |
| `ExternalMcpAdmissionsBanner.tsx`, `hooks/use-external-mcp-admissions.hooks.ts`, `hooks/use-external-mcp.hooks.ts` | STOPPED. Host ai-assistant/auth/integrations ports, `credential-copy`; needs a port/factory split. |
| `SettingsUi.tsx`, `AdminAppearance.tsx`, `hooks/use-settings-ui`, `hooks/use-admin-appearance-settings`, `hooks/use-user-interface-tab` | STOPPED. Blocked on `lib/settings-tabs.ts` (`ADMIN_LOCALES` home + ledger-slice port) and on 6 huge settings-tab kit slots. |

### features/media (12 files)
| file | outcome |
|---|---|
| `api/media-api.ts` | MOVED -> `screens/media/api/media-api` (`createMediaApi`). Tovu file = STAYS-HOST (binding) |
| `media-providers-port.ts` | MOVED -> `screens/media/media-providers-port` (`createMediaProvidersPort`). Tovu = STAYS-HOST (binding) |
| `Media.hooks.tsx` | MOVED -> `screens/media/media-tabs.hooks.tsx` (`Icon` injected) |
| `hooks/use-media-preview.hooks.ts` | MOVED (pure). Tovu `useWiredMediaPreview` = STAYS-HOST (binding); new binding test spies `mediaApi.mediaOriginalUrl` |
| `hooks/media-dependencies.hooks.ts` | SPLIT: `createFakeMediaPort` MOVED -> `hooks/fake-media-port`; `defaultMediaPort` STAYS-HOST (binding) |
| `hooks/media-import-dependencies.hooks.ts`, `media-i18n.ts`, `index.ts`, `README.md` | STAYS-HOST |
| `hooks/use-media.hooks.ts` (156-line fn), `hooks/use-edit-media-panel.hooks.ts` (130-line fn) | STOPPED. Moving them would need new size/error-gate debt rows in Jini; they need decomposition first. |
| `Media.tsx` (1596 lines) | STOPPED. admin-themes, `ServerLabel`, `PublishSectionButton`, cms `RemoteImageImport`, host css. |

### components/AssistantDock (27 files)
| file | outcome |
|---|---|
| `OverflowAwareMcpUiSurfaceCard.tsx` | MOVED -> `shell/components/AssistantDock/` (kit `McpUiSurfaceCard`; `useTHook` required; class `jini-mcpui-surface-overflow-*`) |
| `DockHeader.tsx` | MOVED (kit `ConversationList`/`ChatSettingsSegmented`; `translateAiAssistant`, `useSubagentsSettingsHook`, `ConversationTitle`, option lists required) |
| `hooks/run-context.hooks.ts`, `hooks/assistant-transport.hooks.ts` | MOVED. New Tovu `hooks/assistant-transport.binding.ts` = STAYS-HOST (binding) |
| `hooks/composer-files.hooks.ts` | MOVED (generic uploader/validator/working-dir/folder-drop hooks). Tovu file = STAYS-HOST (binding: caps, legacy manifest names, storage key) |
| `AssistantDock.tsx`, `DockChatPane.tsx`, `AssistantDock.state.hooks.ts`, `RoutedA2uiSurfaceCard.tsx`, `assistant-dock-props.tsx` | STAYS-HOST (product composition / Tovu collaborators / chart registry) |
| `chat-agent-plugin-preferences.adapter.ts`, `assistant-runtime-preferences.adapter.ts`, `chat-display-preferences.adapter.ts` | STAYS-HOST (binding) |
| `hooks/agents-inventory.hooks.ts` | STAYS-HOST (module state read by the transport binding) |
| `hooks/use-dock-renderer-registry.hooks.ts`, `byok-runtime`, `composer-discovery`, `execution-config`, `execution-config-ledger` | STAYS-HOST (host execution-settings seams; registry test base-red) |
| `execution-config-write.ts`, `hooks/messages-change.hooks.ts` | STOPPED. Positional signatures with several callers; owner call needed. |
| `hooks/dock-chrome.hooks.ts`, `hooks/local-cli-selection.hooks.ts`, `hooks/runtime-access.hooks.ts` | STOPPED. They depend on unmoved host modules (`execution-config-write`, `shell-collaborators`, `agents-inventory`, wired chats). |
| ~15 `useAssistantTransport` cases in `components/__tests__/AssistantDock.hooks.unit.test.tsx` | NOT MOVED (they run against the Tovu binding; gap against "tests move with the code") |

### trash / library / database / collections / menus / taxonomy / members
| file | outcome |
|---|---|
| `features/trash/Trash.tsx` screen + `hooks/use-trash.hooks.ts` controller | MOVED -> `screens/trash/*` (UI via kit facades). Tovu files = STAYS-HOST (binding) |
| `features/library/Library.tsx` screen + API port | MOVED -> `screens/library/Library`, `hooks/library-api-port.hooks`. Tovu = STAYS-HOST (binding) |
| `features/database/Database.tsx` | MOVED -> `screens/database/Database` (+47 tests). Tovu = STAYS-HOST (binding; new 2-test binding test) |
| `trash/{api,rules,trash-i18n,trash-dependencies,index}`, `library/{library-dependencies,use-wired-library,library-i18n,index}`, `database/{api,*-section-dependencies.hooks,index,README}` | STAYS-HOST (bindings / host copy / host ports) |
| `collections/*` (screens, host ports, i18n, 6 `use-*` hooks, index) | STAYS-HOST (already bindings over Jini screens) |
| `collections/CollectionEntryEditor.tsx` | STOPPED. `SuggestInput`, host taxonomy hook, Tiptap widget-embed extension. |
| `menus/*` (7), `taxonomy/*` (5) | STAYS-HOST (bindings over Jini `screens/menus`, `screens/taxonomy`) |
| `members/*` (6) | STAYS-HOST. Screen, port and rules already live in `@jini-ai/user-management`; the rest is host wiring. Rules-test split left for later. |

### features/security (adm-security, Opus worker)
| file | outcome |
|---|---|
| `Security.hooks.ts` | MOVED -> `@jini-ai/admin/security/host/Security.hooks` (test written first; kills dropping `replace:true` / `?tab=`) |
| `hooks/other-credentials-port.hooks.ts`, `hooks/site-key-port.hooks.ts`, `copy-keys-dialog.css` | MOVED -> `security/host/*` (classes `jini-copy-keys-*`) |
| `rules.ts` | STAYS-HOST (`SITE_KEY_MANAGE_PERMISSION`: an auth-policy constant; splitting it is an owner/security call) |
| `access-token-copy.ts`, `hooks/site-key-status.rules.ts` | STAYS-HOST (product copy, `TOVU_SITE_KEY`) |
| `security-host-ports.ts`, `hooks/{security-permissions,access-tokens,other-credentials,site-key}-dependencies.hooks.ts`, `index.ts`, `INFO.md` | STAYS-HOST (binding / barrel / docs) |
| `Security.tsx`, `AccessTokensTab.tsx`(+hooks), `CopyKeysDialog.tsx`, `OtherCredentialsSection`(+hooks), `RecoveryCodesCard`(+hooks), `SiteKeyRecoveryCard`, `SiteKeyTab`, `access-token-forms.ts`, `other-credential-stores.ts`, `hooks/use-{access-tokens,other-credentials,site-key,site-key-recovery,copy-keys}.hooks.ts` | STOPPED. Host i18n-common, direct `@jini-ai/ui`/`ui-kit` imports to convert to the kit, `@tovu/contracts/credential-copy`, and `@jini-ai/user-management`/`integrations` implementations that need injecting. |

### Not reached (budget)
`adm-themes` admin screens (32), `adm-shell-lib` (35), `adm-shell-hooks` (13, all bindings per x7), the rest of `components/` (WidgetConfigFields, MediaPickerDialog, MediaEditDialog, WidgetPickerDialog, EmbedInsertControl, TemplateSource, Select), and `features/{integrations,email,skills,voice-input,providers,import-export,observability,auth}` (x7 classified most of these as bindings).

## Tovu binding files to add to the planner `KEEP_RULES` (each only calls a Jini factory/hook with host ports)
`features/media/api/media-api.ts`, `features/media/media-providers-port.ts`, `features/media/hooks/use-media-preview.hooks.ts`, `features/media/hooks/media-dependencies.hooks.ts`, `features/plugins/rules.ts`, `features/plugins/plugins-host-ports.ts`, `features/plugins/hooks/use-plugins.hooks.ts`, `features/plugins/hooks/use-plugin-package-files.hooks.ts`, `features/plugins/hooks/use-agent-plugin-details-modal.hooks.ts`, `features/plugins/hooks/use-host-admin-surface-frame.hooks.ts`, `features/plugins/hooks/use-plugin-provider-settings.hooks.ts`, `features/plugins/hooks/use-agent-plugin-memory.hooks.ts`, `features/plugins/hooks/*-dependencies.hooks.ts` (6), `features/settings/hooks/use-external-mcp-tool-picker.hooks.ts`, `features/trash/Trash.tsx`, `features/trash/hooks/use-trash.hooks.ts`, `features/trash/api/trash-api.ts`, `features/library/Library.tsx`, `features/library/hooks/use-wired-library.hooks.ts`, `features/database/Database.tsx`, `features/database/api/database-api.ts`, `features/database/hooks/*-section-dependencies.hooks.ts` (3), `features/collections/{collections-host-ports,collections-i18n}.ts` + `hooks/use-*.hooks.ts` (6), `features/menus/*` (7), `features/taxonomy/*` (5), `features/members/{members-screen-props.tsx,members-i18n.ts,api/members-api.ts,hooks/*}`, `features/security/security-host-ports.ts` + `hooks/*-dependencies.hooks.ts` (4), `components/AssistantDock/hooks/assistant-transport.binding.ts`, `components/AssistantDock/hooks/composer-files.hooks.ts`, `components/AssistantDock/*.adapter.ts` (3), plus the x7 list (`*-host-ports.ts`, `*-i18n.ts` dictionary bindings, `lib/admin-http/request.ts`, `lib/i18n-common.ts`).

## FILES LEFT (combine-18 planner + scan.mjs; before = x7 head, after = x8 head e801d9286)
| area | before | after |
|---|---|---|
| adm-other | 167 | 147 |
| adm-shell-components | 47 | 45 |
| adm-shell-lib | 35 | 35 |
| adm-shell-hooks | 13 | 13 |
| **lane total** | **262** | **240** |
| adm-security | 29 | 25 |
| adm-members | 6 | 6 (all bindings, see above) |
| adm-themes | 32 | 32 (not reached) |

Planner-wide `moving`: **1238 -> 1212**; blocked 1026 -> 1004. The planner still counts every binding that stays in Tovu as moving, so the real remaining lane work is about 240 minus the ~70 bindings listed above.

## Gates (final, on the pushed heads)
- **Jini:**
  - `pnpm -r build`: 0. `pnpm typecheck`: 0. `api:check`: 0 (subpaths and kit exports added; `AdminKit*` and `InfoTipProps` reported as changed, not failing).
  - `check:hooks`: ok. `check:why-comments --base origin/codex/x7-admin-jini`: ok, 0 lost.
  - `pnpm guard`: 1 violation, the base HW3 `shell-failure-log.ts`, same as before. Its hardwiring/env stale-debt notes were already on the base. The 7 `SI-resolution packages/agent-plugins/*` lines appear only in worktrees (untracked generated files).
  - `packages/admin` full vitest: 6376 pass, 2 fail. Both failures are base-red on x7: `theme-boundaries` on `email.css`, and `AlwaysAllowPanel`, which I verified red on an untouched x7 checkout.
- **Tovu:**
  - Root `tsc -p tsconfig.json`: 0 errors. `typecheck:e2e`: 0. `apps/admin` `tsc --noEmit`: 0.
  - `check:hooks`: ok. `hook-injection-debt.json` only shrank (6 removals, 0 additions).
  - `check:why-comments --base origin/codex/x7-admin-tovu`: ok, 0 lost.
  - Admin vitest `--changed origin/codex/x7-admin-tovu --maxWorkers=2`: 8616 pass, 14 fail, 2 skipped. Of the 14:
    - 1 was an x8 regression: `chat-fab-z-order-css`, because the new `.jini-settings-dialog-backdrop` alias was not in the z-order inventory. It is fixed in e801d9286 (5/5 pass).
    - The other 13 are base-red: `security-panel` (6), `jini-class-host-css` (2), `phone-touch-targets-css` (2), `Media.unit`, `CollectionEntries.unit`, `use-dock-renderer-registry`.
  - Also base-red, outside the changed set: `content-editor-header-css` (3) and `list-table-detail-card-css`. I ran them on an x7 checkout.
  - `recharts-bundle-integer-ticks` and `app-sites-section-visibility` pass on the x8 head.
  - Node tests: no `apps/website`/`packages` test or source file changed (only 3 e2e journeys for class renames, which `typecheck:e2e` covers).

## Breaks ledger rows
| old | new | effect |
|---|---|---|
| `AdminKitChat`/`AdminKitComponents`/`AdminKitHooks` | + 8 chat names, `SeeMore`, `SearchableModelSelect`, `FileDropzone`, `useAgentPluginFileTree` (required) | every AdminKit implementer must supply them (Tovu kit, testing kit, forms harness updated) |
| plugin row/agent row/package-files classes (`plugin-row*`, `agent-plugin-*`, `agent-plugin-source-*`) | `jini-*` | host css, tests, 3 e2e journeys renamed |
| `external-mcp-tool-*`, `external-mcp-tools-modal*`, `mcpui-surface-overflow-*`, `assistant-empty-state`, `copy-keys-*`, `.library-*`, `database-*`, `notice`/`field`/`card`/`status-*` in moved database markup | `jini-*` | host css aliases/renames in the same commits |
| `PluginRow`/`AgentPluginRow` | need a `PluginRulesProvider` ancestor | Tovu screens mount it |
| `useAssistantTransport(input, options)` | `options` required (+ `createTransport`, `getAgUiEnabled`, `getResumeCapableAgentIds`, ...) | Tovu binding passes them |
| `usePlugins`/`usePluginInstall`/`useAgentPluginInstall`/`useAgentPluginUpdate` | required `rules`, `isApiError`, `folderZip`, `productName`, `translate` | Tovu bindings pass them |
| plugin server-copy keys naming the product | built from `productName` | same strings in Tovu |
| `Database` props | `ServerLabel`, `useAdminLocaleHook`, 3 section hooks required | Tovu binding passes them |
| `resolveMediaTabs({ t })` | `{ t, Icon }` | importers updated |
| `useExternalMcpToolPicker` | required `errors` dep | binding passes `ApiError` guard |
| install-tab-card css | imported by the Tovu hosts, not by Jini TSX | none |

## SELF-CHECK
- **No re-export/forwarding files.** Tovu files at old paths are bindings that call Jini factories/hooks with host ports.
- **Injection:** hooks reach Jini components only as required props or kit hooks. `@jini-ai/admin` has no `@jini-ai/ui` or domain-package import (guard L1/L3/L5 clean). `@jini-ai/cms` was not added.
- **CSS:** `jini-*` classes on moved markup; themes untouched.
- **Debt:** no new size/complexity/exception/debt rows. New `jini.isolation.shared` entries (reviewed shared sources): `screens/plugins/{rules,agent-plugins-visuals}`, `screens/taxonomy/TaxonomyRowMenu.hooks`, `screens/trash/rules`, `AssistantDock/hooks/chat-package-kind`, `screens/skills/skill-drop`. They are configuration that the subpath-isolation guard reads, not allow-list rows; flagged for review.
- **Why-comments:**
  - The checker needs exact text, so product-word blocks were kept verbatim on the Tovu binding next to the host code. Neutral blocks are verbatim in Jini.
  - In a few Jini files (`Database.tsx`, the media port) the verbatim blocks still name host paths and carry an added "package form" note.
- **Behaviour changes:**
  - Security.hooks got a new test first.
  - The `mediaContentType` `fetch` is injectable (default is the global at call time).
  - The validator's `fetch` is a lazy global wrapper.
  - `createMediaProvidersPort` delegates to module functions.
  - No auth or permission behaviour was changed.

## Caps and honest deviations
- **Coordinator:** Opus, ~150 tool calls, about 2 h 35 m wall-clock, under 300k context.
- **Workers over their caps:**
  - The plugins gate-fix worker used 83 calls and 168k tokens, over the 50/120k cap. It was not stopped mid-run.
  - Three others ended at 51-56 calls, and several ended at 127k-169k tokens.
- **Gates workers could not run:** workers could not run Tovu why-comments until they were given the explicit `--base` (the default `origin/refactor/terra` does not exist). Several batches arrived with lost why-comments and were fixed by follow-up workers before the final gate.
- **Small-areas worker:** it moved Trash/Library, then reverted them over `@jini-ai/ui` guard edges. A follow-up re-applied them through the existing kit facades.
- **Tests that did not move with their code:** the moved plugins hooks' tests stayed in Tovu, repointed to Jini, because they need host fakes built on `ApiError`. The `useAssistantTransport` cases also stayed. Both are gaps against "tests move with the code".

## Recommendations
1. Settings: give `ADMIN_LOCALES` a neutral home and put `ledger-slice` behind a port to unblock `lib/settings-tabs.ts`, then `SettingsUi`/`AdminAppearance`/the settings-tab kit slots.
2. Media: decompose `useMedia` and `useEditMediaPanel` below 80 lines in Tovu first (which removes their debt rows), then move them and `Media.tsx`.
3. Security (Opus): convert the `@jini-ai/ui`/`ui-kit` imports in `AccessTokensTab`/`CopyKeysDialog`/`RecoveryCodesCard` to kit slots, and inject the `user-management`/`integrations` implementations. `SITE_KEY_MANAGE_PERMISSION` placement is an owner call.
4. Dock: convert the `execution-config-write`/`messages-change` positional signatures (all callers), then `dock-chrome`/`local-cli-selection`/`runtime-access`. Decide on exporting `followDurableRun`.
5. Update the planner `KEEP_RULES` with the binding list above. Run `npm run check:hooks -- --update` to lock the 4-6 shrunk debt entries.
