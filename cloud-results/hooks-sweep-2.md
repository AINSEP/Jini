# hooks-sweep-2 (Jini)

Branch `wave3/hooks-sweep-2`, cut from `origin/refactor/terra` = `4c1892368` (Tovu companion: `ada11733f`). Node 24.11.1, pnpm 10.33.2. Setup: `pnpm install --frozen-lockfile` (exit 0), `pnpm --no-bail -r build` (exit 0). Vitest always `--maxWorkers=2 --minWorkers=1`.

Rule: a component receives EVERY custom hook it calls as a prop defaulted to the real hook (React built-ins exempt). Components that mount `I18nProvider` keep their `t` prop; no `t` prop was replaced.

## Part 1 — hooks-sweep-1 Jini commits, re-applied with the ratchets green

`git cherry-pick` of the 35 Jini commits of `origin/wave1/hooks-sweep-1` (everything but the report commit; the inventory commit `dd93f00d` comes with them) onto `refactor/terra`: clean, no conflicts. They failed `check:complexity` (15 components) and `check:size` (8 functions + 1 file), exactly as combine-1 measured. Fixed in 10 commits, each compiling and passing its package tests:

- **One grouped prop with one default** (`hooks = defaultXHooks`, exported `defaultXHooks` + `XHooks` type, calls `hooks.useX()`): AssetCard, AssetGrid, ByokProviderForm, LocalCliAgentCard, ExternalMcpTab, ClientPicker, MarkdownSplitPane, FileDropzone, IntegrationsTab, SkillsTab, VersionPreviewFrame, NotificationsTab, ConnectorDetailDrawer. Pre-existing public hook props (`useWiredAssetGridData`, `useAssetGridSelection`, `useFileDropzone`, `useFileDropzonePreviews`) were left alone.
- **Plus a small extracted child or pure helper where the single default still crossed the ceiling**: AssetCardBadges, DeleteFeedback (AssetGrid), ByokCardTitle, LocalCliAgentTestButton, FileDropzoneLabel/FileDropzoneBrowseFolder, ClientInstallActions, SkillsLoadError/SkillsCreateForm, SkillRowActions (SkillRow, one hook, so it keeps `useTHook`), `previewStatus` (VersionPreviewFrame), `selectedVersionFields` (VersionMetadata), TodoDismissButton, QuestionsFooter, AppearanceThemeControl, NotificationSoundPickers, ConnectorDrawerNotices, MemoryViewSwitch, MemoryListToolbar, `MemorySuggestionPanel.tsx` (moved out of MemoryConnectedPanel.tsx, which was 530 vs debt 513 lines).
- Tests moved from the old per-hook props to `hooks={{ ...defaultXHooks, useT: fake }}`; new cases with fake hooks for ByokProviderForm, ClientPicker, FileDropzone (global keydown), IntegrationsTab, NotificationsTab, ConnectorDetailDrawer, VersionPreviewFrame.
- Ratchets lowered by script (only lowers/removes, never raises; `--update` of the hook baseline checked: 0 entries raised).

## Part 2 — remaining FREE sites (Jini: 131 at start of part 2)

Converted 128 of the 131 with an AST codemod (props typed from the existing annotation; one hook -> `useXHook = useX` prop, several hooks -> grouped `hooks` prop) plus hand edits for shapes the codemod skips (forwardRef, `props.` param, param defaults, same-file hooks). Packages: chat (embed header/widget, A2uiSurfaceCard, AttachmentPreviewModal, AttachmentTray, ConversationList, ConversationTitleEditor, FolderChips, Markdown TableBlock/CopyCodeButton, McpUiSurfaceCard, MessageList, MessageRow, SentAttachment, ToolCallGroup, ToolCard, AgentPluginUsage, surfaces McpUiHost), ui (a2ui renderer, admin-widgets ×11, html-editor, i18n provider, iframe-pool, panel-kit ErrorNotice, privacy, progress-card, settings dialog shell, mcp-ui host, renderers ArtifactView/SrcDocSandbox), ui-kit (KitProvider/ToastRegion, SecretInput, ConfirmDialog, native Controls/Dialog/Navigation), admin (OverlayHost, ConfirmDialog), user-management (Passkeys), vibecoding (Workbench), commerce (Payments), examples/reference-web (McpUiLabHost). Complexity fixes needed after the codemod: MessageRow (`resolveDisplayProps` + `RunAccessNotice show`), ToolCallGroup (`ToolGroupToggle`), McpUiSurfaceCard (`recordedOrTypedAnswer`), InfoTip (two attribute helpers). `Select` keeps its public `useDropdown` prop (moved into the first parameter pattern); `Lightbox` keeps `useLightboxHook`, now destructured in the parameter list.

