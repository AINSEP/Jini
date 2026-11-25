PARTIAL c56062622 1288def50: 262 lane files left (247 planner-blocked incl. ~57 host bindings, 15 ready/STAYS-HOST); kit completed ~100 names, factories/rules/seams done, 40+ files moved; chat-component kit names, plugins screens, AssistantDock shell, settings/media screens not moved

# x7-admin — K2 kit completion, K4 seams, K5 injection, then the newly unblocked admin files

- **Branches:** Tovu `codex/x7-admin-tovu`, Jini `codex/x7-admin-jini`, both on top of `origin/codex/x6-admin-*`. No force-push, no `--no-verify`, `core.hooksPath` untouched, nothing published or tagged, no RemoteTrigger.
- **Required reading:** I read `AI-Dev-Shop/agents/programmer/skills.md` (Programmer agent: Base Skills, Conditional Skills, Role, Workflow). Its rules went into the worker brief: minimum change, no test weakening, no coverage gaming, why-comments and inline docs, fresh evidence before completion claims.
- **Planner:** `combine-18-plan.mjs` (from `integ/merge-18`) with `plans/P9-data/tools/scan.mjs` (from `plan/whats-left-1122`), run on the x6 head and on the x7 head.
- **Setup:** Jini `pnpm install --frozen-lockfile && pnpm -r build`; Tovu `npm ci --ignore-scripts` in root, `apps/admin`, `apps/desktop` with the `packages/contracts` `prepare` hook neutralised for the install and restored; `link-jini`; contracts built. Baseline before any edit: Tovu root `tsc` 0, `apps/admin` `tsc` 0.
- **Execution:** 11 Sonnet workers in 3 parallel worktree pairs (`/home/user/wt/wN-{tovu,jini}`), merged into the x7 branches by the coordinator, pushed after every merge. A container restart killed 3 running workers; their committed work survived and was resumed, one worker's uncommitted run (plugins) was redone.
- **Desktop:** `apps/desktop` not touched, so its gates were not needed.

## Prerequisites done
### K2 — AdminKit completion (`@jini-ai/admin` `react/kit.tsx`, Tovu wiring in `integrations/jini-kits.ts`)
211 names in the gaps file; 74 already existed from earlier lanes; **about 100 added** in x7:
- `AdminKitValues` / `AdminKitChat` / `AdminKitHooks` groups plus same-name facades, testing-kit fakes, and kit unit tests (33 in `kit.unit.test.tsx`).
- 0c types: `ExecutionConfig`, `ByokConfig`, `DetectedAgent`, `QueryKey`, `FetchQueryEnvironmentPort` and others re-exported from `@jini-ai/core` by name; `SettingsSlice*`, `ExecutionCredential*`, `SourceConfig*`, `StandingDraft*`, `Memory*`, chat types (`ComposerDiscovery*`, `ExtEvent*`, `AssistantChats*`, `AgentInventory*`, `ChatAttachmentValidator*`) restated structurally in `kit-ui-types.ts` / `kit-chat-types.ts`.
- 0a: hooks `useExecutionCredential`, `useSettingsSlice`, `useStandingDraftAutosave`, `useWiredCopyToClipboard`, `useCursorPages`, `useI18n`, `useDebouncedHtmlPreview`; values (execution helpers, clipboard, editor, accent, select, markdown, `retryWhileUnreachable`, `readableTextColor`, `mergeSaveStates`...).
- 0b chat factories: `isTerminalRunStatus`, `createExtEventRendererRegistry`, `createLastConversationStore`, `createAssistantChatsClient`, `createAgentInventorySnapshot`, `createConditionalHistoryRead`, `createChatAttachmentValidator`, title and slot-key helpers.
- Plugins seams: nine admin-surface protocol values (`kit-admin-surfaces.ts`), `isProviderSettingRequired`, `InfoTip.useTip`. `SecretInput` slot.
- **Not done (deferred, listed for the next lane):** big-prop chat components `ChatPane`, `ChatSettingsDialog`, `JiniChatProvider`, `ConversationList`, `ChatSettingsSegmented`, `McpUiSurfaceCard`, `A2uiSurfaceCard`, `FrontendSessionBridge`, `createDaemonAttachmentUploader`, `createMidRunMessagePoster`, `followDurableRun`, `SeeMore`, `SearchableModelSelect`, the settings tab components. The three `css` side-effect imports stay host-mounted (never Jini).

