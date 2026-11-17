# hooks-sweep-1

Branch `wave1/hooks-sweep-1` in both repos (base `origin/refactor/terra`). Rule applied: every component receives every custom hook it calls as a prop defaulted to the real hook; React built-ins exempt. Same file lives on both branches.

## Result

| repo | sites at base | FREE at base | FREE converted | FREE left | owned (not touched) |
|---|---|---|---|---|---|
| Jini | 587 | 428 | 297 | 131 | 159 |
| Tovu | 284 | 49 | 46 | 3 | 235 |

Checker totals now: Jini 587 -> 290 direct calls; Tovu 284 -> 238 direct calls. `pnpm check:hooks` (Jini) and `npm run check:hooks` (Tovu) both report `hook-injection: ok`.

Owned sites (counts of sites; a site can have several owners):
- Jini: plan/admin-ui-extraction 99 (packages/admin, user-management), plan/xpkg-lane-sheets 58, plan/notes-second-app 23, wave1/notes-waveA 3, plan/desktop-extraction 3, plan/left-out-areas 2, plan/lanes-s-u 2.
- Tovu: plan/admin-ui-extraction 195, apps/desktop live run (desktop-p0) 35, plan/left-out-areas 17, check:size/complexity/architecture/errors offender files 15, plan/desktop-extraction 7, plan/xpkg-lane-sheets 2, plan/notes-second-app 1. Per-site detail: `cloud-results/hooks-inventory.tsv` (column OWNED_BY); counts per area: `cloud-results/hooks-inventory-counts.md`.
- Ownership heuristic (when unsure -> owned): path, src-relative path, basename or dir-glob mention in the plan INDEX/sheets; admin-ui-extraction inventory verdicts other than STAY*; wave1/* branch diffs; apps/desktop/**; offender files of the 4 Tovu checks.

## Commits (all pushed to `origin/wave1/hooks-sweep-1`)

Jini:
```
dd93f00d chore(hooks): hooks-sweep-1 phase 1 inventory (587 sites, 428 free)
21763a33 asset-grid components receive their hooks as props defaulted to the real hook
8dc1d984 memory components receive their hooks as props defaulted to the real hook
76017d5c execution components receive their hooks as props defaulted to the real hook
31eb3901 source-config-list components receive their hooks as props defaulted to the real hook
95af2906 connectors components receive their hooks as props defaulted to the real hook
008a666e asset-tree-browser components receive their hooks as props defaulted to the real hook
186b57d5 viewer-shell components receive their hooks as props defaulted to the real hook
7febabb9 version-manager components receive their hooks as props defaulted to the real hook
d66856de integrations components receive their hooks as props defaulted to the real hook
c1be43bd shared react/components receive their hooks as props defaulted to the real hook
4cd2f631 file-dropzone components receive their hooks as props defaulted to the real hook
2da150e6 schedule-picker components receive their hooks as props defaulted to the real hook
f651c065 mention-autocomplete components receive their hooks as props defaulted to the real hook
4e6c1c43 skills components receive their hooks as props defaulted to the real hook
de64f44e resource-dashboard components receive their hooks as props defaulted to the real hook
787e4583 tab-strip components receive their hooks as props defaulted to the real hook
ae652bac external-mcp components receive their hooks as props defaulted to the real hook
ccd2358b html-viewer components receive their hooks as props defaulted to the real hook
6dab003c about tab receives its hooks as props defaulted to the real hook
b9a11a10 notifications tab receives its hooks as props defaulted to the real hook
6fefbec4 media-providers tab receives its hooks as props defaulted to the real hook
1a42d148 tab-launcher-menu components receive their hooks as props defaulted to the real hook
9ac182c2 interactive-ui shadcn fields receive their hooks as props defaulted to the real hook
bf8f444a preview-modal-shell components receive their hooks as props defaulted to the real hook
ebd35af0 annotation-canvas components receive their hooks as props defaulted to the real hook
a881dfc3 sketch-editor components receive their hooks as props defaulted to the real hook
7c6fade4 appearance tab receives its hooks as props defaulted to the real hook
8e3bfa08 language tab receives its hooks as props defaulted to the real hook
ebbf1d6b instructions tab receives its hooks as props defaulted to the real hook
7943ce37 list-detail-panel tab receives its hooks as props defaulted to the real hook
5535e260 command-palette components receive their hooks as props defaulted to the real hook
f2339e8c tabbed-dialog components receive their hooks as props defaulted to the real hook
92e461b6 revision-review components receive their hooks as props defaulted to the real hook
fb8d8e33 project-locations components receive their hooks as props defaulted to the real hook
810e096b refactor(chat): todo, questions, copy, fab and next-step components receive their hooks as props defa
```
Tovu:
```
169eff49 chore(hooks): hooks-sweep-1 phase 1 inventory (284 sites, 49 free)
f6d53159 refactor(admin): admin-ui, authentication and playground screens receive their hooks as props defaulted to the 
66ce4d03 refactor(admin): voice-input components receive their hooks as props defaulted to the real hook
e83ec1ac refactor(admin): workspace screens receive their hooks as props defaulted to the real hook
8df7780f refactor(admin): dashboard screens receive their hooks as props defaulted to the real hook
8ea5d13c refactor(admin): webmcp screens receive their hooks as props defaulted to the real hook
3e27dcd1 refactor(admin): publish-content screens receive their hooks as props defaulted to the real hook
93432d80 refactor(admin): content-analysis screens receive their hooks as props defaulted to the real hook
3fef8d73 refactor(admin): ai-assistant screens receive their hooks as props defaulted to the real hook
de113405 refactor(admin): integrations screens receive their hooks as props defaulted to the real hook
89901737 refactor(admin): auth screens receive their hooks as props defaulted to the real hook
34a8dfb7 refactor(admin): providers screens receive their hooks as props defaulted to the real hook
c238266b refactor(admin): email screens receive their hooks as props defaulted to the real hook
f6c7509c refactor(admin): observability screens receive their hooks as props defaulted to the real hook
3789d86e refactor(admin): sites screens receive their hooks as props defaulted to the real hook
fd8d8f55 refactor(admin): skills screens receive their hooks as props defaulted to the real hook
7c4ddcac refactor(site-chat): assistant header and widget receive their hooks as props defaulted to the real hook
de3ed131 refactor(admin): jini-admin module panel and chart registry provider receive their hooks as props defaulted to 
eeab8dff refactor(admin): keep Skills and PublishContentDialog inside the complexity and size ceilings after hook inject
```

## Gates run (exact command -> result)

Setup: Node 24.22.3 in ~/.local/node24; Jini `pnpm install --frozen-lockfile` ok, `pnpm --no-bail -r build` ok (no errors in log). Tovu `npm ci` (root, apps/admin, apps/site-chat), `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, `npm run build` in packages/contracts and packages/sdk ok. Vitest always `--maxWorkers=2` (Jini packages/ui needed `--minWorkers=1` too, vitest 2.1.9 + tinypool 2 conflict otherwise).

Baseline on the unmodified tree:
- Jini `node scripts/check-hook-injection.mjs` exited 1: 32 entries absent from `scripts/hook-injection-debt.json` (mostly `useT`), so the Jini gate was already red before this run. Those entries cleared as the sites were converted. Tovu `node development/scripts/check-hook-injection.mjs` -> ok (284).
- Tovu `npm run check:size|complexity|architecture|errors` run before any edit (outputs used for ownership); errors gate is WARN mode, 12 new entries at base and 12 after.

Per commit (Jini): `npx tsc -p tsconfig.json --noEmit` in packages/ui (and packages/chat for the chat commit) clean; `npx vitest run --maxWorkers=2 --minWorkers=1 <touched area>` green every time; `node scripts/check-hook-injection.mjs` after lowering the baseline.
Full suites on the Jini head: `cd packages/ui && npx vitest run --maxWorkers=2 --minWorkers=1` -> 640 files / 8716 tests passed; `cd packages/chat && npx vitest run --maxWorkers=2 --minWorkers=1 src/react` -> 160 files passed, 1 skipped (2084 tests passed, 1 skipped).
Per commit (Tovu): `npx tsc --noEmit` in apps/admin and apps/site-chat clean; `npx vitest run --maxWorkers=2 <area>` green; site-chat `node --import tsx --test --test-concurrency=1 src/__tests__/SiteAssistantHeader.test.ts SiteAssistantWidget*.test.ts` green (12 + 4 tests).
Tovu broad run over all converted apps/admin areas: 157 files, 156 pass; the 1 failure is `src/integrations/chart-providers/__tests__/recharts-bundle-integer-ticks.unit.test.ts` (cannot find `/home/user/Jini/packages/provider-plugins/plugins/charts-recharts/0.7.0/client/provider.js`, a file missing from the linked Jini checkout; not run against the base tree, not caused by a hook change).

Ratchet: baselines lowered with a small script that only lowers or removes entries (never raises, never `--update`), scripts in the session scratchpad.

Size/complexity gates:
- Tovu: after the first sweep `check:size` flagged `PublishContentDialog` (+1 line) and `check:complexity` flagged `Skills` (10). Fixed in `eeab8dff` (join two destructure lines; extract `SkillsOverlays`). After the fix neither file is reported; remaining violations are pre-existing files I did not touch. Intermediate commits between `f6d53159` and `eeab8dff` carry those two violations and a baseline already lowered for sites whose commits came later (the debt file was lowered for all converted sites in the first Tovu commit, so check:hooks on that single commit alone would fail; the branch head is consistent).
- Jini: NOT fixed. `node scripts/check-complexity.mjs` and `node scripts/check-size.mjs` fail on the head with violations caused by the extra default-parameter branches/lines. Complexity (new, all `[complexity]`): chat TodoCard 11; ui AssetCard 13, AssetGrid 12, ByokProviderForm 12, LocalCliAgentCard 12, ExternalMcpTab 11, FileDropzone 12, ClientPicker 11, IntegrationsTab 12, SkillRow 11, SkillsTab 12, VersionMetadata 11, VersionPreviewFrame 12, MarkdownSplitPane 11. Size (new/worsened `max-lines-per-function`): AssetCard 81, AssetGrid 82, AppearanceTab 82, ConnectorDetailDrawer 101, MemoryList 93, MemorySettingsPanel 95, NotificationsTab 97, SkillRow 107; `max-lines` MemoryConnectedPanel.tsx 530. Next step: extract the hook-calling part of each into a small child component (as done for Tovu `SkillsOverlays`), then lower the ratchet files.

## Tests added
New files (Jini): `hook-injection.test.tsx` in asset-grid, asset-tree-browser, connectors, execution, integrations, source-config-list, react/components, chat/react/components; `select-hooks.test.tsx` (interactive-ui). Fake-hook/translator cases were appended to the existing test files of the other areas. Tovu: `voice-input/__tests__/hook-injection.unit.test.tsx`, `jini-admin/__tests__/module-hook-injection.unit.test.tsx`, `chart-providers/__tests__/ChartRegistryProvider.unit.test.tsx`, plus cases in existing files (admin-ui, authentication, playground, dashboard, webmcp, publish-content, workspace, integrations, ai-assistant, auth, email, observability, sites, skills, site-chat header). Authentication's locale test dropped its `vi.mock` of `use-admin-locale.hooks` in favour of the prop. No `vi.mock` of a hook module was added.
Every converted file that called `useT`/`useI18n` has an output test that renders a real translated string through the real provider and asserts it is not the key (ui: `I18nProvider`; chat: `I18nContext.Provider`; Tovu voice-input: `JiniChatProvider` adapter). In most Jini areas that test already existed; the ones I added are in the new/extended test files above.
Not covered by a fake-hook test (conversion applied, existing tests green, default-hook path only): inner sub-components that are not exported (they cannot receive a fake from outside; they use the real default), `AnnotationCanvas` (`useAnnotationCanvasHook`), `SketchEditor` (4 hooks), `ChatFab` (`useChatFabDragHook`), `PublishContentDialog` (`usePublishContentConfirmHook`), `SiteAssistantWidget`, `SkillInstallConfirmation`, `ByokProviderForm`/`ExecutionTab` fake controllers, `FileDropzoneZone`, `ProjectLocationsTab`, `ResourceBoard` view hook.

## Skipped (design change or conflict), needs a decision
- Jini `packages/ui/src/features/admin-widgets` (11 sites: ImagePreviewModal, InfoTip, Lightbox, SeeMore, Select, SuggestInput): codemod broke them (hooks are aliased locals such as `const useLightboxHook = props.useLightbox ?? useLightbox`, hooks defined in the same file); reverted, converting needs a hand edit per component.
- Tovu `apps/admin/src/features/providers/Providers.tsx` (3 sites: useAdminLocale, useAdminThemeBoundary, useProvidersHook): its own comment says the resolver idiom exists to stay under the complexity ceiling; default destructuring adds 3 branches. Do it together with extracting the tab body.
- Jini remaining FREE (131): chat/react/components 68 (ToolCard 16, MessageRow 16, MessageList, AttachmentPreviewModal, AttachmentTray, McpUiSurfaceCard, Markdown, FolderChips, ConversationTitleEditor, ConversationList, A2uiSurfaceCard, SentAttachment, ToolCallGroup), ui-kit/react/native 18, admin-widgets 11, plus 34 single-site files (agent-runtime chat-motion-overlay 3, ui iframe-pool 3, renderers/react 3, mcp-ui 2, admin/react/components 2, user-management auth 2, chat embed-widget 2, ui-kit KitProvider 2, and one each in commerce Payments, reference-web McpUiLabHost, ui a2ui/html-editor/i18n/panel-kit/privacy/progress-card/settings, vibecoding, admin OverlayHost, chat surfaces/features, ui-kit SecretInput/confirm).
- Not run: Jini `pnpm guard`, `pnpm typecheck` at repo root, tests of packages other than ui and chat/src/react, `tsc` for ui-kit/admin/user-management (no files touched there); Tovu `check:architecture` after the edits, full admin/website suites, the desktop pre-push gates did not trigger (no apps/desktop changes).