**Not converted (3 sites):** `packages/agent-runtime/src/skills/chat-motion-overlay/assets/remotion-template/.../BubbleScene.tsx` (`useCurrentFrame`/`useVideoConfig` are Remotion's own hooks inside a skill asset template that is not engine code and is not compiled with the package). The checker still lists them; the baseline keeps those entries.

Checker: Jini direct custom-hook calls 287 (head of part 1) -> 159 (owned sites + the 3 Remotion calls); `node scripts/check-hook-injection.mjs` and `pnpm check:hooks` now exit 0 (they exit 1 on base: 32 `useT` entries).

### Output tests with fake hooks (new files / cases)
`packages/ui-kit/src/react/__tests__/hook-injection.test.ts` (NativeButton/Badge/Notice/Spinner/Toast/Tooltip/Tabs/Dialog/ConfirmDialog/KitProvider/ToastRegion/SecretInput), `packages/ui/src/__tests__/hook-injection.sweep2.test.tsx` (ProgressCard, SrcDocSandbox, ErrorNotice, SeeMore, InfoTip, ImagePreviewModal, Select, SuggestInput, Lightbox, A2uiSurfaceRenderer, I18nProvider, IframeKeepAliveProvider, PooledIframe, ArtifactView, McpUiHost), cases appended to PrivacyTab and SettingsDialogShell tests, `packages/chat/src/react/components/__tests__/hook-injection.sweep2.test.tsx` (FolderChips, ConversationTitleEditor/ConversationTitle, SentAttachmentButton, ToolCallGroup, ThinkingBlock, AgentPluginUsage, ConversationList, AttachmentPreviewModal, AttachmentTray, surfaces McpUiHost, A2uiSurfaceCard, MessageRow, MessageList), `packages/chat/src/embed-widget/react/__tests__/header.hook.test.tsx`, `packages/commerce/src/react/__tests__/Payments.hooks.unit.test.tsx`, `packages/vibecoding/src/react/components/__tests__/VibecodingWorkbench.hook.test.tsx`, cases in admin `ConfirmDialog.test.tsx` / `overlays.test.tsx` and user-management `passkeys.unit.test.tsx`. Fakes are hand-written hook returns or `vi.fn(realHook)` spies that still drive the real view-model (ConversationList, AttachmentPreviewModal, ConfirmDialog controller); no `vi.mock` of any module was added.

**Converted but without a fake-hook output test** (not exported, or needs a heavy host): inner sub-components (ToolCard's cards, MessageRow's UsageSummary/RunActivityLine/AssistantMessageRow, Markdown TableBlock/CopyCodeButton, AttachmentTray's DefaultAttachmentChip, AttachmentPreviewModal's inner panes, `FolderChip`), `EmbedChatWidget`, `McpUiSurfaceCard`, `InteractiveHtmlEditor`, `PooledIframe`'s client path, `McpUiLabHostFrame`, `ConversationTitle`'s translator (asserts only that a quoting translator reached the DOM), ui-kit `NativeTextField/TextArea/Select/Checkbox/Switch/IconButton` (hook prop added, covered by the existing native tests only).

## Gates (exact command -> result)

Base (unmodified `refactor/terra`, from combine-1): all ratchets pass except `pnpm check:hooks` (exit 1, 32 entries).

| command on the branch head | result |
|---|---|
| `pnpm check:complexity` | exit 0, "17 entries (3 cyclomatic, 14 cognitive)" — identical to base |
| `pnpm check:size` | exit 0, "154 debt entries (131 functions, 23 files); 8 accepted exceptions" (base: 157; 3 entries removed/lowered by this work) |
| `pnpm check:hooks` | exit 0 (base: exit 1) |
| `pnpm guard` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm check:why-comments` (vs `origin/refactor/terra`) | exit 0, 230 files with removed lines, 0 comment blocks lost |
| `pnpm check:errors` (WARN mode) | exit 0, "20 new or worse" — same count as base after combine-1 |
| `pnpm api:check` | exit 0, but prints export drift (431 lines) for modules whose prop/exported names changed (default*Hooks, `*Hooks` types, grouped `hooks` prop); NOT fixed, `pnpm api:update` would also rewrite pre-existing drift — owner decision |

Full package suites on the branch head (`cd packages/<pkg> && npx vitest run --maxWorkers=2 --minWorkers=1`): ui 641 files / 8738 tests pass (a first run failed `renderers/__tests__/index.test.ts` because the new `defaultArtifactViewHooks` export was missing from the renderers barrel; fixed in `b34d12d20`, re-run green), chat 306 files / 4459 pass (+1 skipped; run started before the last three test commits, which were run alone: 16/16), ui-kit 19 / 232, admin 219 / 2874, user-management 104 / 1248, vibecoding 24 / 364, commerce 4 / 11. `examples/reference-web`: 9 unit files / 54 tests pass; the 2 Playwright files `e2e/chat-layout.test.mjs`, `e2e/composer-hit-targets.test.mjs` fail to load under vitest (need a running app; not compared against base, the only change there is `McpUiLabHost.tsx`).

## Left / next step
- 3 Remotion template sites (above) stay in the ratchet baseline; decide whether skill-asset templates are in scope of the rule.
- Add fake-hook output tests for the inner sub-components and the heavy hosts listed above.
- `pnpm api:update` (or a patch of only the new drift lines, as combine-1 did) once the owner accepts the new `default*Hooks` exports and the grouped `hooks` prop names.
- The grouped-prop names (`hooks`) differ from sweep-1's per-hook props (`useTHook`, ...) only on the 20 ratchet-offender components; the rest keep sweep-1's per-hook props.
- File overlap with other parallel runs: this branch edits component files under `packages/ui/src/features/{asset-grid,execution,external-mcp,file-dropzone,integrations,skills,version-manager,viewer-shell,appearance,notifications,connectors,memory,admin-widgets,privacy,progress-card,settings,a2ui,i18n,iframe-pool,panel-kit,html-editor}`, `packages/ui/src/{renderers,react/mcp-ui}`, `packages/chat/src/{react,embed-widget}`, `packages/ui-kit/src/react`, one file each in admin / user-management / vibecoding / commerce / reference-web, and the debt files `scripts/{hook-injection,size}-debt.json`. Any run touching those will conflict textually.