### K4 — type seams
- The four unowned K4 files (`integrations-api.types`, `security-api.types`, `source-control-api.types`, `access-token-rows`) were **already moved by earlier waves** (the planner's `blocked.json` and wave-5 item 1 are stale on this).
- `@tovu/contracts/credential-copy` seam: `use-credential-hint.hooks` moved (host copy and locale hook injected as required fields).
- `createCommonDictionary({ baseDictionary, hostEntries })` (K4-i18n-common, wave-5 item 3) plus `createLibraryDictionary`, `createTrashDictionary` factories.
- `createPluginRules({ productName, translate, describeApiError, isApiError, isProviderSettingRequired })` (coordinator decision, wave-5 item 3 pattern).

### K5 — injection
- Appearance snapshot / interface-preferences hooks take namespace, defaults and fetch-query as required fields; pure status labels moved; `resolveAdminLayoutClassName` generic.
- Locale: Jini already had `useAdminLocale(required)`; the ~40 zero-arg call sites stay host (the Tovu wrapper is the host binding). Moved files take a required `useAdminLocaleHook`-style prop.
- `create<X>Api({ request, ... }, _optional = {})` factories for the host api modules (coordinator decision below).

## Coordinator decisions taken (unattended; all follow wave-5 rules, flagged for owner review)
1. `create<X>Api` factories over the host `request` are approved for plain method-object api files (in-tree precedent `createProvidersApi`, `createObservabilityApi`). The Tovu file keeps its path as the binding that calls the factory (not a re-export).
2. `productName` seam for plugins `rules.ts` via a factory (wave-5 item 3).
3. Domain dests follow the planner into the domain package (`users-api`, `roles-api`, `members-api` -> `@jini-ai/user-management` `react/`); no domain deps added to `@jini-ai/admin`.

## Per-file table (files moved or classified in x7; `...` = see counts below)
| file (Tovu `apps/admin/src/`) | outcome |
|---|---|
| `lib/admin-http/{analytics,auth,database,mail-status,trash,settings}-api` (6 api modules, paths `features/*/api/*`, `lib/admin-http/settings-api.ts`) | MOVED -> `@jini-ai/admin` `screens/*/api/*`, `shell/lib/admin-http/settings-api`; Tovu file = factory binding |
| `features/users/api/users-api.ts` | MOVED -> `@jini-ai/user-management/react/users/api/users-api` |
| `features/{roles,members}/api/*` | MOVED -> `@jini-ai/user-management/react/{roles,members}/api/*` |
| `features/{import-export,pages,recovery,email}` api modules | MOVED -> `@jini-ai/admin` `screens/import-export/api`, `pages/api`, `recovery/api`, `screens/email` |
| `hooks/use-credential-hint.hooks.ts` | MOVED -> `shell/hooks/use-credential-hint.hooks` |
| `hooks/use-admin-appearance-snapshot.hooks.ts` | MOVED -> `shell/hooks/`; Tovu = ~10-line binding |
| `hooks/use-interface-preferences.hooks.ts` | MOVED -> `shell/hooks/` (+ `resolveAdminLayoutClassName`) |
| `components/status-labels.ts` (pure part) | MOVED -> `shell/lib/status-labels`; render wrappers STAY-HOST (15+ renderers) |
| `lib/i18n-common.ts` | STAYS-HOST (binding of `createCommonDictionary`) |
| `features/email` shared parts + Overview/Sender/Activity/Templates tabs | MOVED -> `screens/email/*`; Segments STAYS-HOST |
| `features/trash` dictionary | MOVED -> `screens/trash/trash-i18n` factory |
| `features/providers` AlwaysAllowPanel + `use-always-allow.hooks` | MOVED -> `screens/providers/*` |
| `features/library/library-i18n.ts` | MOVED -> `screens/library/library-i18n` factory |
| `features/voice-input/hooks/mic-capture.ts` | MOVED -> `screens/voice-input/hooks/mic-capture` |
| `components/ChatFab/ChatFab.tsx` | MOVED -> `shell/components/ChatFab` (storage key = required prop) |
| `components/WidgetConfigFields/media-content-rules.ts` | MOVED -> `shell/components/WidgetConfigFields/` (embed policy injected) |
| `lib/assistant-daemon-activation.ts` | MOVED -> `shell/lib/` |
| `components/AssistantDock/{DockHeaderTip,DockLeadingAccessory,FolderDropNotice,chat-display-preferences,assistant-runtime-preferences}` | MOVED -> `shell/components/AssistantDock/*` |
| `components/AssistantDock/hooks/assistant-mcp-ui.ts` | MOVED -> `shell/components/AssistantDock/hooks/` |
| `components/AssistantDock/hooks/{composer-skills.hooks,resolve-composer-discovery-outcome}` | MOVED -> `screens/plugins/` |
| `features/plugins/{plugins-visuals,AgentPluginMaturity,AgentPluginLinkedLock}` | MOVED -> `screens/plugins/*` (`jini-*` classes) |
| `features/plugins/components/AgentPluginMemoryPanel.tsx` | MOVED -> `screens/plugins/` |
| `features/plugins/hooks/use-agent-plugin-memory.hooks.ts` | MOVED (core) + STAYS-HOST (wired part) |
| `features/plugins/rules.ts` | MOVED -> `screens/plugins/rules` (`createPluginRules`); Tovu = host binding |
| `features/plugins/{admin-surface-theme,hooks/use-admin-surface-frame.hooks,AgentPluginSurfaceFrame}` | MOVED -> `screens/plugins/*`; `ADMIN_TOKEN_SOURCES` STAYS-HOST (`admin-token-sources.ts`) |
| `features/settings/rules.ts` | MOVED -> `screens/settings/rules` |
| `features/media/rules.ts` | MOVED -> `screens/media/rules` |
| `components/SecretInput/SecretInput.tsx` | MOVED -> `shell/components/SecretInput` (new kit slot) |
| `lib/admin-http/request.ts` | STAYS-HOST (already host binding of `createAdminHttp`; ApiError, failure channel, product copy, reconnect module state) |
| `*-host-ports.ts` (comments, forms, integrations, plugins, providers, widgets, posts, security, source-control, deployment), `observability-api` | STAYS-HOST (already factory bindings) |
| `themes-api`, `held-back-themes-api` | STAYS-HOST (themes stay in Tovu) |
| `lib/settings-tabs.ts` | STOPPED (needs `ADMIN_LOCALES` home + `ledger-slice` move) |
| `lib/server-reconnect.ts` | STOPPED (x6 recommendation not done) |
| `features/settings/{ExternalMcpToolsModal,ExternalMcpToolPicker}` | STOPPED (need `SeeMore` kit slot + 3 hook props + product vars) |
| `features/settings/ai-agent-presentation.ts` (+ hook) | STAYS-HOST (host voice-input port, product bridge key) |
| `features/media/media-i18n.ts`, `*-i18n.ts` (collections, comments, forms, menus, taxonomy, widgets) | STAYS-HOST (already factory bindings) |
| `features/voice-input/voice-input-port.ts` + `use-push-to-talk` | STAYS-HOST (`window.tovuVoice`) |
| `features/voice-input` components | STAYS-HOST (need `@jini-ai/chat` which `@jini-ai/admin` may not import) |
| `features/skills/*`, `database/*`, `import-export/*`, `observability/*`, `auth/*`, `authentication/*`, `email/Email.tsx`+provider tab+template editor | STAYS-HOST (host wiring/bindings) |
| `components/AssistantDock/{AssistantDock,DockChatPane,DockHeader,*State*}`, `OverflowAwareMcpUiSurfaceCard`, `RoutedA2uiSurfaceCard`, `assistant-dock-props`, `execution-config-write`, `agents-inventory`, `runtime-access`, `local-cli-selection`, `assistant-transport`, `byok-runtime`, `composer-files`, `composer-discovery`, `execution-config*`, `use-dock-renderer-registry` | STAYS-HOST (missing chat component kit names / host execution-settings seams, listed above) |
| `hooks/messages-change.hooks`, `hooks/run-context.hooks` | STOPPED (positional signature / `FrontendSessionBridge` kit type) |
| `features/plugins` remaining rows, panels, dialogs, hooks (~30 files incl. PackageFilesModal x2, use-plugin-package-files) | STOPPED (depend on host-bound wired hooks, zero-arg locale, host `request`; PackageFilesModal batch not started: cap) |
| `components/{WidgetConfigFields (rest), MediaPickerDialog, MediaEditDialog, WidgetPickerDialog, EmbedInsertControl, TemplateSource*, Select}` | STOPPED / STAYS-HOST (callers' fixed prop contracts; host css; `@jini-ai/cms` domain dep) |
| `hooks/*` (13) | STAYS-HOST (all are wrappers binding Jini/kit hooks to Tovu ports/copy, or product) |
| `lib/*` (22) | STAYS-HOST (host bindings / `@tovu/*` copy / module state) |
| `features/media`, `features/settings` other hooks and screens | STOPPED (not started past the three moved files; need locale/request seams and theme hooks as required props) |

## FILES LEFT (combine-18 planner, lane areas, before = x6 head, after = x7 head)
| area | before | after |
|---|---|---|
| adm-other | 180 | 167 |
| adm-shell-components | 58 | 47 |
| adm-shell-lib | 35 | 35 |
| adm-shell-hooks | 14 | 13 |
| **lane total** | **287** | **262** |

Planner-wide `moving`: **1263 -> 1238**. Blocked in the lane: 274 -> 247. The planner counts every Tovu *binding* file (a file that now only calls a Jini factory) as still moving, so the real remaining work is smaller: by a name/size heuristic about 57 of the 247 blocked lane files are bindings (STAYS-HOST candidates; add to `KEEP_RULES`), 190 are real work, dominated by the plugins screens (~30), the AssistantDock chat shell (~20, needs the chat component kit names), settings/media screens and the dialogs.

## Gates
- **Jini:** `pnpm -r build` 0; `pnpm typecheck` 0; `pnpm guard` 1 violation = the known base HW3-module-state in `shell-failure-log.ts` (in the main tree; the extra `SI-resolution` lines in worker trees come from untracked generated `agent-plugins` files); `api:check` 0 (subpaths only added); `check:hooks` ok; `check:why-comments` (base `origin/integ/merge-20-2026-11-24`) ok, 0 lost. Changed vitest: kit 33/33, plugins 104/104, settings+media+shell+react+forms 1513 pass with 1 failure `theme-boundaries` on `screens/email/email.css` (hex literal; not touched by x7, verified present in the worker trees on the x6 base files - treat as base).
- **Tovu:** root `tsc -p tsconfig.json` 0; `apps/admin` `tsc --noEmit` 0. Admin vitest `--changed origin/codex/x6-admin-tovu --maxWorkers=2`: see the result line below.
- **Base-red tests confirmed on an untouched x6 worktree:** `dictionary-lookup-sinks` (14 declarations found, more than 25 expected) and `admin-literal-copy` (stale baseline entries to prune). Previously known base-red: focus-ring-css, list-table-detail-card-css, locale-hook-required-props.source-pin, narrow-content-column-css, phone-touch-targets-css, Media.unit, use-dock-renderer-registry, CollectionEntries.unit, security-panel. Not confirmed against base: `jini-class-host-css` (2), `recharts-bundle-integer-ticks`, `login-default-credential` ("useAdminLocaleHook is not a function") - see the vitest result below.

## SELF-CHECK
- No re-export/forwarding files. Tovu files that remain at an old path are bindings that call a Jini factory with host ports (listed above) — flagged as a judgement call following the in-tree precedent.
- Hooks are required props; `check:hooks` ok (`DockHeaderTip` fixed to take the kit-values hook as an injected prop).
- `jini-*` classes renamed together with host css/tests (`jini-folder-window-note`, `jini-plugin-chevron-glyph`, `jini-agent-plugin-maturity`, `jini-agent-plugin-linked-lock`).
- No new size/complexity/debt/exception rows. package.json entries added for each new subpath (`jini.entries`, `isolation.entries`, `exports`); `status-labels` and `media-content-rules` entries set to the runtime domain the guard requires.
- Product words neutralised in moved comments; why-comments gate green.

## Breaks ledger rows
| old | new | effect |
|---|---|---|
| CSS classes `tovu-folder-window-note`, plugin chevron/maturity/linked-lock classes | `jini-*` equivalents | none (renamed everywhere in the same commit) |
| `CHAT_DISPLAY_NAMESPACE` | literal `"core.interface"` in Jini | the host `INTERFACE_NAMESPACE` constant now has a second copy |
| `useCredentialHint` / `useStoredCredentialHint` | required `formatCredentialHint`, `storedCredentialHint`, `useAdminLocale` fields | importers repointed |
| `isDroppedAttributeRow`, `resolveByokConfig`, `accentSwatchName`, media rules `translate`/`describeApiError` | new required fields on existing args objects | host passes them |

## Caps and honest deviations
- Workers went over the per-worker 45-call cap in several cases (up to 52 tool calls, 107k-186k tokens each) — same deviation as x6.
- Coordinator stayed under 220 tool calls and 250k context; wall-clock about 2 h.
- Three workers were killed by a container restart; committed work was kept, uncommitted plugins work was redone.
- `pnpm guard` in worker worktrees shows 7 extra `SI-resolution` lines (`agent-plugins/cloudflare`, untracked generated files); the main tree shows only the base HW3 line.
- Plugins screens (rows/panels/dialogs/hooks), PackageFilesModal batch, settings/media screens, and the AssistantDock chat shell were NOT moved in this run (blocked on the chat-component kit names and host seams listed above).

## Recommendations
1. Next lane: kit slots for `ChatPane`, `ChatSettingsDialog`, `JiniChatProvider`, `ConversationList`, `ChatSettingsSegmented`, `McpUiSurfaceCard`, `A2uiSurfaceCard`, `SeeMore`, `SearchableModelSelect`, `FrontendSessionBridge`, `createDaemonAttachmentUploader`, `createMidRunMessagePoster` — unblocks AssistantDock, ExternalMcp, voice-input components.
2. Add the host binding files (api/host-ports/dictionary/dependencies bindings listed above) to `combine-18-plan.mjs` `KEEP_RULES` so the planner stops counting them.
3. Convert the zero-arg `useAdminLocale()` call sites to a required `useAdminLocaleHook` prop one feature at a time as screens move; then PackageFilesModal (wave-5 item 5) and the rest of plugins.
4. Move `ADMIN_LOCALES` to a neutral home and `ledger-slice` behind a port to unblock `settings-tabs.ts`; move `server-reconnect` per the x6 recommendation.
5. Prune the stale `admin-literal-copy` baseline and lower the `dictionary-lookup-sinks` floor (both base-red).

## Admin vitest result (--changed origin/codex/x6-admin-tovu, --maxWorkers=2, before the test fixes below)
Test Files 7 failed | 548 passed (555); Tests 27 failed | 10282 passed. Failing files: HtmlAttributeRows (4), MediaContentEditor.markup (13), login-default-credential (1) were REAL x7 regressions (tests rendered without AdminKitProvider after DockHeaderTip/SecretInput moved to kit slots) - FIXED in c56062622 (re-run: WidgetConfigFields + auth 100+39 tests green). The remaining 8 failures are base-red: security-panel (6), Media.unit (1), CollectionEntries.unit (1), use-dock-renderer-registry (1; also base-red per x6). Not reproduced on base but unchanged by x7: none outstanding.
