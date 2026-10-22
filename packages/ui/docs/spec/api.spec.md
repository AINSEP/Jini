Spec ID: SPEC-JINI-UI-API
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4565148d0501d6ecf3428e94585b6f2b6a174f685a5808df430f5d5bf5f15112
spec_mode: reverse_spec


# API contract: @jini-ai/ui

## Purpose and calling convention

Consumer contract for the current source and `package.json` export map. This package supplies UI mechanisms, components, decision rules and injectable host interfaces. It does not own a consumer's routes, credentials, database or application state.

Signatures below preserve the implemented API. Converted functions use `(required, optional = {})`; a function shown with one props/spec object, no arguments, or positional arguments still has that shape today. Do not pass a second object to a one-object function and expect it to be read. React components receive one props object through JSX. References to `src/` are relative to this package; exported TypeScript types specify the detailed DTOs and callback shapes.

## Public entry registry

| Import suffix | Runtime and surface | Source entry |
|---|---|---|
| package root | React primitives, browser hooks, feature domains, utilities, widgets and panel kit | `src/index.ts` |
| `/core` | Framework-free settings/domain types, rules, catalogs and ports | `src/core.ts` |
| `/sketch-editor` | Excalidraw scene editor, rules, DOM enhancements and engine port | `src/features/sketch-editor/index.ts` |
| `/lexical-rich-text-editor` | Plain-text editor with atomic mentions, trigger and caret helpers | `src/features/lexical-rich-text-editor/index.ts` |
| `/html-editor` | GrapesJS inline HTML editor and canvas adapters | `src/features/html-editor/index.ts` |
| `/mcp-ui` | React MCP Apps host, message source and all surface exports | `src/react/mcp-ui/index.ts` |
| `/mcp-ui/surfaces` | Framework-free resource builders, confirmation store, protocol and proxy HTML | `src/features/mcp-ui/index.ts` |
| `/interactive-ui` | React provider components, schemas, manifests and registry | `src/features/interactive-ui/index.ts` |
| `/interactive-ui/manifests` | Framework-free schemas, manifests and preference-ordered `ALL_MANIFESTS` | `src/features/interactive-ui/manifests.ts` |
| `/a2ui` | Interpreter re-exports, registry-to-catalog adapter and React rendering | `src/features/a2ui/index.ts` |
| `/renderers` | Artifact registry, renderers, document builders, previews and annotation UI | `src/renderers/index.ts` |
| `/admin-widgets` | Select, tooltips, text clamp, image dialog and notices | `src/features/admin-widgets/index.ts` |
| `/panel-kit` | Query exports, focus/dirty/async/write hooks, formatting, permissions, retry and translation | `src/features/panel-kit/index.ts` |
| `/fetch-query` | Provider and four query/cache hooks plus public query types | `src/features/panel-kit/fetch-query/index.ts` |
| `/theme` | Theme data, validation, DOM application and color-scheme resolution | `src/theme/index.ts` |
| `/interactive-ui.css` | Compiled interactive-provider styles | `src/features/interactive-ui/styles.css` |
| `/settings-dialog.css` | Settings shell styles | `src/features/settings/dialog/styles/settings-dialog.css` |
| `/tabbed-dialog.css` | Generic tabbed shell styles | `src/features/tabbed-dialog/styles/tabbed-dialog.css` |
| `/remixicon.css` | Icon font CSS and relative WOFF2 asset | `src/react/components/remixicon-font/remixicon.css` |
| `/admin-widgets.css` | Standalone widget styles | `src/features/admin-widgets/styles/admin-widgets.css` |
| `/styles/*` | Static assets; current source files are `variables.css` and `admin.css` | `src/styles/` |

React and React DOM peers support `^18.3.0 || ^19.0.0`. Editor peers are optional to install for other entry points, but required when importing their editor: Excalidraw `0.18.1`; Lexical, `@lexical/react` and `@lexical/utils` `0.36.2`; GrapesJS `0.23.4`. The root barrel excludes the three heavy editors, MCP hosts, interactive providers, A2UI, renderers and theme; use their explicit subpaths. Framework-free entries require no React mount or host DOM.

## Root entry

Components use `Component(props: ComponentProps): ReactNode` or React's `forwardRef` equivalent. Props remain a single object; events retain the callback signature declared in each props type. Hooks obey React's mount/order rules. Each feature barrel re-exports its types, constants, rules, dependencies, hooks and components; those are root exports, not additional package subpaths.

| Root API family | Public surface and consumer inputs |
|---|---|
| i18n | `I18nProvider`, `useI18n(): I18nContextValue`, `useT(): I18nContextValue['t']`, locale resolution, settings dictionaries and dictionary/template helpers. Supply dictionaries and optionally `LocalePersistencePort` and `SystemLocaleDetector`. |
| primitives | `Icon`, `RemixIcon`, `AgentIcon`, `EditorIcon`, `BrandLogo`, `Toast`, `Spinner`, `Skeleton`, `DesignCardSkeleton`, `CenteredLoader`, `TooltipLayer`, `CustomSelect`, `KitErrorBoundary`, `LanguageMenu`, `WorkingDirPicker`, `AppChromeHeader`, `ExportDiagnosticsButton`, `PaletteTweaks`, `OptionCards`, `CompactToggle`, `ToggleRow`, `StatCard`, `Notice`, `ImportChoice`, `FileImportPanel`, onboarding header/chips/dropdown, `HeaderActionsMenu`, `EdgeScrollZones`, `PillButton`, `PopoverMenu`, `PopoverItem`, `TokenChip`, `ValueChip`, `ComponentKitPreview`. Supply content, labels and callbacks in each component's props; no implicit backend. `ICON_RENDERERS` is intentionally not exported. |
| browser/hooks | `useDismissOnOutsideOrEscape`, `useGlobalKeydown`, `useFileDropTarget`, `useModalWindowDragGuard`, `useInView`, `useCoalescedCallback`, `useStableHandler`, `useDebouncedValue`, `useResizableSplitPane`, `useBrandFonts`, `useEdgeAutoScroll`. Inputs are declared options, element refs and callbacks; returns are controllers/disposers or computed values. Browser event ownership ends at effect cleanup. |
| settings shells | `TabbedDialog(props: TabbedDialogProps)` and `SettingsDialogShell(props: SettingsDialogShellProps)` with tab metadata/panels, optional controlled tab id, labels and close callbacks. Matching hooks return their controllers. |
| settings tabs | Appearance, notifications, language, instructions, privacy and about components use caller preferences and callbacks. Execution, integrations, project locations, skills and media providers use the corresponding ports below. |
| connectors | `ConnectorsBrowser`, hooks and rules consume `ConnectorsDependencies` (`data`, pending-auth storage and browser auth/refocus bridge). Data port fetches catalog/status/detail, connects/disconnects/cancels auth and opens redirect URLs. |
| memory | Config, entry/index, extraction and connector hooks/components consume `MemoryConfigPort`, `MemoryEntriesPort`, `MemoryExtractionsPort`, `MemoryConnectorsPort`; these expose async reads/writes and pending-auth/cross-tab effects. |
| source configuration | `SourceConfigList`, view, row, add form and source rules consume `SourceConfigDependencies<T> = {port: SourceConfigPort<T>}`. Required fetch/add/remove; optional refresh/trust/update/test determine available affordances. `ExternalMcpTab` composes this mechanism with MCP field specs. |
| assets | Asset grid/tree components and hooks receive asset DTOs and their data/live-update/clipboard/download ports. File-transfer helpers handle browser drag/clipboard input. No package-owned filesystem. |
| viewing/versioning | Viewer shell/body/action/comment/split-pane components receive file data and controlled actions. Version manager receives `VersionManagerDependencies` with version data and clipboard ports. HTML viewer receives document/preview inputs and bridge callbacks. |
| selection/workflows | List-detail panel, recurring schedule picker, mention autocomplete, resource board/row list, command palette, tab launcher, revision review, progress card, browser chrome, file dropzone and folder drop each use their exported props/controller types. Catalogs, search, revisions, schedule execution and navigation remain caller data/ports. |
| iframe pooling | `IframeKeepAliveProvider({children, maxMounted?})`, `PooledIframe(props: PooledIframeProps)` and `useIframeKeepAlivePool(): IframeKeepAlivePoolValue`. Pool methods are legacy positional `attach(key, host, create)`, `release(key)`, `evict(key)`, `evictMatching(predicate, options?)`. |
| observability | Legacy `installWebObservability(options = {}): () => void`; individual boot/long-task/resource/visibility/white-screen installers, `trackIframeLoad`, `trackRunStart(runId, options = {})`, `trackRunProgress(runId)`, `trackRunTerminal(runId, terminalState)`. Supply `SafetyEventReporter`; absent reporter is a no-op. The root also exposes the test reset helper. |
| utilities | UUIDs, URL/endpoint policy, notifications/audio, timezone, ZIP, SSE, clipboard, appearance, DOM subscriptions, auto-open-file, localized URLs, markdown scroll sync, polygon selection, wheel tab scrolling, color math, design-markdown parsing and named filesystem errors. Browser-side adapters use the browser capabilities stated by their source types. |

Minimal root wiring:

```tsx
import { I18nProvider, Spinner, TabbedDialog } from '@jini-ai/ui';
import '@jini-ai/ui/tabbed-dialog.css';
<I18nProvider initialLocale="en">
  <TabbedDialog tabs={[{ id: 'overview', label: 'Overview', panel: <Spinner label="Loading" /> }]} />
</I18nProvider>;
```

## Framework-free `/core`

`src/core.ts` explicitly exports the non-React halves of about, appearance, connectors, execution, folder-path-drop, integrations, language, media-providers, memory, notifications, privacy, project-locations, skills and source-config-list, plus tab-selection rules, UUID generation, endpoint policy, icon names and sound catalogs. The root may expose additional helpers from these domains; importing `/core` does not imply importing the root.

| Contract | Current signature / result |
|---|---|
| Endpoint guard | `isAllowedEndpointUrl({raw: string}): boolean`; `isBlockedEndpointHost({hostname: string}): boolean`; `isLoopbackEndpointHost({hostname: string}): boolean` |
| UUID | `randomUUID(): string` |
| Tab lookup | Legacy `findActiveTab(tabs, activeTabId: string|null): T | undefined`, `resolveInitialActiveTabId(tabs, requestedId?: string|null): string|null` |
| Appearance | `normalizeAccentColor({value: unknown}): string | null`, `resolveAccentColor({value: unknown}): string`, `accentVars({accentColor: string}): AccentCssVars`; `THEME_OPTIONS`, `DEFAULT_ACCENT_COLOR`, `ACCENT_SWATCHES` |
| Domain rules | About updater/silent-write state reducers; connector status/auth/tool-preview/search rules; execution provider/model/config rules; folder-drop capture/formatting; MCP install snippet builders; media-provider merging; memory patch/connector/formatter/async-guard rules; privacy transitions; project-location filtering/storage; skill validation/filtering; source draft validation/list updates. Most remain positional; exact declared types are in the individual `rules.ts` files re-exported by `src/core.ts`. |
| Test dependencies | Legacy one-options-object `createFakeExecutionPort`, `createFakeMcpIntegrationsPort`, `createFakeMediaProvidersPort`, `createFakeProjectLocationsPort`, `createFakeSkillsPort`, plus source-config fake factories; returns the matching port. These are in-memory fixtures, not production services. |

Host port contracts retain their current positional methods:

| Port | Required operations and return types |
|---|---|
| `ExecutionPort` | `detectLocalAgents(): Promise<readonly DetectedAgent[]>`, `testConnection(config): Promise<{ok: boolean; message?: string}>`; optional `listModels(config)`, `rescanLocalAgents()`, `testAgent(agentId, model?)` |
| `McpIntegrationsPort` | `fetchInstallInfo(): Promise<McpInstallInfo>`; optional status/install/uninstall methods |
| `ProjectLocationsPort` | `fetchLocations(): Promise<readonly ProjectLocation[]>`, `openFolderDialog(): Promise<string|null>`, `saveLocations(drafts): Promise<readonly ProjectLocation[]>`; optional `scanLocations()` |
| `SkillsPort` | `listSkills()`, `fetchSkillDetail(id)`, `fetchSkillFiles(id)`, `createSkill(payload)`, `updateSkill(id,payload)`, `deleteSkill(id)`; promise results are summaries/detail/files/detail/detail/void |
| `MediaProvidersPort` | `fetchMediaProviders(): Promise<MediaProviderMap|null>`, `saveMediaProviders(providers): Promise<MediaProviderMap>` |
| `ConnectorsPort` | Catalog/status/detail/connect/disconnect/cancel/open URL operations; detail and disconnect/cancel may return null; optional enrichment |
| `SourceConfigPort<T>` | `fetchSources(): Promise<T[]>`, `addSource(input): Promise<AddSourceResult<T>>`, `removeSource(id): Promise<boolean>`; optional refresh/trust/update/test methods |
| Memory ports | Config patches resolve boolean; entries/index and extraction writes return the declared entry/null/boolean outcomes. Connector suggestion transport and pending-auth storage are separate operations. |
| `FolderPathDropPort` | Host supplies synchronous `getPathForFile(file: File): string`; empty string means unresolved. No native filesystem bridge is created by the rules. |

Minimal core wiring: `import { isAllowedEndpointUrl } from '@jini-ai/ui/core'; const accepted = isAllowedEndpointUrl({ raw: 'https://api.example.test' });` Pure rules need no injected transport; invoking a port-backed feature requires the matching host implementation.

## `/admin-widgets`

Components return JSX and take the props in `ui.spec.md`. Public controller hooks and helpers:

```ts
useSelectDropdown({ value, onChange, options, }: { value: string; onChange: (value: string) => void; options: SelectOption[]; }, { disabled }: { disabled?: boolean | undefined } = {}): SelectController
usePanelPosition({ open, triggerRef, panelRef, searchInputRef, showSearch, onOutOfView, }: { open: boolean; triggerRef: React.RefObject<HTMLButtonElement | null>; panelRef: React.RefObject<HTMLDivElement | null>; searchInputRef: React.RefObject<HTMLInputElement | null>; showSearch: boolean; onOutOfView: () => void; }): { position: PanelPosition|null; setPosition }
resolveSelectTriggerLabel({ selectedOption, placeholder }: { selectedOption: SelectOption | null; placeholder: string | undefined }, { t = (key) => key }: { t?: Translate | undefined } = {}): { text: string; className: string }
useInfoTip(): InfoTipController
useSeeMoreClamp({ lines, children }: { lines: number; children: React.ReactNode }): { expanded; setExpanded; overflows; textRef; regionId; lineCount }
resolveSeeMoreView({ expanded, }: { expanded: boolean }, { moreLabel = "See more", lessLabel = "See less", className, textClassName, toggleClassName, }: { moreLabel?: string | undefined; lessLabel?: string | undefined; className?: string | undefined; textClassName?: string | undefined; toggleClassName?: string | undefined; } = {}): SeeMoreView
useImagePreviewModal({ open, onClose }: { open: boolean; onClose: () => void }): ImagePreviewModalController
```

The controller type in the first signature denotes the inferred return, not an additional exported type. All controllers own DOM refs/events; no network port is required. Optional `useDropdown`, `useTip`, `useClamp` and `useModal` props replace controller wiring.

```tsx
import { Select } from '@jini-ai/ui/admin-widgets';
import '@jini-ai/ui/admin-widgets.css';
<Select value="one" onChange={setValue} options={[{ value: 'one', label: 'One' }]} aria-label="Choice" />;
```

## `/panel-kit` and `/fetch-query`

`/panel-kit` re-exports all `/fetch-query` contracts. The required/optional object split below is implemented:

```ts
FetchQueryProvider({ children: ReactNode, environment?: FetchQueryEnvironmentPort }): JSX.Element
useFetchQuery<T>(required: Pick<FetchQueryOptions<T>, "key" | "fetch">, optional: Omit<FetchQueryOptions<T>, "key" | "fetch"> = {}): QueryResult<T>
useFetchMutation<I,O>(required: Pick<FetchMutationOptions<TInput, TOutput>, "run">, optional: Omit<FetchMutationOptions<TInput, TOutput>, "run"> = {}): MutationResult<I,O>
useCachedLoader<T>({ key, fetch }: Pick<CachedLoaderOptions<T>, "key" | "fetch">, { staleTime = DEFAULT_STALE_TIME }: Omit<CachedLoaderOptions<T>, "key" | "fetch"> = {}): CachedLoader<T>
useInvalidate(): (required: { key: QueryKey }) => void
```

`QueryKey = readonly (string | number)[]`. Query result: `{data: T|undefined, error: Error|null, status: 'loading'|'success'|'error', isFetching: boolean, refetch(): void}`. Mutation result: `{mutate({input}): Promise<O>, status: 'idle'|'pending'|'success'|'error', error: Error|null, reset(): void}`. Loader: `{peek(): T|undefined, load(): Promise<T>, replace({value: T}): void}`. Supply fetch/run implementations; the provider owns the cache. `FetchQueryCache` and its clock/scheduler interfaces are internal, not subpath exports. The provider's optional environment port is structurally `{isOnline(): boolean, subscribeOnline({listener: (online:boolean) => void}): () => void, subscribeFocus({listener: () => void}): () => void}`; default adapter uses browser online/offline/focus/visibility. Keep its identity stable to retain the same cache. The named environment interface itself is not re-exported from this entry. `FetchQueryAdapter` describes hook-compatible adapters; the provider has no query-adapter prop.

Additional panel contracts:

```ts
useFocusTrap({ containerRef }: { containerRef: RefObject<HTMLElement | null> }, { active = true }: { active?: boolean | undefined } = {}): void
useDirtyGuard<T>({ current, original }: { current: T; original: T | null }, { translate = (key) => key, host = window }: { translate?: Translate | undefined; host?: DirtyGuardHostPort | undefined } = {}): DirtyGuard
// result: { isDirty: boolean, confirmLeave(required = {}, { unsavedBeyondTracked = false } = {}): boolean }
useAsyncAction(): AsyncActionState
// result: { saving, error: string|null, setError, run({action, describeError}): Promise<void> }
useSerialWrites(): SerialWrites // run<T>({task: () => Promise<T>}, {key?: string}?): Promise<T>
useSettlementGeneration(): SettlementGeneration // next(): number; isCurrent({generation}): boolean
formatTimestamp({ iso }: { iso: string }): string
formatRelativeMinutesAgo({ iso, nowMs }: { iso: string; nowMs: number }, { translate = (key) => key }: { translate?: ((key: string) => string) | undefined } = {}): string
resolveActiveTabId<T extends string>({ tabId, validIds, defaultId }: { tabId: string | null | undefined; validIds: readonly T[]; defaultId: T }): T
hasPermission({ permissions, permission }: { permissions: readonly string[]; permission: string }): boolean
isAbortError({ error }: { error: unknown }): boolean
retryWhileUnreachable<T>({ load, signal, isUnreachable }: { load: () => Promise<T>; signal: AbortSignal; isUnreachable: (error: unknown) => boolean }, { delaysMs = UNREACHABLE_RETRY_DELAYS_MS, wait = ({ ms, signal }) => waitUnlessAborted(ms, signal) }: { delaysMs?: readonly number[]; wait?: (required: { ms: number; signal: AbortSignal }) => Promise<void> } = {}): Promise<T>
createDictionaryTranslator({ featureDictionary }: { featureDictionary: LocaleDictionary }, { commonDictionary = {} }: { commonDictionary?: LocaleDictionary | undefined } = {}): DictionaryTranslator
// returned translator: ({ locale: string, key: string }) => string
interpolate({ template, vars }: { template: string; vars: Record<string, string | number> }): string
splitOnPlaceholders({ template, tokens }: { template: string; tokens: readonly string[] }): string[]
pickPlural({ count, forms }: { count: number; forms: { one: string; other: string } }): string
```

The panel entry also directly re-exports `buildAgentListHandles` from `@jini-ai/agentic`; that dependency owns its contract. `DirtyGuardHostPort` supplies event subscriptions and synchronous confirmation. Retry's `wait({ms,signal})` and failure classifier are caller-injectable; focus trap uses DOM directly.

```tsx
import { FetchQueryProvider, useFetchQuery } from '@jini-ai/ui/fetch-query';
function Rows() {
  const q = useFetchQuery({ key: ['rows'], fetch: loadRows });
  return <pre>{JSON.stringify(q.data)}</pre>;
}
<FetchQueryProvider><Rows /></FetchQueryProvider>;
```

For `/panel-kit`: `import { hasPermission } from '@jini-ai/ui/panel-kit'; hasPermission({ permissions: ['read'], permission: 'read' });`

## `/theme`

```ts
validateAdminTheme({ theme }: { readonly theme: unknown }): { valid: true; theme: AdminTheme } | { valid: false; errors: readonly string[] }
applyAdminTheme({ theme }: { readonly theme: AdminTheme }, { target, document }: { readonly target: AdminThemeTarget; readonly document: AdminThemeDocument }): () => void
resolveColorScheme({ preference }: { readonly preference: ColorSchemePreference }, { matchMedia }: { readonly matchMedia?: MatchMediaPort } = {}): 'light'|'dark'
```

`applyAdminTheme` requires its second object; it has no default DOM target. `AdminTheme` has name, body/heading font stacks, optional mono/font stylesheet URLs, full light/dark palettes, optional radius and density. Public type exports include the palette, target/document, schemes and media port. `defaultAdminTheme` is frozen neutral data. `renderAdminThemeVariables` is internal and not exported here.

```ts
import { applyAdminTheme, defaultAdminTheme, resolveColorScheme } from '@jini-ai/ui/theme';
import '@jini-ai/ui/styles/variables.css';
const target = document.documentElement;
const undo = applyAdminTheme({ theme: defaultAdminTheme }, { target, document });
target.setAttribute('data-color-scheme', resolveColorScheme({ preference: 'light' }));
// Call undo() when the theme owner leaves its scope.
```

## `/sketch-editor`

`SketchEditor(props: SketchEditorProps): JSX.Element` requires `{scene, onSceneChange, onSave, fileName}`. `SketchScene` holds elements, app state and binary files. Optional clear/export/open-export callbacks, save/dirty/saved-at state, locale mapper, DOM text/tooltip/menu overrides and `dependencies: {engine: SketchEditorEnginePort}` customize the editor. The engine port supplies Excalidraw, its composable MainMenu and `exportToBlob(opts): Promise<Blob>`; default dependencies bind the real peer. Also exported: fake dependencies/engine, theme/scene/save/DOM hooks, `SketchMainMenu`, `SketchSaveStateBadge`, constants, scene/rule and DOM enhancement helpers. These older helpers use their declared positional or one-options-object signatures; no host save endpoint is built in.

```tsx
import { SketchEditor } from '@jini-ai/ui/sketch-editor';
<SketchEditor scene={scene} onSceneChange={setScene} onSave={saveScene} fileName="drawing" />;
```

## `/lexical-rich-text-editor`

`RichTextInput` is `forwardRef<RichTextInputHandle, RichTextInputProps>` with required `{placeholder, value, knownMentions, onChange(text,mentions), onTriggerChange(match|null), onSubmit(), popoverOpen, onPopoverKey(key): boolean}`. Optional pasted-files callback, combobox state/listbox id, title/test id/namespace, trigger list/id and mention-color resolver. `RichTextInputHandle` exposes `getText`, positional `setText`, `insertText`, `insertMention`, `replaceActiveTrigger`, and no-arg clear/focus.

Public helpers include legacy `buildMentionToken(label): string`, `parseMentionParts(text, knownMentions, {highlightUnknown = true} = {}): MentionPart[]|null`, mention boundary/presence/folding predicates, `MentionNode` and its create/type guard helpers, `serializeRichText(state): SerializedRichText`, `setRichTextFromPlainText(editor,text,knownMentions): void`, trigger detection/deletion/match rules, `readCaretRect(rootEl): CaretRect|null`, caret positioning, `CaretFloatingLayer`, and mention-color/caret-position hooks. Supply installed Lexical peers and host mention data/callbacks; no registry/network port is created.

```tsx
import { RichTextInput } from '@jini-ai/ui/lexical-rich-text-editor';
<RichTextInput placeholder="Write" value={text} knownMentions={[]}
  onChange={setTextAndMentions} onTriggerChange={setTrigger} onSubmit={submit}
  popoverOpen={false} onPopoverKey={() => false} />;
```

## `/html-editor`

`InteractiveHtmlEditor` is `forwardRef<InteractiveHtmlEditorHandle, InteractiveHtmlEditorProps>`. Required `{html: string, onChange(html): void}`; optional className, protected-element predicate, canvasStyling and embed-placeholder descriptor callback. Handle `flush(): Promise<string|undefined>`. Legacy hook `useInteractiveHtmlEditor(html,onChange,isProtectedElement?,canvasStyling = {},describeEmbedPlaceholder?): {containerRef,flush}`. Also exported `hasAttributeOnAnyNodeShape(...)` and `prettifyCss(css): string`, plus canvas wrapper/styling/placeholder types. Supply GrapesJS and host persistence; protection/styling/initial HTML are mount-time inputs.

```tsx
import { InteractiveHtmlEditor } from '@jini-ai/ui/html-editor';
<InteractiveHtmlEditor html="<p>Hello</p>" onChange={saveDraft} />;
```

## `/mcp-ui/surfaces`

The entry re-exports protocol vocabulary from `@jini-ai/agentic`, `MCP_UI_VIEW_SANDBOX`, protocol version, resource MIME/meta constants and the complete bridge/field/token/document surface vocabulary.

```ts
createConfirmationStore(deps: ConfirmationStoreDeps = {}): ConfirmationStore
// deps: now?, randomToken?, ttlMs?, digestToken?
// mint({binding: Record<string,string|number>,summary}): {token,expiresAtMs}
// redeem({token,binding}): RedeemResult; size(): number
createEarlyMessageBuffer(maxBuffered: number = MAX_BUFFERED_MESSAGES): EarlyMessageBuffer
// push(message): void; subscribe(handler): () => void; readonly backlogSize: number
createUIResource(spec: { uri: UIResourceUri; htmlString: string; preferredFrameSize?: readonly [string, string]; actionPlan?: McpUiActionPlan; meta?: Readonly<Record<string, unknown>>; }): UIResource
buildUIToolResult(spec: { modelText: string; ui: UIResource; meta?: Readonly<Record<string, unknown>>; }): UIToolResult
parseUIResource(value: unknown): UIResource | undefined
readPreferredFrameSize(resource: UIResource): readonly [string,string] | undefined
readActionPlan(resource: UIResource): McpUiActionPlan | undefined
escapeHtml(value: string): string
escapeJsValue(value: unknown): string
escapeJsString(value: string): string
renderConfirmationDocument(spec: ConfirmationSurfaceSpec): string
buildConfirmationSurface(spec: ConfirmationSurfaceSpec & { uri: UIResourceUri; preferredFrameSize?: readonly [string, string]; }): UIResource
renderFormDocument(spec: FormSurfaceSpec): string
buildFormSurface(spec: FormSurfaceSpec & { uri: UIResourceUri; preferredFrameSize?: readonly [string, string] }): UIResource
renderOutcomeDocument(spec: SurfaceOutcomeSpec): string
buildOutcomeSurface(spec: SurfaceOutcomeSpec & { uri: UIResourceUri; preferredFrameSize?: readonly [string, string] }): UIResource
renderSurfaceDocument(spec: SurfaceDocumentSpec): string
renderTextInput(props: TextInputProps): string
renderCheckbox(props: CheckboxProps): string
renderSelect(props: SelectProps): string
renderChoiceGroup(props: ChoiceGroupProps): string
renderFieldControl(field: SurfaceField): string
toFieldReadSpecs(fields: readonly SurfaceField[]): readonly FieldReadSpec[]
renderSurfaceHeader(spec: { title: string; description?: string }): string
renderDetailList(details: readonly SurfaceDetail[]): string
renderStatusRegion(): string
fieldElementId(name: string): string
renderFieldLabel(spec: { name: string; label: string; required?: boolean; hint?: string; }): string
fieldDescribedBy(spec: { name: string; hint?: string }): string
renderActions(actions: readonly SurfaceAction[]): string
renderBridgeScript(spec: BridgeScriptSpec): string
renderTokenBlock(overrides: Partial<Record<SurfaceTokenName, string>> = {}): string
buildIsolatedSandboxProxyHtml(hostOrigin: string): string
buildSandboxProxyDataUrl(hostOrigin: string): string
```

`SANDBOX_PROXY_HTML` is a static HTML page for a host-served proxy. Bridge-script builders and handshake constants are exported alongside the renderers. Spec interfaces carry caller-owned tool names/params/status copy/app metadata; confirmation requires title and confirm action, form requires title/fields/submitLabel/toolName, outcome requires title/state/message. These APIs remain one spec object or positional; they have not adopted two objects. No service port is needed to build strings. A consumer redeems tokens and executes tools separately.

```ts
import { createConfirmationStore, buildConfirmationSurface } from '@jini-ai/ui/mcp-ui/surfaces';
const store = createConfirmationStore();
const { token } = store.mint({ binding: { operation: 'remove', item: '42' }, summary: 'Remove item' });
const ui = buildConfirmationSurface({ uri: 'ui://confirmation/42', title: 'Remove item?',
  confirm: { label: 'Remove', toolName: 'remove_item', params: { token } } });
```

## `/mcp-ui`

`McpUiHost(props: McpUiHostProps): JSX.Element` requires `{html, sandboxProxyUrl: URL, title: string}`; legacy `useMcpUiHost(options: McpUiHostOptions): McpUiHostResult` requires `{html, sandboxProxyUrl: URL}`. Optional toolName/sessionKey, tool executor, open-link/size/event callbacks, host info/context and initialized timeout. Component-only options include className, initialHeight (220), autoResize (true) and maxHeight (720); reported height is clamped to at least 1 and the ceiling. Result `{state,size,requestTeardown,teardownAcknowledged,rendererProps,rendererRef}`; `rendererProps`/ref wire `@mcp-ui/client`'s AppRenderer. Tool handler `(call: {name,arguments}) => unknown | Promise<unknown>` is host-supplied. This subpath also exports the legacy early host-message-source subscribe/backlog interfaces and all surface builders; the current AppRenderer host does not consume that message source.

```tsx
import { McpUiHost } from '@jini-ai/ui/mcp-ui';
<McpUiHost title="Confirmation" html={ui.resource.text} sandboxProxyUrl={new URL('/sandbox-proxy.html', location.href)}
  onToolCall={executeAllowedTool} />;
```

Serve the matching proxy HTML or use the exported isolated-proxy/data-URL builder. Tool authorization and outbound link policy belong in callbacks.

## `/interactive-ui` and `/interactive-ui/manifests`

```ts
new InteractiveUiRegistry({ entries: readonly InteractiveComponentEntry[] })
registry.list(): readonly InteractiveComponentEntry[]
registry.resolveById({ id: string }): InteractiveComponentEntry | null
registry.resolveByCapability({ capability: string }): readonly InteractiveComponentEntry[]
registry.register({ entry }): InteractiveUiRegistry
```

Entries contain manifest `{id, provider, capabilities, propsSchema, description?}` and React `Component`. Exports include `DEFAULT_INTERACTIVE_UI_REGISTRY`, `NativeDataTable`, `ShadcnDataTable`, `ActionButton`, `CheckboxField`, `RadioGroupField`, `TextInputField`, `SelectField`, `ContentCard`, `BarChart`, `LineChart`, `PieChart`, and each provider's manifest and Zod schema. `/interactive-ui/manifests` exports only manifest/schema pairs, the manifest type and `ALL_MANIFESTS`; it cannot construct a React registry. Consumers validate wire props with the chosen schema before direct component rendering.

```tsx
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import '@jini-ai/ui/interactive-ui.css';
const entry = DEFAULT_INTERACTIVE_UI_REGISTRY.resolveById({ id: 'shadcn.button' })!;
const props = entry.propsSchema.parse({ label: 'Continue' });
const Widget = entry.Component;
<Widget {...props} />;
```

Headless wiring: `import { ALL_MANIFESTS } from '@jini-ai/ui/interactive-ui/manifests'; const ids = ALL_MANIFESTS.map(m => m.id);` No host port is required; register custom React implementations through a new registry.

## `/a2ui`

```ts
createLabCatalog(required: {}, optional = {}): Catalog // re-export from @jini-ai/agentic/a2ui
createA2uiInterpreter({ catalog, clock, ids }, optional = {}): A2uiInterpreter
// clock: core Clock with nowMs(): number; ids.next({}): string
buildA2uiCatalogFromRegistry({ registry, catalogId }: { registry: Pick<InteractiveUiRegistry, 'list'>; catalogId: string }, options: BuildA2uiCatalogFromRegistryOptions = {}): Catalog
useA2uiSurfaceRoot({ interpreter, surfaceId }: { interpreter: A2uiInterpreter; surfaceId: string }): ComponentInstance | undefined
A2uiSurfaceRenderer({ interpreter, surfaceId, registry, fallback? }): ReactNode
```

Interpreter methods: `applyAgentMessage({raw}): ApplyMessageResult`, `getSurface({surfaceId}): SurfaceSnapshot|undefined`, `listSurfaceIds({}): string[]`, `getRoot({surfaceId}): ComponentInstance|undefined`, `buildAction({surfaceId,componentId},{now?} = {}): BuildActionResult`, `resolve({surfaceId,value},{itemBasePath?,itemIndex?} = {}): resolution result`, `subscribe({listener}): (required: {}) => void`. Apply results contain outgoing renderer messages and optional unattributed violation; action results discriminate agent/local success or `{ok:false,reason}`. Catalog/interpreter/component/snapshot and id types are direct dependency re-exports. Clock is imported from `@jini-ai/core/primitives`; the obsolete `A2uiClockPort` type is no longer re-exported by UI.

```tsx
import { createLabCatalog, createA2uiInterpreter, buildA2uiCatalogFromRegistry, A2uiSurfaceRenderer } from '@jini-ai/ui/a2ui';
import { DEFAULT_INTERACTIVE_UI_REGISTRY as registry } from '@jini-ai/ui/interactive-ui';
const base = createLabCatalog({});
const catalog = buildA2uiCatalogFromRegistry({ registry, catalogId: base.catalogId }, { base });
const interpreter = createA2uiInterpreter({ catalog, clock: { nowMs: () => Date.now() }, ids: { next: () => crypto.randomUUID() } });
// The host applies received messages and sends their returned rendererMessages.
<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="surface" registry={registry} />;
```

## `/renderers`

```ts
new RendererRegistry({ renderers: readonly ArtifactRenderer[] })
registry.list(): readonly ArtifactRenderer[]
registry.resolve({ file: ArtifactFile }, { hints? } = {}): ArtifactRenderMatch | null
registry.register({ renderer }): RendererRegistry
resolveArtifactManifest({ file }: { file: ArtifactFile }): ArtifactManifest | null
createDefaultRendererRegistry(): RendererRegistry
buildSrcDoc(html: string, options: BuildSrcDocOptions = {}): string
buildLazySrcDocTransport(): string
canActivateSrcDocTransport(state: SrcDocActivationInputs): boolean
sanitizePreviewTitle(text: string): string
sanitizeTitleInDoc(html: string): string
highlightCode(code: string, lang: string): Promise<string>
ArtifactView(props: ArtifactViewProps): ReactNode
SrcDocSandbox(props: SrcDocSandboxProps): JSX.Element
```

Default registry contains Html/Markdown/Svg/ReactComponent renderers. Renderer port `{id,supportsStreaming,renderPartial?,canRender({file},{hints?}):boolean}` supplies detection; custom output is an `ArtifactViewSlots.renderers` callback. Public utility families include safe markdown rendering, URL-load/focus/shim decisions, ordered `SrcDocBridge` injection, head/body insertion (including `StringOnly` variants), document/base/storage/focus helpers, `buildSandboxedDocument`, sandbox bridge hooks, sandboxed new-tab preview, annotation canvas and preview-modal shell. Older document helpers remain positional, returning strings or their declared document result; browser launch helpers return their declared popup result. No backend port is required for registry matching; consumers supply file manifests, content and any custom bridge/slots.

The renderer subpath has its own `I18nProvider({dictionary?,children})`, `useI18n(): {t}`, `useT(): translator`; it is distinct from the root locale provider.

```tsx
import { ArtifactView, createDefaultRendererRegistry } from '@jini-ai/ui/renderers';
<ArtifactView file={fileWithManifest} registry={createDefaultRendererRegistry()} />;
```

## Stylesheet entry wiring

CSS entries expose assets, not callable functions or return values. A consumer's bundler/stylesheet loader is the dependency. Import only the styles for the mounted surfaces; importing JS does not replace these CSS imports.

```ts
import '@jini-ai/ui/styles/variables.css';
import '@jini-ai/ui/styles/admin.css';
import '@jini-ai/ui/admin-widgets.css';
import '@jini-ai/ui/interactive-ui.css';
import '@jini-ai/ui/settings-dialog.css';
import '@jini-ai/ui/tabbed-dialog.css';
import '@jini-ai/ui/remixicon.css';
```

`/styles/*` only resolves assets that exist in the published `dist/styles/`; it does not promise arbitrary stylesheet names. Keep the icon font's relative asset reachable. No JavaScript export entry is missing a current source target; packaged asset existence has not been verified by building or inspecting a new package archive.

## Browser effects and style assets

`createMemoryHttpPorts({}, {fetch?: typeof globalThis.fetch} = {})` returns config/entries/extractions REST ports. Each request uses the selected native fetch and composes its deadline with caller cancellation; defaults remain browser-owned. `useBrandFonts({fonts}, options = {})` accepts document, projectId, resolveProjectAssetUrl, fetch and a BrandFontManifestPort with load({url}); a supplied manifest replaces default fetching. ExportDiagnosticsButton accepts an injected fetch dependency through its props. Browser requestWithTimeout is an internal helper, not a platform FetchTimeoutError-producing API.

`./styles/*` exports the static CSS files under styles, currently `variables.css` and `admin.css`. This replaces a separate tokens package; consumers import CSS from `@jini-ai/ui/styles/<filename>.css`. Existing interactive/dialog/widget/theme contracts remain separate exports.

## Supplementary public contracts

These names are also reachable through the current export map. Parameter declarations below preserve source defaults, destructuring and collaborator types; linked declarations define result and DTO details. They do not add runtime validation beyond the behavior and error contracts. Types erase at runtime.

| Function and declared parameters | Declaration |
|---|---|
| `$createMentionNode(p: MentionPayload)` | [mention-node.ts](../../src/features/lexical-rich-text-editor/mention-node.ts) |
| `$isMentionNode(n: LexicalNode \| null \| undefined)` | [mention-node.ts](../../src/features/lexical-rich-text-editor/mention-node.ts) |
| `AboutTab({ appVersionInfo, updaterModel, onPerformUpdateAction, onOpenReleaseLink, allowSilentUpdates = false, onSilentUpdatePreferenceChange, labels, }: AboutTabProps)` | [AboutTab.tsx](../../src/features/about/react/components/AboutTab.tsx) |
| `AgentCliEnvFields({ agentId, fields, config, onChange }: AgentCliEnvFieldsProps)` | [AgentCliEnvFields.tsx](../../src/features/execution/react/components/AgentCliEnvFields.tsx) |
| `AgentDiagnosticRow({ diagnostic, handlers = {}, className }: AgentDiagnosticRowProps)` | [AgentDiagnosticRow.tsx](../../src/features/execution/react/components/AgentDiagnosticRow.tsx) |
| `AnnotationCanvas(props: AnnotationCanvasProps)` | [AnnotationCanvas.tsx](../../src/renderers/annotation-canvas/react/components/AnnotationCanvas.tsx) |
| `AppearanceTab({ theme, onThemeChange, accentColor, onAccentColorChange, accentSwatches = ACCENT_SWATCHES, livePreview = true, ariaLabel, accentLabel, defaultAccentAriaLabel, customAccentAriaLabel, agentHandle, }: AppearanceTabProps)` | [AppearanceTab.tsx](../../src/features/appearance/react/components/AppearanceTab.tsx) |
| `AssetCard({ asset, index, selected, title, subtitle, kindLabel, sourceLabel, renderThumbnail, renderThumbnailPlaceholder, onToggle, onRange, onPreview, onDeleteAsset, renderCardExtra, }: AssetCardProps<TAsset>)` | [AssetCard.tsx](../../src/features/asset-grid/react/components/AssetCard.tsx) |
| `AssetGrid({ active = true, selectors, dependencies, kindFacets = [], sourceFacets = [], renderThumbnail, renderThumbnailPlaceholder, renderCardExtra, renderBulkActions, onDeleteAsset, onDeleteSelected, onPreview, isPreviewOpen = false, toolbarActions, emptyState, searchPlaceholder, searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS, liveUpdateCoalesceMs, initialViewMode = 'grid', useWiredAssetGridData: useWiredAssetGridDataHook = useWiredAssetGridData, useAssetGridSelection: useAssetGridSelectionHook = useAssetGridSelection, }: AssetGridProps<TAsset>)` | [AssetGrid.tsx](../../src/features/asset-grid/react/components/AssetGrid.tsx) |
| `AssetGridBody({ viewMode, assets, getDayKey, containerRef, onMouseDown, selecting, renderCard, }: AssetGridBodyProps<TAsset>)` | [AssetGridBody.tsx](../../src/features/asset-grid/react/components/AssetGridBody.tsx) |
| `AssetGridToolbar({ search, onSearchChange, searchPlaceholder, kind, onKindChange, kindFacets, kindFacetsLabel, source, onSourceChange, sourceFacets, sourceFacetsLabel, viewMode, onViewModeChange, onRefresh, loading, toolbarActions, }: AssetGridToolbarProps)` | [AssetGridToolbar.tsx](../../src/features/asset-grid/react/components/AssetGridToolbar.tsx) |
| `AssetTreeBreadcrumbs({ currentDir, rootLabel, onNavigate }: AssetTreeBreadcrumbsProps)` | [AssetTreeBreadcrumbs.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeBreadcrumbs.tsx) |
| `AssetTreeBrowser({ files, folders, selectors, kindConfig = DEFAULT_KIND_CONFIG_MAP, sectionOrder = DEFAULT_SECTION_ORDER, dependencies, rootLabel, reloading = false, navState, onNavStateChange, onSelectionChange, onOpenFile, onRenameFile, onDeleteFile, onDeleteFiles, onUploadFiles, getFileUrl, downloadFiles, selectInitialPreviewFile, renderPreviewThumbnail, thumbnailIsInteractive = false, toolbarActions = EMPTY_TOOLBAR_ACTIONS, emptyStateActions = EMPTY_TOOLBAR_ACTIONS, footer, useAssetTreeNavigation: useAssetTreeNavigationHook = useAssetTreeNavigation, useAssetTreePreview: useAssetTreePreviewHook = useAssetTreePreview, useAssetTreeRename: useAssetTreeRenameHook = useAssetTreeRename, useAssetTreeSelection: useAssetTreeSelectionHook = useAssetTreeSelection, }: AssetTreeBrowserProps<TFile>)` | [AssetTreeBrowser.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeBrowser.tsx) |
| `AssetTreeEmptyState({ actions = [] }: AssetTreeEmptyStateProps)` | [AssetTreeEmptyState.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeEmptyState.tsx) |
| `AssetTreeFileRow({ path, displayName, active, selected, kindLabel, kindGlyph, size, modifiedAt, renaming, onSelectPreview, onOpen, onToggleSelect, onOpenMenu, onRenameDraftChange, onCommitRename, onCancelRename, }: AssetTreeFileRowProps)` | [AssetTreeFileRow.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeFileRow.tsx) |
| `AssetTreeFolderRow({ name, path, fileCount, onNavigate }: AssetTreeFolderRowProps)` | [AssetTreeFolderRow.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeFolderRow.tsx) |
| `AssetTreeRowMenu({ path, displayName, top, left, containerRef, canCopyLocalPath, copied, download, onOpen, onRename, onCopyLocalPath, onDelete, }: AssetTreeRowMenuProps)` | [AssetTreeRowMenu.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeRowMenu.tsx) |
| `AssetTreeSelectionBar({ count, onClear, onDelete, deleting, onDownload, downloading = false, downloadError = null, }: AssetTreeSelectionBarProps)` | [AssetTreeSelectionBar.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeSelectionBar.tsx) |
| `AssetTreeToolbar({ actions }: AssetTreeToolbarProps)` | [AssetTreeToolbar.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeToolbar.tsx) |
| `AssetTreeUploadErrorBanner({ message, onDismiss }: AssetTreeUploadErrorBannerProps)` | [AssetTreeUploadErrorBanner.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeUploadErrorBanner.tsx) |
| `AudioViewerBody({ src, label }: AudioViewerBodyProps)` | [AudioViewerBody.tsx](../../src/features/viewer-shell/react/components/AudioViewerBody.tsx) |
| `BrowserViewportControls({ viewport, onViewport, disabled, presets = BROWSER_VIEWPORT_PRESETS, }: BrowserViewportControlsProps)` | [BrowserViewportControls.tsx](../../src/features/browser-chrome/react/components/BrowserViewportControls.tsx) |
| `ByokProviderForm({ config, onConfigChange, preset, presets = DEFAULT_PROVIDER_PRESETS, modelDiscovery, connectionTest, onTestConnection, canTestConnection = true, apiKeyFooter, formFooter, apiKeyStoredExternally = false, apiKeyPlaceholder, agentHandle, }: ByokProviderFormProps)` | [ByokProviderForm.tsx](../../src/features/execution/react/components/ByokProviderForm.tsx) |
| `ClientPicker({ clients, selectedClientId, onSelect, methodLabel, methodLabels, agentHandle }: ClientPickerProps)` | [ClientPicker.tsx](../../src/features/integrations/react/components/ClientPicker.tsx) |
| `CodeWithLines({ text }: CodeWithLinesProps)` | [CodeWithLines.tsx](../../src/features/viewer-shell/react/components/CodeWithLines.tsx) |
| `CodexInstallToggleButton({ port, agentHandle }: CodexInstallToggleButtonProps)` | [CodexInstallToggleButton.tsx](../../src/features/integrations/react/components/CodexInstallToggleButton.tsx) |
| `ComingSoonNotice({ kicker, label, description, note, agentHandle }: ComingSoonNoticeProps)` | [ComingSoonNotice.tsx](../../src/features/admin-widgets/components/ComingSoonNotice.tsx) |
| `ComingSoonPanel({ label, note, children }: ComingSoonPanelProps)` | [ComingSoonPanel.tsx](../../src/features/admin-widgets/components/ComingSoonPanel.tsx) |
| `CommandPalette({ items, onSelect, onClose, scopeKey, placeholder, useWiredCommandPalette: useWiredCommandPaletteHook = useWiredCommandPalette, }: CommandPaletteProps)` | [CommandPalette.tsx](../../src/features/command-palette/react/components/CommandPalette.tsx) |
| `CommandPaletteRow({ result, index, active, onHover, onSelect }: CommandPaletteRowProps)` | [CommandPaletteRow.tsx](../../src/features/command-palette/react/components/CommandPaletteRow.tsx) |
| `CommentSideDock(props: CommentSideDockProps<TComment>)` | [CommentSideDock.tsx](../../src/features/viewer-shell/react/components/CommentSideDock.tsx) |
| `CommentSidePanel({ comments, selectedIds, activeCommentId, collapsed, onCollapsedChange, onToggleSelect, onSelectAll, onClearSelection, onReorder, onReply, onSendSelected, onCreateComment, sending, queueOnSend = false, sendDisabled = false, renderCreateForm = true, composer, getCommentLabel, getCommentTimestamp, getCommentBody, getCommentAttachments, resolveAttachmentUrl, formatTimestamp, useCommentReorder: useCommentReorderHook = useCommentReorder, }: CommentSidePanelProps<TComment>)` | [CommentSidePanel.tsx](../../src/features/viewer-shell/react/components/CommentSidePanel.tsx) |
| `ConnectorAlertList({ alerts, onOpenDetails, openDetailsAriaLabel }: ConnectorAlertListProps)` | [ConnectorAlertList.tsx](../../src/features/connectors/components/ConnectorAlertList.tsx) |
| `ConnectorCard({ connector, disabled = false, pendingAction, authorizationPending, authorizationCancelFailed, toolsLoaded, onConnect, onDisconnect, onCancelAuthorization, onOpenDetails, getCategoryLabel = (category) => category, cancelFailedMessage, continueInBrowserLabel, onOpenExternalUrl, agentHandle, }: ConnectorCardProps)` | [ConnectorCard.tsx](../../src/features/connectors/components/ConnectorCard.tsx) |
| `ConnectorDetailDrawer({ connector, disabled, pendingAction, authorizationPending, authorizationCancelFailed, authorizationError, toolsPreviewLoading, toolsLoaded, onClose, onConnect, onDisconnect, onCancelAuthorization, onLoadMoreTools, onOpenExternalUrl, getCategoryLabel = (category) => category, getDisplayableAccountLabel = getDisplayableConnectorAccountLabel, cancelFailedMessage, continueInBrowserLabel, agentHandle, }: ConnectorDetailDrawerProps)` | [ConnectorDetailDrawer.tsx](../../src/features/connectors/components/ConnectorDetailDrawer.tsx) |
| `ConnectorGate({ title, body, ctaLabel, ctaHref, onClick }: ConnectorGateProps)` | [ConnectorGate.tsx](../../src/features/connectors/components/ConnectorGate.tsx) |
| `ConnectorGrid({ connectors, locked, hasNoResults, searchQuery, pendingConnectorAction, authorizationPending, authorizationCancelFailed, toolsLoaded, onConnect, onDisconnect, onCancelAuthorization, onOpenDetails, onOpenExternalUrl, getCategoryLabel, onClearSearch, gate, emptyNoMatchTitle, emptyNoMatchBody, emptyNoMatchAction, agentHandle, }: ConnectorGridProps)` | [ConnectorGrid.tsx](../../src/features/connectors/components/ConnectorGrid.tsx) |
| `ConnectorLogo({ connectorId, connectorName, logoUrl, size = 'sm' }: ConnectorLogoProps)` | [ConnectorLogo.tsx](../../src/features/connectors/components/ConnectorLogo.tsx) |
| `ConnectorSearchBar({ value, onChange, disabled = false, onFocus, placeholder, ariaLabel, clearAriaLabel, agentHandle, }: ConnectorSearchBarProps)` | [ConnectorSearchBar.tsx](../../src/features/connectors/components/ConnectorSearchBar.tsx) |
| `CustomSelectOptionButton({ option, selected, active, id, onChoose, onActive, }: { option: CustomSelectOption; selected: boolean; active: boolean; id: string \| undefined; onChoose: (value: string) => void; onActive: (value: string) => void; })` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `DeckNavigationControls({ canGoPrev, canGoNext, counterLabel, onPrev, onNext, }: DeckNavigationControlsProps)` | [DeckNavigationControls.tsx](../../src/features/html-viewer/react/components/DeckNavigationControls.tsx) |
| `DeleteConfirmDialog({ count, onCancel, onConfirm }: DeleteConfirmDialogProps)` | [DeleteConfirmDialog.tsx](../../src/features/asset-grid/react/components/DeleteConfirmDialog.tsx) |
| `ExecutionTab({ config, onConfigChange, port, presets = DEFAULT_PROVIDER_PRESETS, cliEnvFields = DEFAULT_AGENT_CLI_ENV_FIELDS, localCliUnavailableReason, renderAgentIcon, localCliScopeLabel, autoDetect = true, ariaLabel, apiKeyFooter, formFooter, apiKeyStoredExternally, apiKeyPlaceholder, canDiscoverModels = true, describeProbeError, agentHandle, }: ExecutionTabProps)` | [ExecutionTab.tsx](../../src/features/execution/react/components/ExecutionTab.tsx) |
| `FileDropzone({ label, prompt, helper, accept, directory = false, enablePaste = false, files, onRemove, names, onRemoveName, onFiles, onZoneClick, onError, onProcessingStart, onBrowseFolder, secondaryAction, useFileDropzone: useFileDropzoneHook = useFileDropzone, useFileDropzonePreviews: useFileDropzonePreviewsHook = useFileDropzonePreviews, }: FileDropzoneProps)` | [FileDropzone.tsx](../../src/features/file-dropzone/react/components/FileDropzone.tsx) |
| `FileDropzoneLightbox({ file, previews, onClose }: FileDropzoneLightboxProps)` | [FileDropzoneLightbox.tsx](../../src/features/file-dropzone/react/components/FileDropzoneLightbox.tsx) |
| `FileDropzoneNameList({ names, onRemoveName, ariaLabel }: FileDropzoneNameListProps)` | [FileDropzoneNameList.tsx](../../src/features/file-dropzone/react/components/FileDropzoneNameList.tsx) |
| `FileDropzoneThumbnailGrid({ files, previews, onSelect, onRemove }: FileDropzoneThumbnailGridProps)` | [FileDropzoneThumbnailGrid.tsx](../../src/features/file-dropzone/react/components/FileDropzoneThumbnailGrid.tsx) |
| `FilePreviewPane({ file, path, kindLabel, kindGlyph, size, modifiedAt, onOpen, onClose, downloadHref, renderThumbnail, thumbnailIsInteractive = false, }: FilePreviewPaneProps<TFile>)` | [FilePreviewPane.tsx](../../src/features/asset-tree-browser/react/components/FilePreviewPane.tsx) |
| `ImagePreviewModal({ open, src, alt, onClose, useModal = useImagePreviewModal, agentHandle: handle, closeLabel = "Close preview", }: ImagePreviewModalProps)` | [ImagePreviewModal.tsx](../../src/features/admin-widgets/components/ImagePreviewModal.tsx) |
| `ImageViewerBody({ src, alt }: ImageViewerBodyProps)` | [ImageViewerBody.tsx](../../src/features/viewer-shell/react/components/ImageViewerBody.tsx) |
| `InfoTip({ label, useTip = useInfoTip, agentHandle: handle }: InfoTipProps)` | [InfoTip.tsx](../../src/features/admin-widgets/components/InfoTip.tsx) |
| `InstructionsTab({ value, onChange, title, description, placeholder, rows = 5, maxLength = 5000, agentHandle, }: InstructionsTabProps)` | [InstructionsTab.tsx](../../src/features/instructions/react/components/InstructionsTab.tsx) |
| `IntegrationsTab({ serverName = DEFAULT_MCP_SERVER_NAME, clients = MCP_CLIENTS, initialClientId = DEFAULT_MCP_CLIENT_ID, port, capabilitiesTitle, capabilities, agentHandle, }: IntegrationsTabProps)` | [IntegrationsTab.tsx](../../src/features/integrations/react/components/IntegrationsTab.tsx) |
| `JsonPanel({ value, emptyLabel }: JsonPanelProps)` | [JsonPanel.tsx](../../src/features/viewer-shell/react/components/JsonPanel.tsx) |
| `LanguageTab({ locales, selectedLocale, onSelectLocale, ariaLabel, agentHandle }: LanguageTabProps)` | [LanguageTab.tsx](../../src/features/language/react/components/LanguageTab.tsx) |
| `ListDetailPanel({ items, selectedId, onSelect, renderItem, renderDetail, getItemAriaLabel, header, emptyListContent, emptyDetailContent, loading = false, loadingSidebarContent, loadingDetailContent, className, sidebarClassName, listClassName, detailClassName, itemClassName, 'data-testid': testId = 'list-detail-panel', }: ListDetailPanelProps<TItem>)` | [ListDetailPanel.tsx](../../src/features/list-detail-panel/react/components/ListDetailPanel.tsx) |
| `LocalCliAgentCard({ agent, config, selected, onSelect, onModelChange, onReasoningChange, onEnvChange, cliEnvFields, renderIcon, onTest, agentTest, onRescan, agentHandle, }: LocalCliAgentCardProps)` | [LocalCliAgentCard.tsx](../../src/features/execution/react/components/LocalCliAgentCard.tsx) |
| `LocalCliAgentList({ agents, config, scan, onSelect, onModelChange, onReasoningChange, onEnvChange, cliEnvFields, onRescan, onTest, agentTest, renderAgentIcon, scopeLabel, agentHandle, }: LocalCliAgentListProps)` | [LocalCliAgentList.tsx](../../src/features/execution/react/components/LocalCliAgentList.tsx) |
| `MarkdownSplitPane({ mode, onModeChange, sourceText, onSourceChange, previewHtml, previewSelector, loading = false, loadingLabel, sourceLabel, splitLabel, previewLabel, editorAriaLabel, previewAriaLabel, modeAriaLabel, toolbarLeftExtra, toolbarActions, editorTextareaProps, onPreviewClick, }: MarkdownSplitPaneProps)` | [MarkdownSplitPane.tsx](../../src/features/viewer-shell/react/components/MarkdownSplitPane.tsx) |
| `MediaProvidersTab({ port, catalog = DEFAULT_MEDIA_PROVIDER_CATALOG, initialProviders, pinnedProviderIds, labels, agentHandle, }: MediaProvidersTabProps)` | [MediaProvidersTab.tsx](../../src/features/media-providers/react/components/MediaProvidersTab.tsx) |
| `MemoryAdvancedModal({ open, modalHost, onClose, index, indexDraft, onIndexDraftChange, onSaveIndex, busy, memoryTree, treeFolders, treeChildren, onStartEdit, }: { open: boolean; modalHost: HTMLElement \| null; onClose: () => void; index: string; indexDraft: string \| null; onIndexDraftChange: (value: string \| null) => void; onSaveIndex: () => void; busy: boolean; memoryTree: MemoryTreeNode[]; treeFolders: MemoryTreeNode[]; treeChildren: Map<string, MemoryTreeNode[]>; onStartEdit: (id: string) => void; })` | [MemoryAdvancedModal.tsx](../../src/features/memory/react/components/MemoryAdvancedModal.tsx) |
| `MemoryConnectedPanel({ enabled, onOpenConnectors, connectorStatuses, connectorsLoading, connectedCount, selectedConnectorIds, selectedConnectedConnectorIds, connectingConnectorIds, pendingConnectorAuthIds, connectorConnectErrors, connectorIdsWithDetails, connectorExtracting, connectorSaving, connectorScanLabel, connectorSuggestions, selectedSuggestionIds, selectedConnectorSuggestions, connectorStatus, connectorError, connectorLoadError, connectorAttempts, connectorContextBytes, connectorExtractions, memoryConnectors, toggleConnectorSelection, onConnectMemoryConnector, toggleConnectorSuggestion, onSuggestConnectorMemory, onSaveConnectorSuggestions, onDiscardConnectorSuggestions, nowClock, onOpenPreview, onDeleteExtraction, }: { enabled: boolean; onOpenConnectors?: (() => void) \| undefined; connectorStatuses: ConnectorStatusMap; connectorsLoading: boolean; connectedCount: number; selectedConnectorIds: Set<string>; selectedConnectedConnectorIds: string[]; connectingConnectorIds: Set<string>; pendingConnectorAuthIds: Set<string>; connectorConnectErrors: Record<string, string>; connectorIdsWithDetails: Set<string>; connectorExtracting: boolean; connectorSaving: boolean; connectorScanLabel: string; connectorSuggestions: MemorySuggestion[]; selectedSuggestionIds: Set<string>; selectedConnectorSuggestions: MemorySuggestion[]; connectorStatus: string \| null; connectorError: string \| null; connectorLoadError: string \| null; connectorAttempts: ConnectorMemoryAttempt[]; connectorContextBytes: number; connectorExtractions: MemoryExtractionRecord[]; memoryConnectors: Connector[]; toggleConnectorSelection: (connectorId: string) => void; onConnectMemoryConnector: (connectorId: string) => void; toggleConnectorSuggestion: (suggestionId: string) => void; onSuggestConnectorMemory: () => void; onSaveConnectorSuggestions: () => void; onDiscardConnectorSuggestions: () => void; /** Wall clock so extraction-card relative ages re-render without freezing. */ nowClock: number; onOpenPreview: (id: string) => void; onDeleteExtraction: (id: string) => void; })` | [MemoryConnectedPanel.tsx](../../src/features/memory/react/components/MemoryConnectedPanel.tsx) |
| `MemoryEntryCard({ entry, previewId, previewBody, onOpenPreview, onStartEdit, onDelete, agentHandle, }: { entry: MemoryEntrySummary; previewId: string \| null; previewBody: string \| null; onOpenPreview: (id: string) => void; onStartEdit: (id: string) => void; onDelete: (id: string) => void; /** This card's own agent handle — &#96;MemoryList&#96; derives one per entry. */ agentHandle?: string; })` | [MemoryEntryCard.tsx](../../src/features/memory/react/components/MemoryEntryCard.tsx) |
| `MemoryExtractionCard({ record, nowClock, onOpenPreview, onDelete, agentHandle, }: { record: MemoryExtractionRecord; /** Wall clock so relative ages ("12s ago") re-render without freezing. */ nowClock: number; onOpenPreview: (id: string) => void; onDelete: (id: string) => void; /** This card's own agent handle — &#96;MemoryList&#96; derives one per extraction record. */ agentHandle?: string; })` | [MemoryExtractionCard.tsx](../../src/features/memory/react/components/MemoryExtractionCard.tsx) |
| `MemoryHooksPanel({ enabled, flags, onToggle, agentHandle, }: { /** Master memory switch — when off, every hook toggle is disabled. */ enabled: boolean; flags: Record<MemoryHookKey, boolean>; onToggle: (key: MemoryHookKey, next: boolean) => void; /** This panel's own agent handle — one distinct sub-handle per hook toggle. */ agentHandle?: string; })` | [MemoryHooksPanel.tsx](../../src/features/memory/react/components/MemoryHooksPanel.tsx) |
| `MemoryHowPanel({ enabled, hookFlags, onToggleHook, agentHandle, }: { enabled: boolean; hookFlags: Record<MemoryConfigFlagKey, boolean>; onToggleHook: (key: MemoryConfigFlagKey, next: boolean) => void; /** This panel's own agent handle, forwarded unchanged to &#96;MemoryHooksPanel&#96;. */ agentHandle?: string; })` | [MemoryHowPanel.tsx](../../src/features/memory/react/components/MemoryHowPanel.tsx) |
| `MemoryList({ sectionRef, entries, filtered, visibleExtractions, filter, onFilterChange, unifiedMemoryCount, onClearExtractions, onRefreshExtractions, isRefreshing, previewId, previewBody, nowClock, onOpenPreview, onStartEdit, onDeleteEntry, onDeleteExtraction, agentHandle, }: { sectionRef: MutableRefObject<HTMLElement \| null>; entries: MemoryEntrySummary[]; filtered: MemoryEntrySummary[]; visibleExtractions: MemoryExtractionRecord[]; filter: 'all' \| MemoryType; onFilterChange: (filter: 'all' \| MemoryType) => void; unifiedMemoryCount: number; onClearExtractions: () => void; onRefreshExtractions: () => void; isRefreshing: boolean; previewId: string \| null; previewBody: string \| null; nowClock: number; onOpenPreview: (id: string) => void; onStartEdit: (id: string) => void; onDeleteEntry: (id: string) => void; onDeleteExtraction: (id: string) => void; /** This section's own agent handle — see &#96;MemorySettingsPanel&#96;'s &#96;agentHandle&#96; doc. */ agentHandle?: string; })` | [MemoryList.tsx](../../src/features/memory/react/components/MemoryList.tsx) |
| `MemoryManualEditor({ editing, onEditingChange, onStartNew, onCancel, onSave, busy, editorRef, editorNameRef, flash, }: { editing: DraftEntry \| null; onEditingChange: (draft: DraftEntry) => void; onStartNew: () => void; onCancel: () => void; onSave: () => void; busy: boolean; editorRef: MutableRefObject<HTMLDivElement \| null>; editorNameRef: MutableRefObject<HTMLInputElement \| null>; flash: { kind: FlashKind; key: number } \| null; })` | [MemoryManualEditor.tsx](../../src/features/memory/react/components/MemoryManualEditor.tsx) |
| `MemorySettingsPanel({ enabled, onToggleEnabled, topTab, onTopTabChange, onAdd, onOpenAdvanced, savedMemory, howItWorks, agentHandle, }: MemorySettingsPanelProps)` | [MemorySettingsPanel.tsx](../../src/features/memory/react/components/MemorySettingsPanel.tsx) |
| `MentionAutocomplete({ value, onValueChange, items, categories, onSelectionChange, triggerChar, getSearchText, maxResultsPerCategory, placeholder, rows = 8, disabled = false, selectedIcon, chipRemoveIcon, emptyResultsPlaceholder, resultsAriaLabel, useMentionAutocomplete: useMentionAutocompleteHook = useMentionAutocomplete, }: MentionAutocompleteProps<T>)` | [MentionAutocomplete.tsx](../../src/features/mention-autocomplete/react/components/MentionAutocomplete.tsx) |
| `MentionCategoryTabs({ categories, active, onChange, allLabel = 'All' }: MentionCategoryTabsProps)` | [MentionCategoryTabs.tsx](../../src/features/mention-autocomplete/react/components/MentionCategoryTabs.tsx) |
| `MentionResultItem({ item, selected, onPick, selectedIcon, }: MentionResultItemProps<T>)` | [MentionResultItem.tsx](../../src/features/mention-autocomplete/react/components/MentionResultItem.tsx) |
| `MentionResultsList({ groups, hasResults, query, selectedIds, onPick, selectedIcon, emptyPlaceholder = 'Start typing to search.', }: MentionResultsListProps<T>)` | [MentionResultsList.tsx](../../src/features/mention-autocomplete/react/components/MentionResultsList.tsx) |
| `NotificationsTab({ preferences, onChange, testNotificationTitle, testNotificationBody, labels, agentHandle, }: NotificationsTabProps)` | [NotificationsTab.tsx](../../src/features/notifications/react/components/NotificationsTab.tsx) |
| `OnboardingChipField(props: OnboardingChipFieldProps)` | [OnboardingChipField.tsx](../../src/react/components/OnboardingChipField.tsx) |
| `OnboardingDropdown(props: OnboardingDropdownProps)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `OnboardingPanelHeader({ title, body, className }: OnboardingPanelHeaderProps)` | [OnboardingPanelHeader.tsx](../../src/react/components/OnboardingPanelHeader.tsx) |
| `PresentMenu({ disabled, onPresentInline, onPresentFullscreen, onPresentInNewTab }: PresentMenuProps)` | [PresentMenu.tsx](../../src/features/html-viewer/react/components/PresentMenu.tsx) |
| `PreviewModalShell({ title, subtitle, views, initialViewId, onView, onClose, sidebar, designWidth = 1280, primaryAction, headerExtras, hideSidebarToggle = false, onFullscreenClick, onSidebarToggleClick, srcDocOptions, icons: iconOverrides, className, }: PreviewModalShellProps)` | [PreviewModalShell.tsx](../../src/renderers/preview-modal-shell/react/components/PreviewModalShell.tsx) |
| `PrivacyTab({ state, onChange, labels, now = Date.now, agentHandle }: PrivacyTabProps)` | [PrivacyTab.tsx](../../src/features/privacy/react/components/PrivacyTab.tsx) |
| `ProgressCard({ data, maxSteps = 6, maxSecondaryItems = 5 }: ProgressCardProps)` | [ProgressCard.tsx](../../src/features/progress-card/components/ProgressCard.tsx) |
| `ProjectLocationsTab({ port, defaultLocationId, onDefaultLocationIdChange, labels }: ProjectLocationsTabProps)` | [ProjectLocationsTab.tsx](../../src/features/project-locations/react/components/ProjectLocationsTab.tsx) |
| `ProviderChipGroup({ label, presets, selectedPresetId, configuredPresetIds, onSelect, configuredLabel, unsetLabel, agentHandle, }: ProviderChipGroupProps)` | [ProviderChipGroup.tsx](../../src/features/execution/react/components/ProviderChipGroup.tsx) |
| `ProviderTabBar({ tabs, selectedId, onSelect, ariaLabel, agentHandle }: ProviderTabBarProps)` | [ProviderTabBar.tsx](../../src/features/connectors/components/ProviderTabBar.tsx) |
| `RecurringSchedulePicker({ value, onChange, kinds = DEFAULT_SCHEDULE_KINDS, weekdays = DEFAULT_WEEKDAYS, timezones, disabled = false, useRecurringSchedulePicker: useRecurringSchedulePickerHook = useRecurringSchedulePicker, }: RecurringSchedulePickerProps)` | [RecurringSchedulePicker.tsx](../../src/features/schedule-picker/react/components/RecurringSchedulePicker.tsx) |
| `ResourceBoard({ dependencies, statusOptions, toneMap, defaultStatus, normalizeStatus, sortOptions = [], initialSort, storageScopeKey, defaultViewMode, enableBulkDelete = true, onOpenItem, onCreate, createLabel, onRenameRequest, onCustomItemAction, refreshToken, renderBody, useWiredResourceBoard: useWiredResourceBoardHook = useWiredResourceBoard, }: ResourceBoardProps<TItem, TBody>)` | [ResourceBoard.tsx](../../src/features/resource-dashboard/react/components/ResourceBoard.tsx) |
| `ResourceBoardToolbar({ sortOptions, activeSort, onSortChange, sortAriaLabel, query, onQueryChange, searchPlaceholder, viewMode, onViewModeChange, viewToggleAriaLabel, gridViewLabel, kanbanViewLabel, enableBulkDelete, selectMode, selectedCount, bulkDeleteBusy, onEnterSelectMode, onExitSelectMode, onBulkDelete, selectModeLabel, selectedCountLabel, deleteSelectedLabel, cancelSelectLabel, createLabel, onCreate, }: ResourceBoardToolbarProps)` | [ResourceBoardToolbar.tsx](../../src/features/resource-dashboard/react/components/ResourceBoardToolbar.tsx) |
| `ResourceBoardView({ loading, error, errorLabel, actionError, actionErrorLabel, hasAnyItems, items, kanbanColumns, sortOptions, activeSort, onSortChange, sortAriaLabel, query, onQueryChange, searchPlaceholder, viewMode, onViewModeChange, viewToggleAriaLabel, gridViewLabel, kanbanViewLabel, enableBulkDelete, selectMode, selected, bulkDeleteBusy, onEnterSelectMode, onExitSelectMode, onBulkDelete, selectModeLabel, selectedCountLabel, deleteSelectedLabel, cancelSelectLabel, createLabel, onCreate, openMenuId, menuContainerRef, onToggleMenu, onItemAction, isItemBusy, onOpenItem, onToggleSelected, onKanbanDelete, statusLabel, toneMap, menuActionLabel, moreLabel, deleteLabel, deleteAriaLabel, emptyColumnLabel, emptyStateTitle, emptyStateNoMatch, renderBody, }: ResourceBoardViewProps<TBody>)` | [ResourceBoardView.tsx](../../src/features/resource-dashboard/react/components/ResourceBoardView.tsx) |
| `ResourceCard({ item, selectMode, selected, menuOpen, busy, statusLabel, toneMap, menuActionLabel, moreLabel, menuContainerRef, renderBody, onOpen, onToggleSelected, onToggleMenu, onAction, }: ResourceCardProps<TBody>)` | [ResourceCard.tsx](../../src/features/resource-dashboard/react/components/ResourceCard.tsx) |
| `ResourceKanbanBoard({ columns, emptyColumnLabel, deleteLabel, deleteAriaLabel, isBusy, onOpen, onDelete, }: ResourceKanbanBoardProps<TBody>)` | [ResourceKanbanBoard.tsx](../../src/features/resource-dashboard/react/components/ResourceKanbanBoard.tsx) |
| `ResourceMetrics({ metrics, ariaLabel }: ResourceMetricsProps)` | [ResourceMetrics.tsx](../../src/features/resource-dashboard/react/components/ResourceMetrics.tsx) |
| `ResourceRowList({ dependencies, title, eyebrow, lede, metrics = [], statusOptions, toneMap, onRowAction, onHistoryItemAction, onCreate, createLabel, refreshToken, }: ResourceRowListProps<TRow>)` | [ResourceRowList.tsx](../../src/features/resource-dashboard/react/components/ResourceRowList.tsx) |
| `ResourceRowListItem({ row, busy, statusLabel, toneMap, canExpandHistory, expanded, showHistoryLabel, hideHistoryLabel, historyItems, historyLoading, historyTitleLabel, historyLoadingLabel, historyEmptyLabel, onToggleExpand, onAction, onHistoryItemAction, }: ResourceRowListItemProps)` | [ResourceRowListItem.tsx](../../src/features/resource-dashboard/react/components/ResourceRowListItem.tsx) |
| `ResourceRowListView({ eyebrow, title, lede, metrics, metricsAriaLabel, createLabel, onCreate, loading, error, errorLabel, actionError, actionErrorLabel, sectionLabel, loadingLabel, emptyTitle, emptyBody, rows, isRowBusy, statusLabel, toneMap, canExpandHistory, expandedRowId, historyLoadingRowId, historyByRowId, showHistoryLabel, hideHistoryLabel, historyTitleLabel, historyLoadingLabel, historyEmptyLabel, onToggleExpand, onRowAction, onHistoryItemAction, }: ResourceRowListViewProps)` | [ResourceRowListView.tsx](../../src/features/resource-dashboard/react/components/ResourceRowListView.tsx) |
| `ResourceRunHistoryList({ items, loading, titleLabel, loadingLabel, emptyLabel, statusLabel, toneMap, onAction, }: ResourceRunHistoryListProps)` | [ResourceRunHistoryList.tsx](../../src/features/resource-dashboard/react/components/ResourceRunHistoryList.tsx) |
| `RevisionDiffCard({ revision, saving = false, onAccept, onReject }: RevisionDiffCardProps<TMeta>)` | [RevisionDiffCard.tsx](../../src/features/revision-review/react/components/RevisionDiffCard.tsx) |
| `RevisionHistoryList({ revisions }: RevisionHistoryListProps<TMeta>)` | [RevisionHistoryList.tsx](../../src/features/revision-review/react/components/RevisionHistoryList.tsx) |
| `ScheduleFields({ state, timezones, onMinuteChange, onTimeChange, onTimezoneChange }: ScheduleFieldsProps)` | [ScheduleFields.tsx](../../src/features/schedule-picker/react/components/ScheduleFields.tsx) |
| `ScheduleKindTabs({ kinds, active, onChange }: ScheduleKindTabsProps)` | [ScheduleKindTabs.tsx](../../src/features/schedule-picker/react/components/ScheduleKindTabs.tsx) |
| `ScheduleSummary({ schedule, weekdays }: ScheduleSummaryProps)` | [ScheduleSummary.tsx](../../src/features/schedule-picker/react/components/ScheduleSummary.tsx) |
| `SearchableModelSelect({ models, value, onChange, ariaLabel, searchPlaceholder, additionalOptions, minSearchableOptions = 8, className, menuClassName, testId, searchInputTestId, agentHandle, }: SearchableModelSelectProps)` | [SearchableModelSelect.tsx](../../src/features/execution/react/components/SearchableModelSelect.tsx) |
| `SeeMore({ useClamp = useSeeMoreClamp, agentHandle: handle, ...props }: SeeMoreProps)` | [SeeMore.tsx](../../src/features/admin-widgets/components/SeeMore/SeeMore.tsx) |
| `SegmentedToggle({ options, value, onChange, ariaLabel, className, }: SegmentedToggleProps<TValue>)` | [SegmentedToggle.tsx](../../src/features/viewer-shell/react/components/SegmentedToggle.tsx) |
| `SelectedMentionChips({ items, onRemove, removeIcon, }: SelectedMentionChipsProps<T>)` | [SelectedMentionChips.tsx](../../src/features/mention-autocomplete/react/components/SelectedMentionChips.tsx) |
| `SelectionActionBar({ selectedIds, onSelectAll, onClear, onRequestDelete, renderBulkActions, }: SelectionActionBarProps)` | [SelectionActionBar.tsx](../../src/features/asset-grid/react/components/SelectionActionBar.tsx) |
| `SelectionBand({ band }: SelectionBandProps)` | [SelectionBand.tsx](../../src/features/asset-grid/react/components/SelectionBand.tsx) |
| `SettingsIconButton({ onClick, title, ariaLabel, }: { onClick: () => void; title: string; ariaLabel: string; })` | [AppChromeHeader.tsx](../../src/react/components/AppChromeHeader.tsx) |
| `SkillDraftForm({ heading, subheading, draft, onDraftChange, error, saving, isEdit, isBuiltInOverride = false, onCancel, onSubmit, labels, agentHandle, }: SkillDraftFormProps)` | [SkillDraftForm.tsx](../../src/features/skills/react/components/SkillDraftForm.tsx) |
| `SkillRow({ skill, locale, enabled, expanded, editing, body, bodyLoading, files, filesLoading, confirmDelete, confirmBuiltInEdit, draft, draftError, draftSaving, onDraftChange, onToggleExpanded, onToggleEnabled, onStartEdit, onConfirmBuiltInEdit, onCancelBuiltInEdit, onArmDelete, onCancelDelete, onCommitDelete, onCancelEdit, onSubmitEdit, labels, agentHandle, }: SkillRowProps)` | [SkillRow.tsx](../../src/features/skills/react/components/SkillRow.tsx) |
| `SkillsTab({ port, disabledSkillIds, onToggleEnabled, locale = 'en', labels, agentHandle }: SkillsTabProps)` | [SkillsTab.tsx](../../src/features/skills/react/components/SkillsTab.tsx) |
| `SnippetBlock({ snippet, language, placeholder, copyAriaLabel, copyLabel, copiedLabel }: SnippetBlockProps)` | [SnippetBlock.tsx](../../src/features/integrations/react/components/SnippetBlock.tsx) |
| `SourceConfigAddForm({ fieldSpecs, trustOptions, values, trust, validation, submitAttempted, submitting, submitError, addLabel, onFieldChange, onTrustChange, onSubmit, canTest = false, testing = false, testResult, onTest, agentHandle, onCancel, cancelLabel, }: SourceConfigAddFormProps)` | [SourceConfigAddForm.tsx](../../src/features/source-config-list/react/components/SourceConfigAddForm.tsx) |
| `SourceConfigField({ spec, value, error, disabled = false, idPrefix = 'source-config-field', agentHandle, onChange }: SourceConfigFieldProps)` | [SourceConfigField.tsx](../../src/features/source-config-list/react/components/SourceConfigField.tsx) |
| `SourceConfigItemCard({ source, fieldSpecs, trustOptions, capabilities, removing, refreshing, settingTrust, testing, updating, testResult, onRefresh, onRemove, onTrustChange, onTest, onUpdate, agentHandle, }: SourceConfigItemCardProps<TSource>)` | [SourceConfigItemCard.tsx](../../src/features/source-config-list/react/components/SourceConfigItemCard.tsx) |
| `SourceConfigListView({ title, subtitle, emptyMessage, fieldSpecs, trustOptions, sources, loading, loadError, capabilities, pendingKeys, testResults, addForm, onRefresh, onRemove, onTrustChange, onTest, onUpdate, agentHandle, }: SourceConfigListViewProps<TSource>)` | [SourceConfigListView.tsx](../../src/features/source-config-list/react/components/SourceConfigListView.tsx) |
| `SourceConfigTestControl({ running, result, disabled = false, agentHandle, onTest }: SourceConfigTestControlProps)` | [SourceConfigTestControl.tsx](../../src/features/source-config-list/react/components/SourceConfigTestControl.tsx) |
| `StatusPill({ status, label, toneMap }: StatusPillProps)` | [StatusPill.tsx](../../src/features/resource-dashboard/react/components/StatusPill.tsx) |
| `SvgSourcePane({ mode, previewSrc, previewAlt, source, loading, loadingLabel, error, errorLabel }: SvgSourcePaneProps)` | [SvgSourcePane.tsx](../../src/features/viewer-shell/react/components/SvgSourcePane.tsx) |
| `TabLauncherActionRow({ action, onSelect, renderIcon }: TabLauncherActionRowProps<TActionCtx>)` | [TabLauncherActionRow.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherActionRow.tsx) |
| `TabLauncherMenu({ searchPlaceholder, renderIcon, renderSearchIcon, useTabLauncherMenu: useTabLauncherMenuHook = useTabLauncherMenu, ...options }: TabLauncherMenuProps<TActionCtx>)` | [TabLauncherMenu.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherMenu.tsx) |
| `TabLauncherResultRow({ item, selectableIndex, selected, openLabel, onHover, onSelect, renderIcon, }: TabLauncherResultRowProps)` | [TabLauncherResultRow.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherResultRow.tsx) |
| `VersionManagerModal({ fileRef, currentContent, onClose, onRestored, dependencies = defaultVersionManagerDependencies as unknown as VersionManagerDependencies<TVersion>, viewportPresets, useVersionManager: useVersionManagerHook = useVersionManager, }: VersionManagerModalProps<TVersion>)` | [VersionManagerModal.tsx](../../src/features/version-manager/react/components/VersionManagerModal.tsx) |
| `VersionPreviewFrame({ previewDocument, frameReady, onFrameLoad, viewport, viewportPresets, title, error, loading, loadingContent, }: VersionPreviewFrameProps)` | [VersionPreviewFrame.tsx](../../src/features/version-manager/react/components/VersionPreviewFrame.tsx) |
| `VersionPromptPopover({ prompt, disabled, copied, onCopy, onOpenChange }: VersionPromptPopoverProps)` | [VersionPromptPopover.tsx](../../src/features/version-manager/react/components/VersionPromptPopover.tsx) |
| `VersionRestoreControl({ disabled, restoring, onRestore }: VersionRestoreControlProps)` | [VersionRestoreControl.tsx](../../src/features/version-manager/react/components/VersionRestoreControl.tsx) |
| `VersionSidebar({ countLabel, search, onSearchChange, showSearch, loading, versions, visibleVersions, selectedVersionId, onSelect, onPrefetch, formatDate, sourceLabel, sourceClassName, restoredFrom, }: VersionSidebarProps<TVersion>)` | [VersionSidebar.tsx](../../src/features/version-manager/react/components/VersionSidebar.tsx) |
| `VideoViewerBody({ src }: VideoViewerBodyProps)` | [VideoViewerBody.tsx](../../src/features/viewer-shell/react/components/VideoViewerBody.tsx) |
| `ViewerEmptyState({ children }: ViewerEmptyStateProps)` | [ViewerShell.tsx](../../src/features/viewer-shell/react/components/ViewerShell.tsx) |
| `ViewerFileActions({ downloadUrl, openUrl, fileName, downloadLabel, openLabel }: ViewerFileActionsProps)` | [ViewerFileActions.tsx](../../src/features/viewer-shell/react/components/ViewerFileActions.tsx) |
| `ViewerShell({ kindClassName, toolbarLeft, toolbarActions, bodyClassName, children }: ViewerShellProps)` | [ViewerShell.tsx](../../src/features/viewer-shell/react/components/ViewerShell.tsx) |
| `ViewportSwitcher({ presets, viewport, onViewport, ariaLabel, tabIndex }: ViewportSwitcherProps)` | [ViewportSwitcher.tsx](../../src/features/viewer-shell/react/components/ViewportSwitcher.tsx) |
| `ViewportToggleGroup({ presets, viewport, onViewport, ariaLabel }: ViewportToggleGroupProps)` | [ViewportToggleGroup.tsx](../../src/features/viewer-shell/react/components/ViewportToggleGroup.tsx) |
| `WeekdayGrid({ weekdays, active, onChange }: WeekdayGridProps)` | [WeekdayGrid.tsx](../../src/features/schedule-picker/react/components/WeekdayGrid.tsx) |
| `ZoomMenu({ zoom, levels, isOpen, onToggle, onClose, onSelect }: ZoomMenuProps)` | [ZoomMenu.tsx](../../src/features/html-viewer/react/components/ZoomMenu.tsx) |
| `__resetStuckRunWatchdogForTests()` | [stuck-run.ts](../../src/features/observability/stuck-run.ts) |
| `advanceLogoStage(stage: LogoStage, opts: { logoSrc?: string \| null \| undefined; host?: string \| undefined },)` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `agentCliEnvValue(config: LocalCliConfig, agentId: string, envKey: string)` | [rules.ts](../../src/features/execution/rules.ts) |
| `agentDiagnosticTooltip(diagnostic: AgentDiagnostic)` | [rules.ts](../../src/features/execution/rules.ts) |
| `agentExecutableRepairState(result: { ok: boolean; usedExecutableSource?: AgentExecutableSource \| undefined; detectedExecutablePath?: string \| undefined; })` | [rules.ts](../../src/features/execution/rules.ts) |
| `agentMetaLabel(agent: DetectedAgent, labels: AgentMetaLabels,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `agentModelSummary(config: LocalCliConfig, agent: DetectedAgent)` | [rules.ts](../../src/features/execution/rules.ts) |
| `apiKeyFormatWarning(config: ByokConfig, preset: ProviderPreset \| null, presets: readonly ProviderPreset[] = [],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `appendSavedCommentOrder(currentOrderIds: string[], visibleIds: string[], savedId: string,)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `applyAppearanceToDocument({ theme, accentColor, }: { theme?: AppearanceTheme; accentColor?: string; })` | [appearance.ts](../../src/utils/appearance.ts) |
| `applyConnectorStatuses(current: Connector[], statuses: ConnectorStatusMap)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `applyMemoryConnectorStatus(connector: Connector, status: ConnectorStatusMap[string],)` | [rules.ts](../../src/features/memory/rules.ts) |
| `applySketchContextMenuSimplification(root: HTMLElement, viewportRoot: HTMLElement, allowList: readonly string[], recognizedActions: readonly string[],)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `applySketchDomTextOverrides(root: ParentNode, overrides: SketchDomTextOverrides \| undefined)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `applySketchEditorTooltips(root: HTMLElement, labels: SketchTooltipLabels, targets: readonly SketchTooltipTarget[],)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `applySrcDocBridges(doc: string, bridges: readonly SrcDocBridge[], ctx: SrcDocBridgeContext = {},)` | [bridge.ts](../../src/renderers/srcdoc/bridge.ts) |
| `basename(dir: string)` | [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `basenameForRename(path: string, currentDir: string)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `beginSilentUpdatesWrite(next: boolean)` | [rules.ts](../../src/features/about/rules.ts) |
| `binPathEnvField(fields: readonly AgentCliEnvFieldSpec[], agentId: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `brandMonogram(name: string)` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `buildAnyTriggerDeletionRegex(triggers: readonly RichTextTriggerConfig[],)` | [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `buildAssetGridQuery(kind: string, source: string, search: string, mapKindToQuery?: (kind: string) => string \| undefined,)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `buildBreadcrumbSegments(currentDir: string)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `buildClaudeCliSnippet(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildCodexEnvToml(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildCodexTomlSnippet(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildCursorDeeplink(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildFacetLabelMap(facets: readonly { value: string; label: string }[])` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `buildFaviconUrl(host: string, size: number)` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `buildFocusGuardScript()` | [sandboxed-document.ts](../../src/renderers/sandboxed-document.ts) |
| `buildInitialData(scene: SketchScene, fileName: string, defaultStrokeColor: string,)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `buildLocalizedUrl(locale: string, options: LocalizedUrlOptions)` | [localized-url.ts](../../src/utils/localized-url.ts) |
| `buildMcpStdioServerConfig(info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildSandboxedPreviewPage(html: string, title: string, options: NewTabPreviewOptions = {},)` | [new-tab-preview.ts](../../src/renderers/new-tab-preview.ts) |
| `buildScheduleValue(state: ScheduleEditorState)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `buildScrollAnchors(blockOffsets: number[], scrollHeight: number)` | [markdown-scroll-sync.ts](../../src/utils/markdown-scroll-sync.ts) |
| `buildSharedMcpJson(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildSketchTooltipLabels(t: SketchTranslate)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `buildStorageShimScript()` | [sandboxed-document.ts](../../src/renderers/sandboxed-document.ts) |
| `buildSubmitOptionRules(input: { canSubmit: boolean; sendDisabled: boolean })` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `buildTriggerDeletionRegex(trigger: RichTextTriggerConfig)` | [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `buildTriggerMatch(detected: { id: string; query: string } \| null, rootEl: HTMLElement \| null,)` | [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `buildVersionIndex(versions: readonly TVersion[],)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `buildVsCodeSnippet(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildZedSnippet(serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `buildZip(entries: ZipEntry[])` | [zip.ts](../../src/utils/zip.ts) |
| `canCopyLocalPath(file: TFile, selectors: AssetTreeSelectors<TFile>)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `canGoBack(state: BrowserNavigationState)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `canGoForward(state: BrowserNavigationState)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `canGoNext(state: DeckSlideState \| null)` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `canGoPrev(state: DeckSlideState \| null)` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `captureFolderPathDrop({ event, port, composer }: CaptureFolderPathDropInput)` | [rules.ts](../../src/features/folder-path-drop/rules.ts) |
| `cardIdsInBand(rects: readonly CardRect[], band: Band)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `chatActivityToProgressCard(message: ChatActivityLike \| null, options: ChatActivityToProgressCardOptions,)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `clamp01(value: number)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `clampAnchoredPosition(anchorRect: TabLauncherAnchorRect, viewportWidth: number, menuWidth: number = MENU_WIDTH, margin: number = VIEWPORT_MARGIN, offset: number = ANCHOR_OFFSET,)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `clampMinute(value: number)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `clampProgressPercent(value: number)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `clampSelection(current: number, count: number)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `clampSketchContextPopover(popover: HTMLElement, viewportRoot: HTMLElement)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `clampSlideIndex(index: number, count: number)` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `cleanAgentVersionLabel(label: string, version: string \| null \| undefined)` | [rules.ts](../../src/features/execution/rules.ts) |
| `clearConnectorAuthorizationCancelFailuresForConnected(failures: Record<string, boolean>, statuses: ConnectorStatusMap,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `clearConnectorAuthorizationErrorsForConnected(errors: Record<string, string>, statuses: ConnectorStatusMap,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `clearConnectorAuthorizationPending(pending: ConnectorAuthorizationPendingState, connectorId: string,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `cliEnvFieldsForAgent(fields: readonly AgentCliEnvFieldSpec[], agentId: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `cloneJson(value: unknown, fallback: T)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `commandPaletteShortcut(platform: McpInstallPlatform)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `compositeMarksOntoCanvas(ctx: CanvasRenderingContext2D, input: { target: CaptureTarget \| null; selectionBoxes: readonly NormalizedRect[]; strokes: readonly Stroke[]; textMarks: readonly TextMark[]; }, outputWidth: number, outputHeight: number, scaleX: number, scaleY: number,)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `computeCaretFloatingLayerPosition(caret: CaretRect, size: { width: number; height: number } \| null, boundary: DOMRect \| null, config: { gap: number; margin: number; hardMaxHeight: number; preferredWidth: number; },)` | [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `computeCustomSelectMenuPosition(rect: { top: number; bottom: number; left: number; width: number }, viewport: { width: number; height: number },)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `computeDockPlacement(input: DockPlacementInput)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `computeMenuPosition(anchor: MenuAnchorRect, viewportHeight: number, options: MenuPositionOptions = {},)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `computeScalerStyle(stageSize: { w: number; h: number }, designWidth: number, scale: number,)` | [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `computeSplitPaneScrollTarget(params: { sourcePane: MarkdownScrollPane; source: { scrollTop: number; scrollHeight: number; clientHeight: number }; target: { scrollHeight: number; clientHeight: number }; blockLineCount: number; editorOffsets: number[] \| null; previewOffsets: number[] \| null; })` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `computeStageScale(stageWidth: number, designWidth: number)` | [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `connectorAppLabel(connectorId: string)` | [constants.ts](../../src/features/memory/constants.ts) |
| `connectorAttemptDetail(attempt: ConnectorMemoryAttempt)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `connectorAttemptName(attempt: ConnectorMemoryAttempt)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `connectorAttemptTitle(attempt: ConnectorMemoryAttempt)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `connectorAuthSnapshotChanged(current: Pick<Connector, 'status' \| 'accountLabel' \| 'lastError'> \| null \| undefined, next: { status: string; accountLabel?: string; lastError?: string } \| null \| undefined,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `connectorPanelAlerts(connectors: Connector[], detailConnectorId: string \| null, authorizationError: Record<string, string>, authorizationCancelFailed: Record<string, boolean>, cancelFailedMessage: string,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `connectorWithPendingAuthorization(connector: Connector)` | [rules.ts](../../src/features/memory/rules.ts) |
| `contentMatchesSelection(selectedId: string \| null, selectedContentVersionId: string \| null, selectedContent: string \| null,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `copyToClipboard({ text }: { text: string }, options: CopyToClipboardOptions = {},)` | [copy-to-clipboard.ts](../../src/utils/copy-to-clipboard.ts) |
| `countFilesUnderDir(files: readonly TFile[], dirPath: string,)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `createAsyncCommitGuard()` | [async-commit-guard.ts](../../src/features/memory/async-commit-guard.ts) |
| `createBrowserAssetTreeClipboardPort()` | [dependencies.ts](../../src/features/asset-tree-browser/dependencies.ts) |
| `createBrowserAssetTreeDependencies()` | [dependencies.ts](../../src/features/asset-tree-browser/dependencies.ts) |
| `createBrowserAssetTreeDomBridgePort()` | [dependencies.ts](../../src/features/asset-tree-browser/dependencies.ts) |
| `createBrowserConnectorAuthBridge()` | [dependencies.ts](../../src/features/connectors/dependencies.ts) |
| `createBrowserConnectorAuthPendingStorage()` | [dependencies.ts](../../src/features/connectors/dependencies.ts) |
| `createBrowserFullscreenPort()` | [dependencies.ts](../../src/features/html-viewer/dependencies.ts) |
| `createBrowserHistoryStorage(options: { namespace?: string; limit?: number } = {},)` | [dependencies.ts](../../src/features/browser-chrome/dependencies.ts) |
| `createBrowserNewTabPreviewPort()` | [dependencies.ts](../../src/features/html-viewer/dependencies.ts) |
| `createBrowserSseLiveUpdatesPort(options: BrowserSseLiveUpdatesOptions)` | [dependencies.ts](../../src/features/asset-grid/dependencies.ts) |
| `createBrowserVersionManagerClipboard()` | [dependencies.ts](../../src/features/version-manager/dependencies.ts) |
| `createBrowserViewerClipboard()` | [dependencies.ts](../../src/features/viewer-shell/dependencies.ts) |
| `createDefaultBrowserChromeDependencies(options: { historyNamespace?: string; historyLimit?: number } = {},)` | [dependencies.ts](../../src/features/browser-chrome/dependencies.ts) |
| `createDefaultHtmlViewerDependencies()` | [dependencies.ts](../../src/features/html-viewer/dependencies.ts) |
| `createDefaultVersionManagerDependencies()` | [dependencies.ts](../../src/features/version-manager/dependencies.ts) |
| `createDefaultViewerShellDependencies()` | [dependencies.ts](../../src/features/viewer-shell/dependencies.ts) |
| `createFakeAnnotationCanvasPort(overrides: Partial<AnnotationCanvasPort> = {},)` | [dependencies.ts](../../src/renderers/annotation-canvas/dependencies.ts) |
| `createFakeAssetGridDataPort(options: FakeAssetGridDataPortOptions<TAsset> = {},)` | [dependencies.ts](../../src/features/asset-grid/dependencies.ts) |
| `createFakeAssetGridDependencies(options: FakeAssetGridDataPortOptions<TAsset> = {},)` | [dependencies.ts](../../src/features/asset-grid/dependencies.ts) |
| `createFakeAssetTreeDependencies(options: FakeAssetTreeDependenciesOptions = {},)` | [dependencies.ts](../../src/features/asset-tree-browser/dependencies.ts) |
| `createFakeConnectorsDependencies(options: FakeConnectorsPortOptions = {},)` | [dependencies.ts](../../src/features/connectors/dependencies.ts) |
| `createFakeConnectorsPort(options: FakeConnectorsPortOptions = {})` | [dependencies.ts](../../src/features/connectors/dependencies.ts) |
| `createFakeMemoryConnectorsPort(options: FakeMemoryConnectorsPortOptions = {})` | [dependencies.ts](../../src/features/memory/dependencies.ts) |
| `createFakeResourceBoardDependencies(options: FakeResourceBoardPortOptions<TItem> = {},)` | [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `createFakeResourceBoardPort(options: FakeResourceBoardPortOptions<TItem> = {},)` | [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `createFakeResourceRowListDependencies(options: FakeResourceRowListPortOptions<TRow> = {},)` | [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `createFakeResourceRowListPort(options: FakeResourceRowListPortOptions<TRow> = {},)` | [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `createFakeSketchEditorDependencies(overrides: Partial<SketchEditorEnginePort> = {})` | [dependencies-fake.tsx](../../src/features/sketch-editor/react/dependencies-fake.tsx) |
| `createFakeSketchEditorEngine(overrides: Partial<SketchEditorEnginePort> = {})` | [dependencies-fake.tsx](../../src/features/sketch-editor/react/dependencies-fake.tsx) |
| `createFakeSourceConfigDependencies(options: FakeSourceConfigPortOptions<TSource>,)` | [dependencies.ts](../../src/features/source-config-list/dependencies.ts) |
| `createFakeSourceConfigPort(options: FakeSourceConfigPortOptions<TSource>,)` | [dependencies.ts](../../src/features/source-config-list/dependencies.ts) |
| `createFakeVersionManagerPort(seed?: ReadonlyMap<string, TVersion[]>,)` | [dependencies.ts](../../src/features/version-manager/dependencies.ts) |
| `createFileSystemReadError(action: string, error: unknown)` | [file-system-errors.ts](../../src/utils/file-system-errors.ts) |
| `createJsonRpcError({ id, code, message }: { id: number \| string; code: number; message: string }, { data }: { data?: unknown } = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `createJsonRpcNotification({ method }: { method: string }, { params }: { params?: Record<string, unknown> \| undefined } = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `createJsonRpcRequest({ id, method }: { id: number \| string; method: string }, { params }: { params?: Record<string, unknown> \| undefined } = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `createJsonRpcResult({ id, result }: { id: number \| string; result: unknown }, _optional: Record<string, never> = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `createLocalStorageRecents(options: { namespace?: string; limit?: number } = {},)` | [dependencies.ts](../../src/features/command-palette/dependencies.ts) |
| `createLocalStorageViewModeStorage()` | [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `createNoopBrowserBridgeRegistration()` | [dependencies.ts](../../src/features/browser-chrome/dependencies.ts) |
| `createPageActionRequest({ id, capabilityId, input }: { id: number \| string; capabilityId: string; input: Record<string, unknown> }, _optional: Record<string, never> = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `credentialsForPreset(config: ByokConfig, preset: ProviderPreset \| null,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `customPreset(protocol: ByokConfig['protocol'], title = 'Custom')` | [rules.ts](../../src/features/execution/rules.ts) |
| `dayHeading(key: string, referenceDate: Date = new Date())` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `dayHeadingResult(key: string, referenceDate: Date = new Date())` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `dayKeyFromTimestamp(timestampMs: number)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `decideAutoOpenAfterWrite(filePath: string, nextFiles: ReadonlyArray<CandidateFile>, options: AutoOpenOptions = {},)` | [auto-open-file.ts](../../src/utils/auto-open-file.ts) |
| `decomposeSchedule(schedule: ScheduleValue, weekdays: WeekdayOption[] = DEFAULT_WEEKDAYS,)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `dedupeToolUsesById(events: AgentEventLike[] \| undefined)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `defaultCategoryLabel(category: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `defaultDetectSystemLocale(supportedLocales: readonly Locale[])` | [locale.ts](../../src/features/i18n/locale.ts) |
| `defaultExcalidrawLangCode(locale: string, overrides: Record<string, string> = DEFAULT_EXCALIDRAW_LANG_CODES,)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `defaultMatchesKindFilter(asset: TAsset, filterValue: string, getKind: (asset: TAsset) => string,)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `defaultProgressCardDetail(status: ProgressStatus)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `defaultProgressCardTitle(status: ProgressStatus)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `defaultScheduleEditorState(timezone: string)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `deriveAboutUpdateControl(model: UpdaterModel, appVersionInfo: AppVersionInfo \| null,)` | [rules.ts](../../src/features/about/rules.ts) |
| `deriveContentStatus(view: PreviewModalContentViewLike \| undefined)` | [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `deriveFileOpsFromAgentEvents(events: AgentEventLike[] \| undefined)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `deriveMarkKind(input: { hasTarget: boolean; hasVisualMark: boolean; })` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `deriveTreeChildren(files: readonly TFile[], folders: readonly AssetTreeFolderItem[], currentDir: string,)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `describeConnectorReadIssue(result: ConnectorMemorySuggestionResponse)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `describeExtractionFailure(record: MemoryExtractionRecord)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `describeRecord(record: MemoryExtractionRecord, t: Translate,)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `describeScheduleSummary(schedule: ScheduleValue, weekdays: WeekdayOption[] = DEFAULT_WEEKDAYS)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `designMdDefaultModuleText(module: DesignMdModule, preamble = '')` | [design-md.ts](../../src/utils/design-md.ts) |
| `designMdHeadingMatches(title: string, module: DesignMdModule)` | [design-md.ts](../../src/utils/design-md.ts) |
| `designMdHeadings(body: string, startOffset: number)` | [design-md.ts](../../src/utils/design-md.ts) |
| `designMdModuleSlice(body: string, module: DesignMdModule)` | [design-md.ts](../../src/utils/design-md.ts) |
| `designSystemGenerationJobToProgressCard(job: DesignSystemGenerationJobLike)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `detectActiveTrigger(beforeText: string, triggers: readonly RichTextTriggerConfig[],)` | [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `detectInitialLocale(options: DetectInitialLocaleOptions)` | [locale.ts](../../src/features/i18n/locale.ts) |
| `detectLocalTimezone()` | [timezone.ts](../../src/utils/timezone.ts) |
| `diffAddedLines(baseText: string, proposedText: string)` | [rules.ts](../../src/features/revision-review/rules.ts) |
| `dockPlacementEquals(a: DockPlacement, b: DockPlacement)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `drawCaptureTarget(ctx: CanvasRenderingContext2D, scaleX: number, scaleY: number, target: CaptureTarget \| null,)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `drawNormalizedBox(ctx: CanvasRenderingContext2D, box: NormalizedRect, width: number, height: number)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `drawTextMarks(ctx: CanvasRenderingContext2D, marks: readonly TextMark[], width: number, height: number)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `dropEdgeForClientY(clientY: number, targetRect: { top: number; height: number })` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `effectivePreviewScale(preset: ViewportPreset, previewScale: number, canvasSize: PreviewCanvasSize \| undefined, canvasPadding: number,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `emptySketchScene(name?: string)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `emptySourceDraft(fieldSpecs: readonly SourceFieldSpec[])` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `enabledPatch(enabled: boolean)` | [rules.ts](../../src/features/memory/rules.ts) |
| `enhanceSketchExcalidrawPortals(closeLabel: string, onClose: () => void, domTextOverrides: SketchDomTextOverrides \| undefined, insertLabelPattern: RegExp,)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `escapeHtmlAttribute(value: string)` | [html-utils.ts](../../src/renderers/html-utils.ts) |
| `eventHitsModalWindowDragStrip(event: MouseEvent \| PointerEvent, backdropSelector: string,)` | [useModalWindowDragGuard.ts](../../src/browser/useModalWindowDragGuard.ts) |
| `exportViaHttp({ exportPath, filenamePrefix }: { exportPath: string; filenamePrefix: string }, { fetch }: { fetch?: typeof globalThis.fetch } = {},)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `exportedImageFileName(fileName: string, sourceExtension?: string)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `exportedImageResultFileName(result: SketchExportImageResult, fallback: string)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `extensionForMimeType(mimeType: string)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `externalLocations(locations: readonly ProjectLocation[])` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `extractMarkdownBlockLines(markdown: string)` | [markdown-scroll-sync.ts](../../src/utils/markdown-scroll-sync.ts) |
| `extractionCardMeta(record: MemoryExtractionRecord, now: number, t: Translate)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `extractionCardTitle(record: MemoryExtractionRecord, t: Translate)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `fallbackFilename(prefix: string)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `fallbackLogoInitials(name: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `fallbackLogoPaletteIndex(seed: string, paletteSize: number)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `faviconUrl(url: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `fileDropzoneExtension(file: File)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneExtensionLabel(file: File)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneFontFamilyName(file: File, index: number)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneKind(file: File)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneNeedsObjectUrl(kind: FileDropzoneKind)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneShouldShowProcessing(files: readonly File[], fileCountThreshold: number, totalBytesThreshold: number,)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneSizeLabel(bytes: number)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileDropzoneStagingKey(file: File)` | [rules.ts](../../src/features/file-dropzone/rules.ts) |
| `fileExtensionLabel(path: string)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `fileNameFromHeader(header: string \| null)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `filesFromClipboardData(clipboardData: DataTransfer \| null)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `filesFromDataTransfer(dataTransfer: DataTransfer)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `filesFromFileSystemEntry(entry: FileSystemEntry)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `filterAgentModelOptions(options: readonly AgentModelOption[], query: string, selectedValue: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `filterBoardItemsByQuery(items: readonly TItem[], query: string)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `filterByKind(items: readonly TAsset[], filterValue: string, matches: (asset: TAsset, filterValue: string) => boolean,)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `filterFiles(files: readonly TabLauncherResultItem[], query: string, kindFilter: string,)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `filterMentionItems(items: T[], query: string, getSearchText: (item: T) => string = (item) => item.label, maxResults: number = DEFAULT_MAX_RESULTS_PER_CATEGORY,)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `filterOnboardingOptions(options: OnboardingDropdownOption[], query: string, searchable: boolean,)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `filterSkills(skills: readonly SkillSummary[], filters: SkillFilters, locale: string,)` | [rules.ts](../../src/features/skills/rules.ts) |
| `filterTabs(tabs: readonly TabLauncherResultItem[], query: string, kindFilter: string, maxResults: number = MAX_TAB_RESULTS,)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `filterVersionsBySearch(versions: readonly TVersion[], search: string, describe: (version: TVersion) => string,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `filterVisibleActionGroups(groups: HeaderMenuAction[][])` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `findActiveView(views: readonly V[], activeId: string,)` | [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `findSelectedItem(items: readonly TItem[], selectedId: string \| null,)` | [rules.ts](../../src/features/list-detail-panel/rules.ts) |
| `findSketchMermaidInsertButton(content: HTMLElement, insertLabelPattern: RegExp)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `findStaleAuthorizations(pendingBeforeReload: ConnectorAuthorizationPendingState, statuses: ConnectorStatusMap, nowMs: number,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `findViewportPreset(presets: readonly ViewportPreset[], id: string)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `firstLogoStage(opts: { canUseBrandStage: boolean; logoSrc?: string \| null \| undefined; host?: string \| undefined; })` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `flattenCustomSelectOptions(items: CustomSelectItem[])` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `foldPresentMentions(text: string, present: MentionEntity[], known: MentionEntity[],)` | [mention-parser.ts](../../src/features/lexical-rich-text-editor/mention-parser.ts) |
| `folderPathsFromDataTransfer(dataTransfer: DataTransfer, port: FolderPathDropPort)` | [rules.ts](../../src/features/folder-path-drop/rules.ts) |
| `formatAbsoluteTime(at: number, now: number)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `formatAddressDisplay(url: string, title?: string, homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title,)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `formatAddressDisplayParts(url: string, title?: string, homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title,)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `formatConnectorContextBytes(bytes: number)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `formatDroppedFolderPaths(paths: readonly string[])` | [rules.ts](../../src/features/folder-path-drop/rules.ts) |
| `formatDuration(record: MemoryExtractionRecord)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `formatJsonTextForDisplay(text: string, isJsonLike: boolean)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `formatRelativeTime(at: number, now: number)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `formatRelativeTimeAgo(at: number, now: number)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `formatRevisionTimestamp(value: string)` | [rules.ts](../../src/features/revision-review/rules.ts) |
| `formatSkillFileSize(bytes: number)` | [rules.ts](../../src/features/skills/rules.ts) |
| `formatTime12h(time: string)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `formatToolsBadge(count: number)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `formatVersionDateTime(value: number \| undefined, locale: string)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `generateInstallationId()` | [rules.ts](../../src/features/privacy/rules.ts) |
| `getConnectorDisplayToolCount(connector: Connector)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `getConnectorSearchScore(connector: Connector, query: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `getDisplayableConnectorAccountLabel(connector: Connector)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `getDocumentBody()` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `getViewportSize()` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `groupByDay(items: readonly TAsset[], getDayKey: (asset: TAsset) => string,)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `groupFilesByKind(files: readonly TFile[], sectionOrder: readonly string[], getKind: (file: TFile) => string, getModifiedAt: (file: TFile) => number,)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `groupItemsByCategory(items: T[], categories: MentionCategory[], activeFilter: MentionCategoryFilter = ALL_CATEGORY_FILTER, maxItemsPerCategory: number = DEFAULT_MAX_RESULTS_PER_CATEGORY,)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `groupItemsByStatus(items: readonly TItem[], statusOrder: readonly string[], options?: { defaultStatus?: string; normalizeStatus?: (status: string) => string; },)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `groupPresets(presets: readonly ProviderPreset[])` | [rules.ts](../../src/features/execution/rules.ts) |
| `handleSketchPortalCommandEnter(event: KeyboardEvent, insertLabelPattern: RegExp)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `hasAnyCategory(skills: readonly SkillSummary[])` | [rules.ts](../../src/features/skills/rules.ts) |
| `hasAnyConfiguredProvider(providers: MediaProviderMap \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `hasAnyResults(groups: MentionResultGroup<T>[])` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `hasConnectorStatusChanges(current: Connector[], statuses: ConnectorStatusMap)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `hasLoadedAllAdvertisedConnectorTools(connector: Connector)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `hasMadeConsentDecision(state: Pick<PrivacyConsentState, 'privacyDecisionAt'>)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `hasPrecisionSensitiveJsonNumberText(text: string)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `hasRecoverableFields(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `hasUnsafeJsonNumber(value: unknown)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `headerMenuItemAriaChecked(active: boolean \| undefined)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `headerMenuItemBusy(item: HeaderMenuAction)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `headerMenuItemDisabled(item: HeaderMenuAction)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `headerMenuItemIcon(item: HeaderMenuAction)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `headerMenuItemRole(active: boolean \| undefined)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `hexToRgb({ hex }: { hex: string })` | [color-math.ts](../../src/utils/color-math.ts) |
| `historyStorageKey(namespace: string, scopeKey: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `homeConfigPath(platform: McpInstallPlatform, posix: string, windows: string)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `hostnameFromUrl(url: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `htmlNeedsFocusGuard(source: string)` | [url-load-decision.ts](../../src/renderers/url-load-decision.ts) |
| `htmlNeedsSandboxShim(source: string)` | [url-load-decision.ts](../../src/renderers/url-load-decision.ts) |
| `humanBytes(n: number)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `humanFileSize(bytes: number)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `humanizeSkillCategory(slug: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `initialNavigationState(initialUrl?: string, initialTitle?: string, homeEntry: BrowserNavigationEntry = DEFAULT_HOME_NAVIGATION_ENTRY,)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `injectAfterHeadOpen(doc: string, payload: string)` | [build.ts](../../src/renderers/srcdoc/build.ts) |
| `injectAfterHeadOpenStringOnly(doc: string, payload: string)` | [html-utils.ts](../../src/renderers/html-utils.ts) |
| `injectBaseHref(doc: string, baseHref: string)` | [sandboxed-document.ts](../../src/renderers/sandboxed-document.ts) |
| `injectBeforeBodyEnd(doc: string, payload: string)` | [build.ts](../../src/renderers/srcdoc/build.ts) |
| `injectBeforeBodyEndStringOnly(doc: string, payload: string)` | [html-utils.ts](../../src/renderers/html-utils.ts) |
| `injectBeforeHeadEnd(doc: string, payload: string)` | [build.ts](../../src/renderers/srcdoc/build.ts) |
| `injectBeforeHeadEndStringOnly(doc: string, payload: string)` | [html-utils.ts](../../src/renderers/html-utils.ts) |
| `insertMentionToken(value: string, match: MentionTriggerMatch \| null, token: string,)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `installBootTimingObserver(options: BootTimingOptions = {})` | [boot-timing.ts](../../src/features/observability/boot-timing.ts) |
| `installLongTaskObserver(options: LongTaskObserverOptions = {})` | [long-task.ts](../../src/features/observability/long-task.ts) |
| `installRemixIconStylesheet(options: { href: string })` | [RemixIcon.tsx](../../src/react/components/RemixIcon.tsx) |
| `installResourceErrorObserver(options: ResourceErrorObserverOptions = {},)` | [resource-error.ts](../../src/features/observability/resource-error.ts) |
| `installVisibilityObserver(options: VisibilityObserverOptions = {})` | [visibility.ts](../../src/features/observability/visibility.ts) |
| `installWhiteScreenDetector(options: WhiteScreenDetectorOptions = {})` | [white-screen.ts](../../src/features/observability/white-screen.ts) |
| `invalidBaseUrlProviderIds(providers: MediaProviderMap \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `isAboutUpdateActionDisabled(control: AboutUpdateControl, model: UpdaterModel, actionBusy = false,)` | [rules.ts](../../src/features/about/rules.ts) |
| `isActionPending(pendingKeys: ReadonlySet<string>, id: string, kind: SourceActionKind,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `isBaseUrlInvalid(config: ByokConfig)` | [rules.ts](../../src/features/execution/rules.ts) |
| `isBuiltInSkill(skill: SkillSummary)` | [rules.ts](../../src/features/skills/rules.ts) |
| `isCategoryVisible(activeFilter: MentionCategoryFilter, categoryId: string)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `isClosedLoop(points: readonly Point[], closeThreshold = 28)` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `isCustomSelectEventInside(target: Node, button: HTMLElement \| null, menu: HTMLElement \| null,)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `isCustomSelectGroup(item: CustomSelectItem)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `isDeletableSkill(skill: SkillSummary)` | [rules.ts](../../src/features/skills/rules.ts) |
| `isDoubleActivation(lastTimestampMs: number \| undefined, nowMs: number, windowMs: number = DOUBLE_ACTIVATION_WINDOW_MS,)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `isDuplicatePath(candidatePath: string, locations: readonly ProjectLocation[], exceptId?: string,)` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `isEntryEmpty(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `isEntryPresent(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `isExcalidrawUnableToEmbedToast(message: string, additionalPhrases: readonly string[] = [])` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `isFileSystemReadError(error: unknown)` | [file-system-errors.ts](../../src/utils/file-system-errors.ts) |
| `isFullHtmlDocument(html: string)` | [sandboxed-document.ts](../../src/renderers/sandboxed-document.ts) |
| `isHeaderMenuDismissKey(key: string)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `isHistoryEntry(value: unknown)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `isHistoryUrl(url: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `isImeComposing(event: ReactKeyboardEvent<HTMLInputElement \| HTMLTextAreaElement>, composing: boolean,)` | [ime-composing.ts](../../src/utils/ime-composing.ts) |
| `isJsonRpcMessage(required: { value: unknown }, _optional: Record<string, never> = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `isJsonRpcRequest(required: { message: JsonRpcMessage }, _optional: Record<string, never> = {})` | [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `isKnownZoomLevel(zoom: number, levels: readonly number[])` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `isLanguageMenuDismissKey(key: string)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `isMacPlatform()` | [platform.ts](../../src/utils/platform.ts) |
| `isMarkerOnlyEntry(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `isMcpInstallPrerequisiteMissing(info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `isMentionBoundary(text: string, start: number)` | [mention-parser.ts](../../src/features/lexical-rich-text-editor/mention-parser.ts) |
| `isMentionRightBoundary(text: string, end: number)` | [mention-parser.ts](../../src/features/lexical-rich-text-editor/mention-parser.ts) |
| `isNonDeletedExcalidrawElement(element: unknown)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `isOutsideHeaderMenu(container: HTMLElement \| null, target: EventTarget \| null,)` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `isOutsideLanguageMenu(container: HTMLElement \| null, target: EventTarget \| null,)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `isProviderBaseUrlInvalid(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `isProviderConfigured(config: ByokConfig, preset: ProviderPreset \| null)` | [rules.ts](../../src/features/execution/rules.ts) |
| `isRestoreDisabled(input: RestoreDisabledInput<TVersion>,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `isSharingEnabled(telemetry: TelemetryPreferences)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `isTodoWriteToolName(name: string)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `isTooltipTarget(el: Element \| null)` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `isTrustedConnectorCallbackOrigin(origin: string, currentOrigin: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `isTypingTarget(el: Element \| null)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `isValidApiBaseUrl(raw: string)` | [rules.ts](../../src/features/execution/rules.ts) |
| `isVisualStabilityMode(storageKey: string = DEFAULT_VISUAL_STABILITY_STORAGE_KEY,)` | [visual-stability.ts](../../src/utils/visual-stability.ts) |
| `issueForField(validation: SourceDraftValidation, fieldKey: string,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `labelFromUrl(url: string, homeLabel: string = DEFAULT_HOME_NAVIGATION_ENTRY.title)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `languageMenuItemClassName(active: boolean)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `languageMenuPillClassName(compact: boolean)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `languageMenuPopoverClassName(placement: 'up' \| 'down', compact: boolean, align: 'start' \| 'end',)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `lassoSelectionHitsRect(input: LassoHitTestInput)` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `latestStatusDetailFromAgentEvents(events: AgentEventLike[])` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `latestTodosFromAgentEvents(events: AgentEventLike[] \| undefined)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `lineIntersectsLine(a1: Point, a2: Point, b1: Point, b2: Point)` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `listSupportedTimezones()` | [timezone.ts](../../src/utils/timezone.ts) |
| `localDayKey(date: Date)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `localizedSkillDescription(skill: SkillSummary, locale: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `localizedSkillName(skill: SkillSummary, locale: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `locationLabel(locationPath: string)` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `luminance({ hex }: { hex: string })` | [color-math.ts](../../src/utils/color-math.ts) |
| `mapScrollPosition(value: number, source: number[], target: number[])` | [markdown-scroll-sync.ts](../../src/utils/markdown-scroll-sync.ts) |
| `maskFieldValue(kind: SourceFieldSpec['kind'], value: string)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `maskedKeyLabel(entry: MediaProviderCredentials \| null \| undefined)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `measureEditorBlockOffsets(textarea: HTMLTextAreaElement, blockLines: number[], text: string,)` | [markdown-scroll-sync.ts](../../src/utils/markdown-scroll-sync.ts) |
| `measurePreviewBlockOffsets(pane: HTMLElement, blockCount: number, previewSelector = '.markdown-rendered',)` | [markdown-scroll-sync.ts](../../src/utils/markdown-scroll-sync.ts) |
| `memoryCountLabel(count: number)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `memoryEntryIdForConnectorSuggestion(suggestion: MemorySuggestion)` | [rules.ts](../../src/features/memory/rules.ts) |
| `memoryFlashLabels(t: Translate)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `memorySourceTabs(t: Translate)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `memoryTypeLabels(t: Translate)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `mentionSelectionKey(categoryId: string, itemId: string)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `mentionTokenPresent(text: string, label: string)` | [mention-parser.ts](../../src/features/lexical-rich-text-editor/mention-parser.ts) |
| `mergeBounds(rects: ReadonlyArray<Rect \| null \| undefined>)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `mergeConnectorActionResult(current: Connector, next: Connector)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `mergeConnectorToolPreview(current: Connector, next: Connector, append: boolean)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `mergeConnectors(current: Connector[], incoming: Connector[])` | [rules.ts](../../src/features/connectors/rules.ts) |
| `mergeDaemonProviders(localProviders: MediaProviderMap \| null \| undefined, daemonProviders: MediaProviderMap \| null \| undefined, options?: { preserveLocalProviderIds?: ReadonlySet<string>; dropProviderIds?: ReadonlySet<string> },)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `mergeHistoryEntry(history: BrowserHistoryEntry[], url: string, meta: MergeHistoryEntryMeta = {}, options: MergeHistoryEntryOptions = {}, now: number = Date.now(),)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `mergeIngestedAssets(prev: TAsset[], fetched: readonly TAsset[],)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `mergeRects(rects: ReadonlyArray<Rect>)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `methodLabelForClient(clientId: McpClientId)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `missingRequiredFields(config: ByokConfig, preset: ProviderPreset \| null,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `mixHex({ hex, other, weight }: { hex: string; other: string; weight: number })` | [color-math.ts](../../src/utils/color-math.ts) |
| `modelIdForReasoningLevel(group: ReasoningModelGroup, level: string \| null)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForAgentCliEnvChange(config: ExecutionConfig, agentId: string, envKey: string, rawValue: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForAgentModel(config: ExecutionConfig, agentId: string, model: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForAgentReasoning(config: ExecutionConfig, agentId: string, reasoning: string,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForAgentSelect(config: ExecutionConfig, agentId: string)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForModeChange(config: ExecutionConfig, mode: ExecutionMode,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForPresetSelect(config: ByokConfig, preset: ProviderPreset)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextConfigForProtocolSelect(config: ByokConfig, protocol: ByokConfig['protocol'],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `nextCursor(current: number, total: number, direction: 1 \| -1)` | [rules.ts](../../src/features/command-palette/rules.ts) |
| `nextCustomSelectActiveValue(enabledOptions: CustomSelectFlatOption[], activeValue: string, direction: 1 \| -1,)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `nextExistingAncestorDir(files: readonly TFile[], folders: readonly AssetTreeFolderItem[], currentDir: string,)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `nextPaletteSelection(selected: PaletteId \| null, id: PaletteId,)` | [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `nextSelected(current: number, count: number, direction: 1 \| -1)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `nextStateForDeclineAll(state: PrivacyConsentState, now: number)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `nextStateForDeleteMyData(state: PrivacyConsentState, now: number, newInstallationId: () => string = generateInstallationId,)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `nextStateForShareAll(state: PrivacyConsentState, now: number, newInstallationId: () => string = generateInstallationId,)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `nextStateForTelemetryPatch(state: PrivacyConsentState, patch: Partial<TelemetryPreferences>, now: number, newInstallationId: () => string = generateInstallationId,)` | [rules.ts](../../src/features/privacy/rules.ts) |
| `normalizeBrowserAddress(rawAddress: string, options: NormalizeBrowserAddressOptions = {})` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `normalizeDesignMdModuleDraft(module: DesignMdModule, draft: string)` | [design-md.ts](../../src/utils/design-md.ts) |
| `normalizeHex({ value }: { value: string \| undefined })` | [color-math.ts](../../src/utils/color-math.ts) |
| `normalizePastedFile(file: File)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `normalizeTooltipLabel(value: string \| null \| undefined)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `normalizedRectFromPoints(a: Point, b: Point)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `notificationPermission()` | [notifications.ts](../../src/utils/notifications.ts) |
| `onboardingEmptyMessageKey(searchable: boolean)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `openExternalUrl(url: string)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `openSandboxedPreviewInNewTab(html: string, title: string, options: NewTabPreviewOptions = {},)` | [new-tab-preview.ts](../../src/renderers/new-tab-preview.ts) |
| `orderContextMenuActions(actionNames: readonly string[], allowList: readonly string[])` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `paletteItemClassName(state: { selected: boolean; hovered: boolean; })` | [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `parseConnectorAuthorizationPendingState(raw: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `parseDeckStateMessage(data: unknown)` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `parseForceInline(search: string \| URLSearchParams \| null \| undefined)` | [url-load-decision.ts](../../src/renderers/url-load-decision.ts) |
| `parseHistoryPayload(raw: string, limit: number = HISTORY_LIMIT)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `parseLiveUpdateAssetId(data: unknown, idField = 'id')` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `parseMaxTokens(raw: string)` | [rules.ts](../../src/features/execution/rules.ts) |
| `parseProviderError(raw: string)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `parseRecentIds(raw: string)` | [rules.ts](../../src/features/command-palette/rules.ts) |
| `parseSseFrame({ frame }: { frame: string })` | [sse.ts](../../src/utils/sse.ts) |
| `parseTodoWriteInput(input: unknown)` | [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `parseTriggers(raw: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `pathIntersectsRect(points: readonly Point[], rect: Rect)` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `pendingActionKey(id: string, kind: SourceActionKind)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `playSound(id: SoundId)` | [notifications.ts](../../src/utils/notifications.ts) |
| `pointInPolygon(point: Point, polygon: readonly Point[])` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `positionTooltip(target: HTMLElement, tooltip: HTMLElement, placement: TooltipPlacement,)` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `presentKinds(items: readonly TabLauncherResultItem[])` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `presetRequiresApiKey(preset: ProviderPreset \| null)` | [rules.ts](../../src/features/execution/rules.ts) |
| `presetsForProtocol(presets: readonly ProviderPreset[], protocol: ByokConfig['protocol'],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `previewFailure(id: SoundId)` | [notifications.ts](../../src/utils/notifications.ts) |
| `previewScaleShellStyle(preset: ViewportPreset, previewScale: number,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `previewSuccess(id: SoundId)` | [notifications.ts](../../src/utils/notifications.ts) |
| `previewViewportStyle(preset: ViewportPreset, effectiveScale: number, previewScale: number,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `progressBarAriaValueNow(progress: number \| 'indeterminate')` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `progressBarWidthPercent(progress: number \| 'indeterminate')` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `progressCardItemIcon(status: ProgressStatus)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `progressCardStatusIcon(status: ProgressStatus)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `progressCardStatusLabel(status: ProgressStatus)` | [rules.ts](../../src/features/progress-card/rules.ts) |
| `providerDisplayName(provider: MemoryExtractionRecord['provider'] \| undefined)` | [formatters.ts](../../src/features/memory/formatters.ts) |
| `pruneConnectorAuthorizationPending(pending: ConnectorAuthorizationPendingState, nowMs: number,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `pruneMissingPaths(prev: Set<string>, livePaths: Iterable<string>)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `pruneMissingSelection(prev: Set<string>, items: readonly TAsset[],)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `pruneSelectedIds(selected: ReadonlySet<string>, validIds: ReadonlySet<string>)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `pushRecentId(previous: readonly string[], id: string, limit: number)` | [rules.ts](../../src/features/command-palette/rules.ts) |
| `rangeSelection(prev: ReadonlySet<string>, items: readonly TAsset[], anchorIndex: number, targetIndex: number,)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `rankItems(items: readonly CommandPaletteItem[], query: string, recentIds: readonly string[],)` | [rules.ts](../../src/features/command-palette/rules.ts) |
| `readDefaultSketchToolColor()` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `readExcalidrawTheme()` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `readMentionTrigger(value: string, cursor: number, triggerChar: string = DEFAULT_TRIGGER_CHAR,)` | [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `readOnboardingViewportHeight()` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `readSavedWidth(storageKey: string, defaultWidth: number, min: number, max: number)` | [useResizableSplitPane.ts](../../src/react/hooks/useResizableSplitPane.ts) |
| `readTooltipTarget(start: EventTarget \| null)` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `readableTextColor({ hex }: { hex: string })` | [color-math.ts](../../src/utils/color-math.ts) |
| `reasoningModelGroupFor(groups: readonly ReasoningModelGroup[], modelId: string, levelIds: readonly string[],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `reasoningModelGroups(models: readonly AgentModelOption[], levels: readonly AgentModelOption[],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `reconcileCustomSelectActiveValue(input: CustomSelectActiveReconcileInput,)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `recordNavigation(state: BrowserNavigationState, url: string, title?: string, options: RecordNavigationOptions = {},)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `rectContains(outer: Rect, inner: Rect)` | [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `rectsOverlap(a: Rect, b: Rect)` | [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `redrawStrokesAndBoxes(ctx: CanvasRenderingContext2D, input: { strokes: readonly Stroke[]; drawingStroke: Stroke \| null; selectionBoxes: readonly NormalizedRect[]; boxDraft: NormalizedRect \| null; }, width: number, height: number, dpr: number,)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `relativeCommentTimeTranslation(timestampMs: number, nowMs: number = Date.now(),)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `relativeTimeResult(ts: number, nowMs: number = Date.now())` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `removeSketchMermaidShortcutHints(content: HTMLElement, insertLabelPattern: RegExp)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `removeSourceById(list: readonly TSource[], id: string,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `renderMarkdownToSafeHtml(markdown: string)` | [markdown.ts](../../src/renderers/renderers/markdown.ts) |
| `reorderCommentIds(ids: string[], draggingId: string, targetId: string, edge: CommentSideDropEdge,)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `replaceDesignMdModule(body: string, module: DesignMdModule, draft: string)` | [design-md.ts](../../src/utils/design-md.ts) |
| `requestNotificationPermission()` | [notifications.ts](../../src/utils/notifications.ts) |
| `resolveActiveLocaleLabel(locales: LocaleOption[], locale: string)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `resolveCheckboxClickAction(modifiers: { shiftKey: boolean })` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `resolveDefaultLocationId(configuredId: string \| null \| undefined, locations: readonly ProjectLocation[],)` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `resolveDefaultSketchToolColor(theme: string \| null, prefersDark: boolean)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `resolveExportLabels(labels?: ExportLabels)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `resolveFacetLabel(value: string, labelsByValue: ReadonlyMap<string, string>)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `resolveGlobalKeydownTarget({ target }: { target: 'window' \| 'document' }, { globals = globalThis }: { globals?: { window?: EventTarget; document?: EventTarget } } = {},)` | [useGlobalKeydown.ts](../../src/browser/useGlobalKeydown.ts) |
| `resolveInitialCustomSelectActiveValue(flatOptions: CustomSelectFlatOption[], enabledOptions: CustomSelectFlatOption[], value: string,)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `resolveInitialViewId(views: readonly V[], initialViewId: string \| undefined,)` | [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `resolveKindConfig(kind: string, kindConfig: AssetTreeKindConfigMap)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `resolveListDetailSelection(items: readonly TItem[], currentId: string \| null,)` | [rules.ts](../../src/features/list-detail-panel/rules.ts) |
| `resolveLogoSrc(opts: { stage: LogoStage; brandId?: string \| undefined; resolveBrandLogoUrl?: ((brandId: string) => string) \| undefined; logoSrc?: string \| null \| undefined; host?: string \| undefined; faviconSize: number; resolveFaviconUrl: (host: string, size: number) => string; })` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `resolveNavigationHistoryDelta(state: BrowserNavigationState, delta: -1 \| 1,)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `resolveOnboardingMenuMetrics(rect: { top: number; bottom: number }, viewportHeight: number, requestedPlacement: OnboardingDropdownPlacement,)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `resolveOnboardingSelectedValues(value: string \| string[])` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `resolveOnboardingTriggerLabel(selectedOptions: OnboardingDropdownOption[], multiple: boolean, placeholder: string,)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `resolvePalettePreview(target: PaletteHoverTarget, selected: PaletteId \| null,)` | [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `resolvePreviewClickAction(modifiers: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; })` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `resolveProviderBaseUrl(entry: MediaProviderCredentials \| null \| undefined, defaultBaseUrl: string \| undefined,)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `resolveRenameCommit(path: string, currentDir: string, draft: string)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `resolveSelectedPreset(presets: readonly ProviderPreset[], config: ByokConfig,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `resolveSelectedVersion(versions: readonly TVersion[], versionById: ReadonlyMap<string, TVersion>, selectedId: string \| null,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `resolveSelection(selected: number, filesCount: number)` | [rules.ts](../../src/features/tab-launcher-menu/rules.ts) |
| `resolveSilentUpdatesWriteFailure(previous: boolean)` | [rules.ts](../../src/features/about/rules.ts) |
| `resolveSilentUpdatesWriteSuccess(value: boolean)` | [rules.ts](../../src/features/about/rules.ts) |
| `resolveSystemLocale(languages: readonly string[], supportedLocales: readonly Locale[],)` | [locale.ts](../../src/features/i18n/locale.ts) |
| `resolveWorkingDirLabels(labels?: WorkingDirLabels)` | [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `restoredFromVersion(version: TVersion \| null \| undefined, versionById: ReadonlyMap<string, TVersion>,)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `rewriteExcalidrawUnableToEmbedToasts(root: HTMLElement, replacement: string, additionalPhrases: readonly string[] = [],)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `sameStyle(left: TooltipState['style'], right: TooltipState['style'],)` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `sameUrl(left: string, right: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `sanitizeExcalidrawAppState(value: Record<string, unknown> \| null,)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `saveWidth(storageKey: string, width: number, min: number, max: number)` | [useResizableSplitPane.ts](../../src/react/hooks/useResizableSplitPane.ts) |
| `saveableDrafts(drafts: readonly ProjectLocationDraft[])` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `sceneContentSignature(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>,)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `sceneFromExcalidraw(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>,)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `scheduleEditorStateFromValue(value: ScheduleValue, base: ScheduleEditorState,)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `scheduleInterval(callback: () => void, ms: number)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `scheduleTimeout(callback: () => void, ms: number)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `scopeConnectorsToProvider(connectors: Connector[], providerTabs: readonly ProviderTab[], selectedProviderId: string,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `scoreItemMatch(item: CommandPaletteItem, query: string)` | [rules.ts](../../src/features/command-palette/rules.ts) |
| `scrollRange(element: { scrollHeight: number; clientHeight: number })` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `scrollRatio(element: { scrollHeight: number; clientHeight: number; scrollTop: number })` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `scrollTabsWithWheel({ tabBar, event }: { tabBar: Pick<HTMLDivElement, 'clientWidth' \| 'scrollLeft' \| 'scrollWidth'>; event: Pick<globalThis.WheelEvent, 'ctrlKey' \| 'deltaMode' \| 'deltaX' \| 'deltaY' \| 'preventDefault'>; },)` | [scroll-tabs-with-wheel.ts](../../src/utils/scroll-tabs-with-wheel.ts) |
| `scrollTopForRatio(element: { scrollHeight: number; clientHeight: number }, ratio: number,)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `selectAllIds(items: readonly TAsset[])` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `selectAutoOpenProducedArtifact(producedFiles: ReadonlyArray<CandidateFile>, options: SelectAutoOpenOptions = {},)` | [auto-open-file.ts](../../src/utils/auto-open-file.ts) |
| `selectLruEvictions(entries: readonly IframeKeepAlivePoolEntry<TKey>[], activeKeys: ReadonlySet<TKey>, maxMounted: number,)` | [rules.ts](../../src/features/iframe-pool/rules.ts) |
| `selectMatchingEvictions(entries: readonly IframeKeepAlivePoolEntry<TKey>[], activeKeys: ReadonlySet<TKey>, predicate: (entry: IframeKeepAlivePoolEntry<TKey>) => boolean, includeActive: boolean,)` | [rules.ts](../../src/features/iframe-pool/rules.ts) |
| `selectedAgentModel(config: LocalCliConfig, agent: DetectedAgent)` | [rules.ts](../../src/features/execution/rules.ts) |
| `selectedAgentReasoning(config: LocalCliConfig, agent: DetectedAgent)` | [rules.ts](../../src/features/execution/rules.ts) |
| `serializeHistoryPayload(history: BrowserHistoryEntry[], limit: number = HISTORY_LIMIT)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `setTooltipAttribute(target: HTMLElement, name: string, value: string)` | [dom.ts](../../src/features/sketch-editor/dom.ts) |
| `settingsShortcut(platform: McpInstallPlatform)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `shouldIgnoreClipboardFilePaste(target: EventTarget \| null)` | [file-transfer.ts](../../src/utils/file-transfer.ts) |
| `shouldShowCustomModelInput(modelValue: string, knownModelIds: readonly string[], explicitCustomMode: boolean,)` | [rules.ts](../../src/features/execution/rules.ts) |
| `shouldShowVersionSearch(versionCount: number, threshold: number)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `shouldSyncLocalProvidersToDaemon(localProviders: MediaProviderMap \| null \| undefined, daemonProviders: MediaProviderMap \| null \| undefined,)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `shouldUrlLoadHtmlPreview(d: UrlLoadDecision, bridgesRequiringSrcDoc: ReadonlySet<string> = new Set(),)` | [url-load-decision.ts](../../src/renderers/url-load-decision.ts) |
| `showCompletionNotification(opts: CompletionNotificationOpts,)` | [notifications.ts](../../src/utils/notifications.ts) |
| `showsBaseUrlField(preset: ProviderPreset \| null)` | [rules.ts](../../src/features/execution/rules.ts) |
| `showsTimeFields(kind: ScheduleKind)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `showsWeekdayGrid(kind: ScheduleKind)` | [rules.ts](../../src/features/schedule-picker/rules.ts) |
| `singleFlagPatch(flag: MemoryConfigFlagKey, value: boolean)` | [rules.ts](../../src/features/memory/rules.ts) |
| `sketchSceneHasContent(scene: SketchScene \| null \| undefined)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `skillFileLeafName(path: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `skillFileTreeIndent(path: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `skillFilterOptions(skills: readonly SkillSummary[], filters: SkillFilters, locale: string, dimension: SkillFilterDimension,)` | [rules.ts](../../src/features/skills/rules.ts) |
| `skillMatchesFilters(skill: SkillSummary, filters: SkillFilters, locale: string, except?: SkillFilterDimension,)` | [rules.ts](../../src/features/skills/rules.ts) |
| `skillMatchesSearch(skill: SkillSummary, query: string, locale: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `slideCounterLabel(state: DeckSlideState \| null)` | [rules.ts](../../src/features/html-viewer/rules.ts) |
| `smoothScrollToTop(container: HTMLElement)` | [smooth-scroll-to-top.ts](../../src/utils/smooth-scroll-to-top.ts) |
| `snapshotCardRects(container: HTMLElement \| null)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `snippetForClient(clientId: McpClientId, serverName: string, info: McpInstallInfo)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `sortBoardItems(items: readonly TItem[], sortOptionValue: string \| undefined)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `sortConnectorsForDisplay(connectors: Connector[])` | [rules.ts](../../src/features/connectors/rules.ts) |
| `sortConnectorsForSearch(connectors: Connector[], query: string)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `sortDetectedAgents(agents: readonly T[],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `sortProvidersByConfigured(catalog: readonly T[], providers: MediaProviderMap \| null \| undefined, pinnedIds: readonly string[] = [],)` | [rules.ts](../../src/features/media-providers/rules.ts) |
| `sortVersionsDescending(versions: readonly TVersion[],)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `sourceConfigActionHandle(base: string, action: string)` | [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `sourceConfigAddFormHandle(listBase: string)` | [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `sourceConfigAgentProps(base: string \| undefined, options: SourceConfigAgentPropsOptions,)` | [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `sourceConfigFieldHandle(base: string, fieldKey: string)` | [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `sourceConfigItemHandles(listBase: string, sourceIds: readonly string[])` | [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `sourceDisplayLabel(source: SourceConfigItem, fieldSpecs: readonly SourceFieldSpec[])` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `splitReasoningModelId(modelId: string, levelIds: readonly string[],)` | [rules.ts](../../src/features/execution/rules.ts) |
| `statusLabel(status: ConnectorStatus)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `statusToneFor(status: string, toneMap: ResourceStatusToneMap \| undefined)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `subscribeOutsideClickOrEscape(container: { current: HTMLElement \| null } \| undefined, onClose: () => void,)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `subscribeVisibleFocusOrVisibilityChange(onVisible: () => void)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `subscribeWindowEvent(eventName: string, onEvent: (event: Event) => void,)` | [dom-subscriptions.ts](../../src/utils/dom-subscriptions.ts) |
| `summaryToDraft(skill: SkillSummary, body: string)` | [rules.ts](../../src/features/skills/rules.ts) |
| `testStatusLabel(result: TestStatus, labels: { testSentLabel: string; testFailedLabel: string })` | [rules.ts](../../src/features/notifications/rules.ts) |
| `textFontSizePx(frameHeight: number)` | [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `toHexByte({ value }: { value: number })` | [color-math.ts](../../src/utils/color-math.ts) |
| `toStoredLocations(locations: readonly ProjectLocation[])` | [rules.ts](../../src/features/project-locations/rules.ts) |
| `toastAriaLive(role: ToastRole)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toastClassName(options: { tone: ToastTone; placement: ToastPlacement; className?: string \| undefined; leaving: boolean; })` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toastEffectiveTtl(code: string \| null \| undefined, ttlMs: number,)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toastFadeDelay(effectiveTtl: number)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toastShouldAutoDismiss(hasDismiss: boolean, effectiveTtl: number,)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toastToneIcon(tone: ToastTone)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `toggleInSet(prev: ReadonlySet<string>, path: string)` | [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `toggleSelectedId(selected: ReadonlySet<string>, id: string)` | [rules.ts](../../src/features/resource-dashboard/rules.ts) |
| `toggleSelection(prev: ReadonlySet<string>, id: string)` | [rules.ts](../../src/features/asset-grid/rules.ts) |
| `toolsBadgeTranslation(count: number)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `tooltipPlacement(target: HTMLElement)` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `translateDomTextValue(value: string, overrides: SketchDomTextOverrides)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `translatedScheduleSummaryLabel(t: I18nContextValue['t'], schedule: ScheduleValue, weekdays?: WeekdayOption[],)` | [ScheduleSummary.tsx](../../src/features/schedule-picker/react/components/ScheduleSummary.tsx) |
| `triggerBrowserDownload(blob: Blob, filename: string)` | [useAssetTreeBatchActions.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeBatchActions.ts) |
| `tzCityLabel(timezone: string)` | [timezone.ts](../../src/utils/timezone.ts) |
| `updateConnectorAuthorizationPendingFromConnectResponse(pending: ConnectorAuthorizationPendingState, response: ConnectorActionResult, nowMs: number,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `updateConnectorAuthorizationPendingFromStatuses(pending: ConnectorAuthorizationPendingState, statuses: ConnectorStatusMap, nowMs: number,)` | [rules.ts](../../src/features/connectors/rules.ts) |
| `updateCurrentNavigationTitle(state: BrowserNavigationState, title?: string)` | [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `updateSourceById(list: readonly TSource[], id: string, patch: Partial<TSource>,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `upsertMemoryConnector(current: Connector[], next: Connector \| null)` | [rules.ts](../../src/features/memory/rules.ts) |
| `upsertSourceById(list: readonly TSource[], next: TSource,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `useActiveLocaleLabel(locales: LocaleOption[], locale: string)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `useAnnotationCanvas(options: UseAnnotationCanvasOptions)` | [useAnnotationCanvas.ts](../../src/renderers/annotation-canvas/react/hooks/useAnnotationCanvas.ts) |
| `useAssetGridData(params: UseAssetGridDataParams<TAsset>,)` | [useAssetGridData.ts](../../src/features/asset-grid/react/hooks/useAssetGridData.ts) |
| `useAssetGridKeyboardShortcuts(params: UseAssetGridKeyboardShortcutsParams)` | [useAssetGridKeyboardShortcuts.ts](../../src/features/asset-grid/react/hooks/useAssetGridKeyboardShortcuts.ts) |
| `useAssetGridLiveUpdates(params: UseAssetGridLiveUpdatesParams<TAsset>,)` | [useAssetGridLiveUpdates.ts](../../src/features/asset-grid/react/hooks/useAssetGridLiveUpdates.ts) |
| `useAssetGridSelection(items: readonly TAsset[],)` | [useAssetGridSelection.ts](../../src/features/asset-grid/react/hooks/useAssetGridSelection.ts) |
| `useAssetTreeBatchActions(params: UseAssetTreeBatchActionsParams)` | [useAssetTreeBatchActions.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeBatchActions.ts) |
| `useAssetTreeClipboardPasteUpload(params: UseAssetTreeClipboardPasteUploadParams)` | [useAssetTreeClipboardPasteUpload.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeClipboardPasteUpload.ts) |
| `useAssetTreeCopyLocalPath(clipboard: AssetTreeClipboardPort, confirmMs: number = COPY_LOCAL_PATH_CONFIRM_MS,)` | [useAssetTreeCopyLocalPath.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeCopyLocalPath.ts) |
| `useAssetTreeDragUpload(onUploadFiles: (files: File[]) => void)` | [useFileDropTarget.ts](../../src/browser/useFileDropTarget.ts) |
| `useAssetTreeNavigation(params: UseAssetTreeNavigationParams<TFile>,)` | [useAssetTreeNavigation.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeNavigation.ts) |
| `useAssetTreePreview(files: readonly TFile[], selectInitialPreviewFile?: (files: TFile[]) => TFile \| null,)` | [useAssetTreePreview.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreePreview.ts) |
| `useAssetTreeRename(params: UseAssetTreeRenameParams<TFile>,)` | [useAssetTreeRename.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeRename.ts) |
| `useAssetTreeRowMenu(dom: AssetTreeDomBridgePort)` | [useAssetTreeRowMenu.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeRowMenu.ts) |
| `useAssetTreeSelection(filesAtCurrentDir: readonly TFile[], currentDir: string, pendingRenamePath?: string \| null,)` | [useAssetTreeSelection.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeSelection.ts) |
| `useAutoClearStatus(clearMs: number = STATUS_CLEAR_MS)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `useBrandLogo(props: BrandLogoProps)` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `useBrowserBridgeRegistration(scopeKey: string \| undefined, handle: BrowserTabHandle \| null, dependencies: { bridgeRegistration: BrowserBridgeRegistrationPort },)` | [useBrowserBridgeRegistration.ts](../../src/features/browser-chrome/react/hooks/useBrowserBridgeRegistration.ts) |
| `useBrowserHistory(scopeKey: string, dependencies: { historyStorage: BrowserHistoryStoragePort }, options: UseBrowserHistoryOptions = {},)` | [useBrowserHistory.ts](../../src/features/browser-chrome/react/hooks/useBrowserHistory.ts) |
| `useBrowserNavigationStack(options: UseBrowserNavigationStackOptions = {})` | [useBrowserNavigationStack.ts](../../src/features/browser-chrome/react/hooks/useBrowserNavigationStack.ts) |
| `useCaretFloatingLayerPosition(caret: CaretRect \| null, open: boolean, boundaryRef?: RefObject<HTMLElement \| null> \| undefined,)` | [useCaretFloatingLayerPosition.ts](../../src/features/lexical-rich-text-editor/react/hooks/useCaretFloatingLayerPosition.ts) |
| `useCodexInstallToggle(port: Pick<McpIntegrationsPort, 'fetchCodexInstallStatus' \| 'installCodexMcp' \| 'uninstallCodexMcp'>,)` | [useCodexInstallToggle.ts](../../src/features/integrations/react/hooks/useCodexInstallToggle.ts) |
| `useCommandPalette(options: UseCommandPaletteOptions, dependencies: { recents: CommandPaletteRecentsPort },)` | [useCommandPalette.ts](../../src/features/command-palette/react/hooks/useCommandPalette.ts) |
| `useCommentReorder(orderedIds: string[], onReorder: ((orderedIds: string[]) => void) \| undefined,)` | [useCommentReorder.ts](../../src/features/viewer-shell/react/hooks/useCommentReorder.ts) |
| `useConnectorAuthorization(port: ConnectorsPort, authPendingStorage: ConnectorAuthPendingStoragePort, authBridge: ConnectorAuthBridgePort, params: UseConnectorAuthorizationParams,)` | [useConnectorAuthorization.ts](../../src/features/connectors/hooks/useConnectorAuthorization.ts) |
| `useConnectorCatalog(port: ConnectorsPort, options: ConnectorCatalogOptions)` | [useConnectorCatalog.ts](../../src/features/connectors/hooks/useConnectorCatalog.ts) |
| `useConnectorDetail(port: ConnectorsPort, params: UseConnectorDetailParams)` | [useConnectorDetail.ts](../../src/features/connectors/hooks/useConnectorDetail.ts) |
| `useCopyToClipboard(clipboard: ViewerClipboardPort, resetMs: number = COPY_FEEDBACK_RESET_MS,)` | [useCopyToClipboard.ts](../../src/features/viewer-shell/react/hooks/useCopyToClipboard.ts) |
| `useCustomSelect({ value, options, onChange, portal, placeholder, onOpenChange, }: UseCustomSelectParams)` | [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `useDeckNavigation(iframeRef: RefObject<HTMLIFrameElement \| null>,)` | [useDeckNavigation.ts](../../src/features/html-viewer/react/hooks/useDeckNavigation.ts) |
| `useDismissablePanel(onOpen?: () => void)` | [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `useExecutionTab({ port, autoDetect = true, describeProbeError = describeErrorMessage, }: UseExecutionTabOptions)` | [useExecutionTab.ts](../../src/features/execution/react/hooks/useExecutionTab.ts) |
| `useExportDiagnostics(props: ExportDiagnosticsButtonProps)` | [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `useFileDialogTracking(onProcessingStart?: () => () => void)` | [useFileDialogTracking.ts](../../src/features/file-dropzone/react/hooks/useFileDialogTracking.ts) |
| `useFileDropzone({ onFiles, onZoneClick, onError, onProcessingStart, enablePaste = false, }: UseFileDropzoneParams)` | [useFileDropzone.ts](../../src/features/file-dropzone/react/hooks/useFileDropzone.ts) |
| `useFileDropzonePreviews(files: readonly File[])` | [useFileDropzonePreviews.ts](../../src/features/file-dropzone/react/hooks/useFileDropzonePreviews.ts) |
| `useFolderPathDropCapture({ port, composer, onFolderPaths, }: UseFolderPathDropCaptureOptions)` | [useFolderPathDropCapture.ts](../../src/features/folder-path-drop/react/hooks/useFolderPathDropCapture.ts) |
| `useHeaderActionsMenu(groups: HeaderMenuAction[][])` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `useHeaderActionsMenuDisclosure()` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `useHeaderActionsMenuDismiss(params: { open: boolean; onDismiss: () => void; containerRef: MutableRefObject<HTMLElement \| null>; })` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `useLanguageMenu(locales: LocaleOption[], locale: string)` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `useLanguageMenuDisclosure()` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `useLanguageMenuDismiss(params: { open: boolean; onDismiss: () => void; containerRef: MutableRefObject<HTMLElement \| null>; })` | [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `useLatestRef(value: T)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `useListDetailSelection(items: readonly TItem[], initialSelectedId: string \| null = null,)` | [useListDetailSelection.ts](../../src/features/list-detail-panel/react/hooks/useListDetailSelection.ts) |
| `useLogoStage(params: { first: LogoStage; logoSrc?: string \| null \| undefined; host?: string \| undefined; canUseBrandStage: boolean; })` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `useMarkdownScrollSync(options: UseMarkdownScrollSyncOptions)` | [useMarkdownScrollSync.ts](../../src/features/viewer-shell/react/hooks/useMarkdownScrollSync.ts) |
| `useMcpInstallInfo(port: Pick<McpIntegrationsPort, 'fetchInstallInfo'>)` | [useMcpInstallInfo.ts](../../src/features/integrations/react/hooks/useMcpInstallInfo.ts) |
| `useMediaProvidersTab({ port, initialProviders }: UseMediaProvidersTabOptions)` | [useMediaProvidersTab.ts](../../src/features/media-providers/react/hooks/useMediaProvidersTab.ts) |
| `useMemoryConfig(port: MemoryConfigPort)` | [useMemoryConfig.hooks.ts](../../src/features/memory/react/hooks/useMemoryConfig.hooks.ts) |
| `useMemoryConnectors(port: MemoryConnectorsPort, coord: MemoryConnectorsCoordination,)` | [useMemoryConnectors.hooks.ts](../../src/features/memory/react/hooks/useMemoryConnectors.hooks.ts) |
| `useMemoryEntries(port: MemoryEntriesPort, coord: MemoryEntriesCoordination)` | [useMemoryEntries.hooks.ts](../../src/features/memory/react/hooks/useMemoryEntries.hooks.ts) |
| `useMemoryExtractions(port: MemoryExtractionsPort)` | [useMemoryExtractions.hooks.ts](../../src/features/memory/react/hooks/useMemoryExtractions.hooks.ts) |
| `useMemoryFlash()` | [useMemoryFlash.hooks.ts](../../src/features/memory/react/hooks/useMemoryFlash.hooks.ts) |
| `useMemoryNavigation()` | [useMemoryNavigation.hooks.ts](../../src/features/memory/react/hooks/useMemoryNavigation.hooks.ts) |
| `useMentionAutocomplete({ value, onValueChange, items, categories, onSelectionChange, triggerChar = DEFAULT_TRIGGER_CHAR, getSearchText, maxResultsPerCategory = DEFAULT_MAX_RESULTS_PER_CATEGORY, }: UseMentionAutocompleteParams<T>)` | [useMentionAutocomplete.ts](../../src/features/mention-autocomplete/react/hooks/useMentionAutocomplete.ts) |
| `useMentionColorStamping(resolveMentionColor?: ((mention: MentionEntity) => string \| undefined) \| undefined,)` | [useMentionColorStamping.ts](../../src/features/lexical-rich-text-editor/react/hooks/useMentionColorStamping.ts) |
| `useOnboardingDropdown(props: OnboardingDropdownProps)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `useOnboardingDropdownPlacement(rootRef: RefObject<HTMLDivElement \| null>, open: boolean, placement: OnboardingDropdownPlacement, optionCount: number,)` | [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `usePaletteDismiss(options: { open: boolean; onClose: () => void; })` | [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `usePaletteHover(options: { open: boolean; selected: PaletteId \| null; onPreview: (id: PaletteId \| null) => void; })` | [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `usePresentMode(dependencies: HtmlViewerDependencies)` | [usePresentMode.ts](../../src/features/html-viewer/react/hooks/usePresentMode.ts) |
| `usePreviewCanvasSize()` | [usePreviewCanvasSize.ts](../../src/features/version-manager/react/hooks/usePreviewCanvasSize.ts) |
| `usePreviewModalShell(options: UsePreviewModalShellOptions<V>,)` | [usePreviewModalShell.ts](../../src/renderers/preview-modal-shell/react/hooks/usePreviewModalShell.ts) |
| `useProjectLocationsTab({ port, defaultLocationId, onDefaultLocationIdChange, }: UseProjectLocationsTabOptions)` | [useProjectLocationsTab.ts](../../src/features/project-locations/react/hooks/useProjectLocationsTab.ts) |
| `useRecentFlyout(panelOpen: boolean)` | [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `useRecurringSchedulePicker({ value, onChange, timezones, }: UseRecurringSchedulePickerParams)` | [useRecurringSchedulePicker.ts](../../src/features/schedule-picker/react/hooks/useRecurringSchedulePicker.ts) |
| `useResolvedLogoSrc(opts: { stage: LogoStage; brandId?: string \| undefined; resolveBrandLogoUrl?: ((brandId: string) => string) \| undefined; logoSrc?: string \| null \| undefined; host?: string \| undefined; faviconSize: number; resolveFaviconUrl: (host: string, size: number) => string; })` | [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `useResourceBoard(params: UseResourceBoardParams<TItem>)` | [useResourceBoard.ts](../../src/features/resource-dashboard/react/hooks/useResourceBoard.ts) |
| `useResourceRowList(params: UseResourceRowListParams<TRow>,)` | [useResourceRowList.ts](../../src/features/resource-dashboard/react/hooks/useResourceRowList.ts) |
| `useRubberBandDrag({ containerRef, selectedIds, setSelectedIds, }: UseRubberBandDragParams)` | [useRubberBandDrag.ts](../../src/features/asset-grid/react/hooks/useRubberBandDrag.ts) |
| `useSandboxBridge(options: UseSandboxBridgeOptions)` | [sandbox-bridge.ts](../../src/renderers/sandbox-bridge.ts) |
| `useSettingsDialogShell({ tabs, initialActiveTabId, activeTabId: controlledActiveTabId, onActiveTabIdChange, onClose, defaultSidebarCollapsed = false, defaultFullscreen = false, }: UseTabbedDialogParams<T>)` | [useTabbedDialog.ts](../../src/features/tabbed-dialog/react/hooks/useTabbedDialog.ts) |
| `useSilentUpdatesToggle({ allowSilentUpdates, onSilentUpdatePreferenceChange, }: UseSilentUpdatesToggleOptions)` | [useSilentUpdatesToggle.ts](../../src/features/about/react/hooks/useSilentUpdatesToggle.ts) |
| `useSketchDomEnhancements({ containerRef, t, domTextOverrides, tooltipTargets = DEFAULT_SKETCH_TOOLTIP_TARGETS, contextMenuActionOrder = DEFAULT_CONTEXT_MENU_ACTION_ORDER, contextMenuRecognizedActions = DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS, embedUnavailableAdditionalPhrases = [], mermaidInsertLabelPattern = DEFAULT_MERMAID_INSERT_LABEL_PATTERN, onCloseActiveDialog, }: UseSketchDomEnhancementsParams)` | [useSketchDomEnhancements.ts](../../src/features/sketch-editor/react/hooks/useSketchDomEnhancements.ts) |
| `useSketchSaveWorkflow(params: UseSketchSaveWorkflowParams)` | [useSketchSaveWorkflow.ts](../../src/features/sketch-editor/react/hooks/useSketchSaveWorkflow.ts) |
| `useSketchScene({ scene, fileName, onSceneChange, onClear }: UseSketchSceneParams)` | [useSketchScene.ts](../../src/features/sketch-editor/react/hooks/useSketchScene.ts) |
| `useSketchTheme()` | [useSketchTheme.ts](../../src/features/sketch-editor/react/hooks/useSketchTheme.ts) |
| `useSkillsTab({ port, locale = 'en' }: UseSkillsTabOptions)` | [useSkillsTab.ts](../../src/features/skills/react/hooks/useSkillsTab.ts) |
| `useSourceConfigAddForm(params: UseSourceConfigAddFormParams<TSource>,)` | [useSourceConfigAddForm.ts](../../src/features/source-config-list/react/hooks/useSourceConfigAddForm.ts) |
| `useSourceConfigList(params: UseSourceConfigListParams<TSource>,)` | [useSourceConfigList.ts](../../src/features/source-config-list/react/hooks/useSourceConfigList.ts) |
| `useTabLauncherMenu(options: UseTabLauncherMenuOptions<TActionCtx>,)` | [useTabLauncherMenu.ts](../../src/features/tab-launcher-menu/react/hooks/useTabLauncherMenu.ts) |
| `useTabbedDialog({ tabs, initialActiveTabId, activeTabId: controlledActiveTabId, onActiveTabIdChange, onClose, defaultSidebarCollapsed = false, defaultFullscreen = false, }: UseTabbedDialogParams<T>)` | [useTabbedDialog.ts](../../src/features/tabbed-dialog/react/hooks/useTabbedDialog.ts) |
| `useToastAutoDismiss(options: UseToastAutoDismissOptions,)` | [Toast.tsx](../../src/react/components/Toast.tsx) |
| `useTooltipLayer()` | [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `useVersionManager(dependencies: VersionManagerDependencies<TVersion>, options: UseVersionManagerOptions<TVersion>,)` | [useVersionManager.ts](../../src/features/version-manager/react/hooks/useVersionManager.ts) |
| `useVisibleActionGroups(groups: HeaderMenuAction[][])` | [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `useWiredAssetGridData(params: UseWiredAssetGridDataParams<TAsset>,)` | [useAssetGridData.ts](../../src/features/asset-grid/react/hooks/useAssetGridData.ts) |
| `useWiredAssetGridLiveUpdates(params: UseWiredAssetGridLiveUpdatesParams<TAsset>,)` | [useAssetGridLiveUpdates.ts](../../src/features/asset-grid/react/hooks/useAssetGridLiveUpdates.ts) |
| `useWiredBrowserBridgeRegistration(scopeKey: string \| undefined, handle: BrowserTabHandle \| null)` | [useBrowserBridgeRegistration.ts](../../src/features/browser-chrome/react/hooks/useBrowserBridgeRegistration.ts) |
| `useWiredBrowserHistory(scopeKey: string, options?: UseBrowserHistoryOptions)` | [useBrowserHistory.ts](../../src/features/browser-chrome/react/hooks/useBrowserHistory.ts) |
| `useWiredCodexInstallToggle()` | [useCodexInstallToggle.ts](../../src/features/integrations/react/hooks/useCodexInstallToggle.ts) |
| `useWiredCommandPalette(options: UseCommandPaletteOptions)` | [useCommandPalette.ts](../../src/features/command-palette/react/hooks/useCommandPalette.ts) |
| `useWiredConnectorsBrowser(params: UseWiredConnectorsBrowserParams)` | [useWiredConnectorsBrowser.ts](../../src/features/connectors/hooks/useWiredConnectorsBrowser.ts) |
| `useWiredCopyToClipboard(resetMs?: number)` | [useCopyToClipboard.ts](../../src/features/viewer-shell/react/hooks/useCopyToClipboard.ts) |
| `useWiredMcpInstallInfo()` | [useMcpInstallInfo.ts](../../src/features/integrations/react/hooks/useMcpInstallInfo.ts) |
| `useWiredMemoryConfig()` | [useMemoryConfig.hooks.ts](../../src/features/memory/react/hooks/useMemoryConfig.hooks.ts) |
| `useWiredMemoryConnectors(coord: MemoryConnectorsCoordination)` | [useMemoryConnectors.hooks.ts](../../src/features/memory/react/hooks/useMemoryConnectors.hooks.ts) |
| `useWiredMemoryEntries(coord: MemoryEntriesCoordination)` | [useMemoryEntries.hooks.ts](../../src/features/memory/react/hooks/useMemoryEntries.hooks.ts) |
| `useWiredMemoryExtractions()` | [useMemoryExtractions.hooks.ts](../../src/features/memory/react/hooks/useMemoryExtractions.hooks.ts) |
| `useWiredPresentMode()` | [usePresentMode.ts](../../src/features/html-viewer/react/hooks/usePresentMode.ts) |
| `useWiredResourceBoard(params: UseWiredResourceBoardParams<TItem>,)` | [useResourceBoard.ts](../../src/features/resource-dashboard/react/hooks/useResourceBoard.ts) |
| `useWiredResourceRowList(params: UseWiredResourceRowListParams<TRow>,)` | [useResourceRowList.ts](../../src/features/resource-dashboard/react/hooks/useResourceRowList.ts) |
| `useWiredSketchSaveWorkflow(params: Omit<UseSketchSaveWorkflowParams, 'engine'>,)` | [useSketchSaveWorkflow.ts](../../src/features/sketch-editor/react/hooks/useSketchSaveWorkflow.ts) |
| `useWiredSourceConfigAddForm(params: UseWiredSourceConfigAddFormParams<TSource>,)` | [useSourceConfigAddForm.ts](../../src/features/source-config-list/react/hooks/useSourceConfigAddForm.ts) |
| `useWiredSourceConfigList(params: UseWiredSourceConfigListParams<TSource>,)` | [useSourceConfigList.ts](../../src/features/source-config-list/react/hooks/useSourceConfigList.ts) |
| `useWiredVersionManager(options: UseVersionManagerOptions<TVersion>, dependencies: VersionManagerDependencies<TVersion> = defaultVersionManagerDependencies as unknown as VersionManagerDependencies<TVersion>,)` | [useVersionManager.ts](../../src/features/version-manager/react/hooks/useVersionManager.ts) |
| `useWorkingDirPicker(input: UseWorkingDirPickerInput)` | [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `useZoomControl(levels: readonly number[] = DEFAULT_ZOOM_LEVELS, initialZoom: number = DEFAULT_ZOOM,)` | [useZoomControl.ts](../../src/features/html-viewer/react/hooks/useZoomControl.ts) |
| `utf8Btoa(s: string)` | [rules.ts](../../src/features/integrations/rules.ts) |
| `validateSketchEmbeddableUrl(link: string)` | [rules.ts](../../src/features/sketch-editor/rules.ts) |
| `validateSkillDraft(draft: SkillDraft)` | [rules.ts](../../src/features/skills/rules.ts) |
| `validateSourceDraft(fieldSpecs: readonly SourceFieldSpec[], values: SourceFieldValues,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `versionSourceClassName(source: VersionSource)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `versionSourceLabel(source: VersionSource)` | [rules.ts](../../src/features/version-manager/rules.ts) |
| `viewMessageBacklogSize()` | [host-message-source.ts](../../src/react/mcp-ui/host-message-source.ts) |
| `visibleExtractionsFor(extractions: MemoryExtractionRecord[], filter: 'all' \| MemoryType,)` | [rules.ts](../../src/features/memory/rules.ts) |
| `visibleSelectedCommentIds(comments: TComment[], selectedIds: ReadonlySet<string>,)` | [rules.ts](../../src/features/viewer-shell/rules.ts) |
| `withPendingAction(pendingKeys: ReadonlySet<string>, id: string, kind: SourceActionKind,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `withoutPendingAction(pendingKeys: ReadonlySet<string>, id: string, kind: SourceActionKind,)` | [rules.ts](../../src/features/source-config-list/rules.ts) |
| `wrapFragmentAsDocument(html: string)` | [sandboxed-document.ts](../../src/renderers/sandboxed-document.ts) |
| `zoomToScale(zoom: number)` | [rules.ts](../../src/features/html-viewer/rules.ts) |

| Additional exported names | Kind and source |
|---|---|
| `A2uiIdsPort`, `ComponentKind`, `ComponentSpec` | type; [protocol.ts](../../src/features/a2ui/protocol.ts) |
| `A2uiSurfaceRendererProps` | type; [renderer.tsx](../../src/features/a2ui/renderer.tsx) |
| `ABOUT_UPDATE_KEYS` | const; [rules.ts](../../src/features/about/rules.ts) |
| `ALL_CATEGORY_FILTER`, `DEFAULT_MAX_RESULTS_PER_CATEGORY`, `DEFAULT_TRIGGER_CHAR` | const; [constants.ts](../../src/features/mention-autocomplete/constants.ts) |
| `ALL_FACET_VALUE`, `ASSET_ID_ATTR`, `ASSET_ID_SELECTOR`, `DEFAULT_LIVE_UPDATE_COALESCE_MS`, `DEFAULT_SEARCH_DEBOUNCE_MS` | const; [constants.ts](../../src/features/asset-grid/constants.ts) |
| `ALL_KIND_FILTER`, `ANCHOR_OFFSET`, `MAX_TAB_RESULTS`, `MENU_WIDTH`, `VIEWPORT_MARGIN` | const; [constants.ts](../../src/features/tab-launcher-menu/constants.ts) |
| `API_KEY_CROSS_VENDOR_WARNING`, `API_KEY_TOO_SHORT_WARNING`, `CUSTOM_MODEL_SENTINEL`, `CUSTOM_PRESET_ID`, `DEFAULT_AGENT_CLI_ENV_FIELDS`, `DEFAULT_AGENT_DESCRIPTIONS`, `DEFAULT_BASE_URL_BY_PROTOCOL`, `DEFAULT_PROVIDER_PRESETS`, `MIN_PLAUSIBLE_API_KEY_LENGTH`, `PROTOCOL_OPTIONS` | const; [constants.ts](../../src/features/execution/constants.ts) |
| `APP_CHROME_FILE_ACTIONS_ID`, `APP_CHROME_FILE_ACTIONS_SELECTOR` | const; [AppChromeHeader.tsx](../../src/react/components/AppChromeHeader.tsx) |
| `AUTHORIZATION_CANCEL_FAILED_MESSAGE`, `CONNECTOR_AUTH_CONTINUE_LABEL`, `CONNECTOR_AUTH_PENDING_POLL_MS`, `CONNECTOR_AUTH_PENDING_STORAGE_KEY`, `CONNECTOR_TOOL_PREVIEW_LIMIT`, `DEFAULT_PROVIDER_TABS`, `DEFAULT_PROVIDER_TAB_ID` | const; [constants.ts](../../src/features/connectors/constants.ts) |
| `AboutAppVersionInfo`, `AboutTabLabels`, `AboutTabProps` | type; [AboutTab.tsx](../../src/features/about/react/components/AboutTab.tsx) |
| `AboutUpdateControl`, `AboutUpdatePrimaryAction`, `AboutUpdateTone`, `AppVersionInfo`, `SilentUpdatesState`, `UpdateKind`, `UpdaterDownloadProgress`, `UpdaterEnvironment`, `UpdaterModel`, `UpdaterState`, `UpdaterStatus` | type; [types.ts](../../src/features/about/types.ts) |
| `AddSourceInput`, `SourceConfigItem`, `SourceDraftIssue`, `SourceDraftValidation`, `SourceFieldOption`, `SourceFieldSpec`, `SourceTestResult`, `SourceTrustOption`, `SourceUpdateInput` | interface; [types.ts](../../src/features/source-config-list/types.ts) |
| `AddressDisplayParts`, `BrowserHistoryEntry`, `BrowserNavigationEntry`, `BrowserNavigationState`, `BrowserTabHandle`, `BrowserViewportId`, `BrowserViewportPreset` | type; [types.ts](../../src/features/browser-chrome/types.ts) |
| `AdminThemeColors`, `ColorScheme` | type; [types.ts](../../src/theme/types.ts) |
| `AgentAuthStatus`, `AgentCliEnvFieldSpec`, `AgentDiagnostic`, `AgentDiagnosticReason`, `AgentDiagnosticSeverity`, `AgentExecutableRepair`, `AgentExecutableSource`, `AgentFixIntent`, `AgentModelOption`, `AgentModelSource`, `AgentScanState`, `AgentSupportsCustomModel`, `AgentTestState`, `ApiKeyWarning`, `ApiProtocol`, `ByokConfig`, `ByokProviderCredentials`, `ByokRequiredField`, `ConnectionTestState`, `ExecutionConfig`, `ExecutionMode`, `LocalCliConfig`, `ModelDiscoveryState`, `ProviderPreset`, `ProviderPresetKind`, `ReasoningModelGroup` | type; [types.ts](../../src/features/execution/types.ts) |
| `AgentCliEnvFieldsProps` | type; [AgentCliEnvFields.tsx](../../src/features/execution/react/components/AgentCliEnvFields.tsx) |
| `AgentDiagnosticRowHandlers`, `AgentDiagnosticRowProps` | type; [AgentDiagnosticRow.tsx](../../src/features/execution/react/components/AgentDiagnosticRow.tsx) |
| `AgentEventLike`, `AgentOtherEventLike`, `AgentStatusEventLike`, `AgentToolResultEventLike`, `AgentToolUseEventLike`, `ChatActivityLike`, `ChatActivityToProgressCardOptions`, `DesignSystemGenerationJobLike`, `DesignSystemGenerationJobStatusLike`, `DesignSystemGenerationJobStepLike`, `FileOpEntryLike`, `FileOpKindLike`, `FileOpStatusLike`, `TodoItemLike`, `TodoStatusLike` | type; [reference-adapters.ts](../../src/features/progress-card/reference-adapters.ts) |
| `AgentMetaLabels` | type; [rules.ts](../../src/features/execution/rules.ts) |
| `AnnotationAction`, `AnnotationSubmitDetail`, `AnnotationSubmitResult`, `CaptureFrameRect`, `CaptureTarget`, `DockPlacement`, `DrawDockLayout`, `DrawDockSide`, `DrawToolbarElement`, `MarkTool`, `NormalizedRect`, `Point`, `PreviewSnapshot`, `Rect`, `Stroke`, `TextMark` | type; [types.ts](../../src/renderers/annotation-canvas/types.ts) |
| `AnnotationCanvasController`, `MarkToolOptionController`, `SubmitOptionController`, `TextMarkController`, `UseAnnotationCanvasOptions` | type; [useAnnotationCanvas.ts](../../src/renderers/annotation-canvas/react/hooks/useAnnotationCanvas.ts) |
| `AnnotationCanvasIconName` | type; [icons.tsx](../../src/renderers/annotation-canvas/react/components/icons.tsx) |
| `AnnotationCanvasPort` | type; [ports.ts](../../src/renderers/annotation-canvas/ports.ts) |
| `AnnotationCanvasProps` | type; [AnnotationCanvas.tsx](../../src/renderers/annotation-canvas/react/components/AnnotationCanvas.tsx) |
| `AppState`, `BinaryFiles`, `ExcalidrawImperativeAPI`, `ExcalidrawInitialDataState`, `ExcalidrawProps`, `OrderedExcalidrawElement`, `SketchEditorDependencies`, `SketchExportToBlobOptions`, `SketchMainMenuComponent`, `SketchMainMenuItemProps` | type; [ports.ts](../../src/features/sketch-editor/ports.ts) |
| `AppearanceTabProps` | type; [AppearanceTab.tsx](../../src/features/appearance/react/components/AppearanceTab.tsx) |
| `AppearanceTheme` | type; [appearance.ts](../../src/utils/appearance.ts) |
| `ArtifactExportKind`, `ArtifactKind`, `ArtifactRendererId`, `ArtifactStatus`, `SandboxBridgeHandler`, `SandboxBridgeMessage`, `SandboxedDocumentOptions`, `SandboxedDocumentResult` | type; [types.ts](../../src/renderers/types.ts) |
| `ArtifactRendererContext` | type; [registry.ts](../../src/renderers/registry.ts) |
| `ArtifactViewSlot`, `ArtifactViewSlotProps` | type; [ArtifactView.tsx](../../src/renderers/react/components/ArtifactView.tsx) |
| `AssetCardProps` | type; [AssetCard.tsx](../../src/features/asset-grid/react/components/AssetCard.tsx) |
| `AssetGridBodyProps` | type; [AssetGridBody.tsx](../../src/features/asset-grid/react/components/AssetGridBody.tsx) |
| `AssetGridDataPort`, `AssetGridDependencies`, `AssetGridLiveUpdateHandlers`, `AssetGridLiveUpdatesPort` | type; [ports.ts](../../src/features/asset-grid/ports.ts) |
| `AssetGridDayGroup`, `AssetGridFacetOption`, `AssetGridItem`, `AssetGridQuery`, `AssetGridSelectors`, `AssetGridViewMode`, `Band`, `CardRect` | type; [types.ts](../../src/features/asset-grid/types.ts) |
| `AssetGridProps` | type; [AssetGrid.tsx](../../src/features/asset-grid/react/components/AssetGrid.tsx) |
| `AssetGridToolbarProps` | type; [AssetGridToolbar.tsx](../../src/features/asset-grid/react/components/AssetGridToolbar.tsx) |
| `AssetTreeBreadcrumbSegment`, `AssetTreeFileItem`, `AssetTreeFolderItem`, `AssetTreeKindConfig`, `AssetTreeKindConfigMap`, `AssetTreeMenuPosition`, `AssetTreeNavState`, `AssetTreeRelativeTime`, `AssetTreeRenameState`, `AssetTreeSection`, `AssetTreeSelectors`, `AssetTreeToolbarAction` | type; [types.ts](../../src/features/asset-tree-browser/types.ts) |
| `AssetTreeBreadcrumbsProps` | type; [AssetTreeBreadcrumbs.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeBreadcrumbs.tsx) |
| `AssetTreeBrowserProps` | type; [AssetTreeBrowser.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeBrowser.tsx) |
| `AssetTreeClipboardPort`, `AssetTreeDependencies`, `AssetTreeDomBridgePort` | type; [ports.ts](../../src/features/asset-tree-browser/ports.ts) |
| `AssetTreeEmptyStateProps` | type; [AssetTreeEmptyState.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeEmptyState.tsx) |
| `AssetTreeFileRowProps` | type; [AssetTreeFileRow.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeFileRow.tsx) |
| `AssetTreeFolderRowProps` | type; [AssetTreeFolderRow.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeFolderRow.tsx) |
| `AssetTreeRowMenuDownload`, `AssetTreeRowMenuProps` | type; [AssetTreeRowMenu.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeRowMenu.tsx) |
| `AssetTreeSelectionBarProps` | type; [AssetTreeSelectionBar.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeSelectionBar.tsx) |
| `AssetTreeToolbarProps` | type; [AssetTreeToolbar.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeToolbar.tsx) |
| `AssetTreeUploadErrorBannerProps` | type; [AssetTreeUploadErrorBanner.tsx](../../src/features/asset-tree-browser/react/components/AssetTreeUploadErrorBanner.tsx) |
| `AsyncCommitGuard` | interface; [async-commit-guard.ts](../../src/features/memory/async-commit-guard.ts) |
| `AudioViewerBodyProps` | type; [AudioViewerBody.tsx](../../src/features/viewer-shell/react/components/AudioViewerBody.tsx) |
| `BROWSER_VIEWPORT_PRESETS`, `DEFAULT_HISTORY_STORAGE_NAMESPACE`, `DEFAULT_HOME_NAVIGATION_ENTRY`, `EMPTY_URL`, `HISTORY_LIMIT`, `HISTORY_SAVE_DEBOUNCE_MS` | const; [constants.ts](../../src/features/browser-chrome/constants.ts) |
| `BooleanField`, `EnumField`, `MultiEnumField`, `NumberField`, `StringField` | interface; [fields.ts](../../src/features/mcp-ui/surfaces/fields.ts) |
| `BootTimingOptions` | type; [boot-timing.ts](../../src/features/observability/boot-timing.ts) |
| `BrandFontManifest`, `BrandFontManifestFile`, `UseBrandFontsOptions` | interface; [useBrandFonts.ts](../../src/react/hooks/useBrandFonts.ts) |
| `BrandLogoProps`, `UseBrandLogoResult`, `UseLogoStageResult` | interface; [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `BrowserBridgeRegistrationPort`, `BrowserHistoryStoragePort` | type; [ports.ts](../../src/features/browser-chrome/ports.ts) |
| `BrowserChromeDependencies` | type; [dependencies.ts](../../src/features/browser-chrome/dependencies.ts) |
| `BrowserHistoryController`, `UseBrowserHistoryOptions` | type; [useBrowserHistory.ts](../../src/features/browser-chrome/react/hooks/useBrowserHistory.ts) |
| `BrowserNavigationController`, `UseBrowserNavigationStackOptions` | type; [useBrowserNavigationStack.ts](../../src/features/browser-chrome/react/hooks/useBrowserNavigationStack.ts) |
| `BrowserSseLiveUpdatesOptions`, `FakeAssetGridDataPortOptions` | type; [dependencies.ts](../../src/features/asset-grid/dependencies.ts) |
| `BrowserViewportControlsProps` | type; [BrowserViewportControls.tsx](../../src/features/browser-chrome/react/components/BrowserViewportControls.tsx) |
| `BufferedWindowMessage` | interface; [early-message-buffer.ts](../../src/features/mcp-ui/early-message-buffer.ts) |
| `ByokProviderFormProps` | type; [ByokProviderForm.tsx](../../src/features/execution/react/components/ByokProviderForm.tsx) |
| `COMMENT_SIDE_DRAG_MIME`, `COPY_FEEDBACK_RESET_MS`, `DEFAULT_VIEWPORT_PRESETS` | const; [constants.ts](../../src/features/viewer-shell/constants.ts) |
| `CONFIRM_DWELL_MS` | const; [confirmation.ts](../../src/features/mcp-ui/surfaces/confirmation.ts) |
| `CONNECTOR_CALLBACK_MESSAGE_TYPE`, `DEFAULT_CONNECTOR_PROVIDER`, `EMPTY_DRAFT`, `MEMORY_CONNECTOR_APP_IDS`, `MEMORY_CONNECTOR_APP_LABELS`, `MEMORY_CONNECTOR_PENDING_AUTH_STORAGE_KEY`, `STARTERS`, `TYPES` | const; [constants.ts](../../src/features/memory/constants.ts) |
| `COPY_LOCAL_PATH_CONFIRM_MS`, `DEFAULT_KIND_CONFIG_MAP`, `DEFAULT_KIND_GLYPH`, `DEFAULT_SECTION_ORDER`, `DOUBLE_ACTIVATION_WINDOW_MS`, `EMPTY_TOOLBAR_ACTIONS`, `ROW_MENU_ESTIMATED_HEIGHT_PX`, `ROW_MENU_SAFE_PADDING_PX` | const; [constants.ts](../../src/features/asset-tree-browser/constants.ts) |
| `CUSTOM_SELECT_FLIP_THRESHOLD`, `CUSTOM_SELECT_MAX_MENU_HEIGHT`, `CUSTOM_SELECT_MENU_GAP`, `CUSTOM_SELECT_MIN_MENU_HEIGHT`, `CUSTOM_SELECT_VIEWPORT_PAD` | const; [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `CanvasContentWrapperNode`, `CanvasStyling` | type; [canvas-style.ts](../../src/features/html-editor/canvas-style.ts) |
| `CanvasEmbedPlaceholderDescriptor` | type; [canvas-embed-placeholders.ts](../../src/features/html-editor/canvas-embed-placeholders.ts) |
| `CaptureFolderPathDropInput`, `FolderPathDropEvent`, `FolderPathDropInsertTarget`, `FolderPathDropInsertTargetRef` | type; [types.ts](../../src/features/folder-path-drop/types.ts) |
| `CaretFloatingLayerPosition` | type; [rules.ts](../../src/features/lexical-rich-text-editor/rules.ts) |
| `CaretFloatingLayerProps` | type; [CaretFloatingLayer.tsx](../../src/features/lexical-rich-text-editor/react/components/CaretFloatingLayer.tsx) |
| `CheckboxClickAction`, `DayHeading`, `PreviewClickAction` | type; [rules.ts](../../src/features/asset-grid/rules.ts) |
| `ClientPickerProps` | type; [ClientPicker.tsx](../../src/features/integrations/react/components/ClientPicker.tsx) |
| `ClipboardWritePort`, `CopyToClipboardOptions` | interface; [copy-to-clipboard.ts](../../src/utils/copy-to-clipboard.ts) |
| `CoalesceOptions` | interface; [useCoalescedCallback.ts](../../src/react/hooks/useCoalescedCallback.ts) |
| `CodeWithLinesProps` | type; [CodeWithLines.tsx](../../src/features/viewer-shell/react/components/CodeWithLines.tsx) |
| `CodexInstallStatus`, `McpClientDescriptor`, `McpClientId`, `McpClientSnippet`, `McpInstallPlatform`, `McpSnippetLanguage`, `McpStdioServerConfig` | type; [types.ts](../../src/features/integrations/types.ts) |
| `CodexInstallToggleButtonProps` | type; [CodexInstallToggleButton.tsx](../../src/features/integrations/react/components/CodexInstallToggleButton.tsx) |
| `CodexInstallToggleController` | type; [useCodexInstallToggle.ts](../../src/features/integrations/react/hooks/useCodexInstallToggle.ts) |
| `ComingSoonNoticeProps` | type; [ComingSoonNotice.tsx](../../src/features/admin-widgets/components/ComingSoonNotice.tsx) |
| `ComingSoonPanelProps` | type; [ComingSoonPanel.tsx](../../src/features/admin-widgets/components/ComingSoonPanel.tsx) |
| `CommandPaletteController`, `UseCommandPaletteOptions` | type; [useCommandPalette.ts](../../src/features/command-palette/react/hooks/useCommandPalette.ts) |
| `CommandPaletteItem`, `CommandPaletteResult` | type; [types.ts](../../src/features/command-palette/types.ts) |
| `CommandPaletteProps` | type; [CommandPalette.tsx](../../src/features/command-palette/react/components/CommandPalette.tsx) |
| `CommandPaletteRecentsPort` | type; [ports.ts](../../src/features/command-palette/ports.ts) |
| `CommandPaletteRowProps` | type; [CommandPaletteRow.tsx](../../src/features/command-palette/react/components/CommandPaletteRow.tsx) |
| `CommentSideDockProps` | type; [CommentSideDock.tsx](../../src/features/viewer-shell/react/components/CommentSideDock.tsx) |
| `CommentSideDragState`, `CommentSideDropEdge`, `MarkdownScrollPane`, `MarkdownSplitPaneMode`, `SegmentedOption`, `ViewerCommentAttachment`, `ViewerCommentBase`, `ViewerFileActionUrls`, `ViewerFileRef`, `ViewportPreset` | type; [types.ts](../../src/features/viewer-shell/types.ts) |
| `CommentSidePanelProps` | type; [CommentSidePanel.tsx](../../src/features/viewer-shell/react/components/CommentSidePanel.tsx) |
| `CompactToggleProps` | interface; [CompactToggle.tsx](../../src/react/components/CompactToggle.tsx) |
| `CompletionNotificationOpts`, `CompletionNotificationResult` | type; [notifications.ts](../../src/utils/notifications.ts) |
| `ComponentKitPreviewProps`, `ComponentKitPreviewThemeTokens`, `ComponentKitPreviewTokens` | interface; [ComponentKitPreview.tsx](../../src/react/components/ComponentKitPreview.tsx) |
| `ComponentKitPreviewThemeMode` | type; [ComponentKitPreview.tsx](../../src/react/components/ComponentKitPreview.tsx) |
| `ConfirmationAlternative`, `ConfirmationChoice`, `ConfirmationToolAction` | interface; [confirmation.ts](../../src/features/mcp-ui/surfaces/confirmation.ts) |
| `ConfirmationBinding`, `ConfirmationRejectionReason` | type; [confirmation-store.ts](../../src/features/mcp-ui/confirmation-store.ts) |
| `ConnectorAction`, `ConnectorAuthorizationPendingState`, `ConnectorStatus`, `ConnectorStatusEntry`, `ConnectorStatusMap` | type; [types.ts](../../src/features/connectors/types.ts) |
| `ConnectorActionResult`, `ConnectorAuthBinding`, `ConnectorAuthResult`, `ConnectorAuthResultEvent`, `ConnectorAuthorizationPending`, `ConnectorPanelAlert`, `ConnectorTool`, `ConnectorToolSafety`, `PendingConnectorAction`, `ProviderTab` | interface; [types.ts](../../src/features/connectors/types.ts) |
| `ConnectorAlertListProps` | type; [ConnectorAlertList.tsx](../../src/features/connectors/components/ConnectorAlertList.tsx) |
| `ConnectorAuthBridgePort`, `ConnectorAuthPendingStoragePort`, `FetchConnectorDetailOptions` | interface; [ports.ts](../../src/features/connectors/ports.ts) |
| `ConnectorAuthorizationController`, `UseConnectorAuthorizationParams` | type; [useConnectorAuthorization.ts](../../src/features/connectors/hooks/useConnectorAuthorization.ts) |
| `ConnectorCardProps` | type; [ConnectorCard.tsx](../../src/features/connectors/components/ConnectorCard.tsx) |
| `ConnectorCatalogController`, `ConnectorCatalogOptions` | type; [useConnectorCatalog.ts](../../src/features/connectors/hooks/useConnectorCatalog.ts) |
| `ConnectorDetailController`, `UseConnectorDetailParams` | type; [useConnectorDetail.ts](../../src/features/connectors/hooks/useConnectorDetail.ts) |
| `ConnectorDetailDrawerProps` | type; [ConnectorDetailDrawer.tsx](../../src/features/connectors/components/ConnectorDetailDrawer.tsx) |
| `ConnectorGateProps` | type; [ConnectorGate.tsx](../../src/features/connectors/components/ConnectorGate.tsx) |
| `ConnectorGridProps` | type; [ConnectorGrid.tsx](../../src/features/connectors/components/ConnectorGrid.tsx) |
| `ConnectorLogoProps` | type; [ConnectorLogo.tsx](../../src/features/connectors/components/ConnectorLogo.tsx) |
| `ConnectorMemoryAttempt`, `ConnectorMemorySuggestionResponse`, `DraftEntry`, `FriendlyExtractionFailure`, `MemoryEntry`, `MemoryEntrySummary`, `MemoryExtractionProvider`, `MemoryExtractionRecord`, `MemoryExtractionsResponse`, `MemoryListResponse`, `MemorySectionProps`, `MemorySourceTab`, `MemorySuggestion`, `MemoryTreeListResponse`, `MemoryTreeNode`, `UpdateMemoryConfigRequest`, `UpsertMemoryRequest` | interface; [types.ts](../../src/features/memory/types.ts) |
| `ConnectorMemoryAttemptStatus`, `FlashKind`, `MemoryExtractionEvent`, `MemoryExtractionPhase`, `MemoryExtractionSkipReason`, `MemoryTab`, `MemoryTreeNodeKind`, `MemoryType` | type; [types.ts](../../src/features/memory/types.ts) |
| `ConnectorSearchBarProps` | type; [ConnectorSearchBar.tsx](../../src/features/connectors/components/ConnectorSearchBar.tsx) |
| `ConnectorsBrowserProps` | type; [ConnectorsBrowser.tsx](../../src/features/connectors/ConnectorsBrowser.tsx) |
| `CustomSelectActiveReconcileInput`, `CustomSelectActiveReconcileResult`, `CustomSelectFlatOption`, `CustomSelectGroup`, `CustomSelectMenuPosition`, `CustomSelectOption`, `CustomSelectProps`, `UseCustomSelectParams`, `UseCustomSelectResult` | interface; [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `CustomSelectItem` | type; [CustomSelect.tsx](../../src/react/components/CustomSelect.tsx) |
| `DECK_NAVIGATE_MESSAGE_TYPE`, `DECK_STATE_MESSAGE_TYPE`, `DEFAULT_ZOOM`, `DEFAULT_ZOOM_LEVELS` | const; [constants.ts](../../src/features/html-viewer/constants.ts) |
| `DEFAULT_ANNOTATION_CANVAS_ICONS` | const; [icons.tsx](../../src/renderers/annotation-canvas/react/components/icons.tsx) |
| `DEFAULT_BOARD_VIEW_MODE`, `DEFAULT_STATUS_TONE`, `UNMATCHED_STATUS_BUCKET` | const; [constants.ts](../../src/features/resource-dashboard/constants.ts) |
| `DEFAULT_CONFIRMATION_TTL_MS` | const; [confirmation-store.ts](../../src/features/mcp-ui/confirmation-store.ts) |
| `DEFAULT_CONTEXT_MENU_ACTION_ORDER`, `DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS`, `DEFAULT_EXCALIDRAW_LANG_CODES`, `DEFAULT_MERMAID_INSERT_LABEL_PATTERN`, `DEFAULT_SKETCH_DARK_TOOL_COLOR`, `DEFAULT_SKETCH_LIGHT_TOOL_COLOR`, `DEFAULT_SKETCH_TOOLTIP_TARGETS`, `EXPORTED_IMAGE_MIME_TYPE`, `SAVED_VISIBLE_MS`, `SKETCH_CONTEXT_MENU_MARGIN`, `SKETCH_TEXT_OVERRIDE_ATTRS` | const; [constants.ts](../../src/features/sketch-editor/constants.ts) |
| `DEFAULT_EXPORT_LABELS`, `STATUS_CLEAR_MS` | const; [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `DEFAULT_FAILURE_SOUND_ID`, `DEFAULT_SUCCESS_SOUND_ID`, `FAILURE_SOUNDS`, `SUCCESS_SOUNDS` | const; [notifications-catalog.ts](../../src/features/notifications/notifications-catalog.ts) |
| `DEFAULT_INITIALIZED_TIMEOUT_MS`, `DEFAULT_TEARDOWN_TIMEOUT_MS` | const; [useMcpUiHost.ts](../../src/react/mcp-ui/useMcpUiHost.ts) |
| `DEFAULT_LOCATION_ID` | const; [rules.ts](../../src/features/project-locations/rules.ts) |
| `DEFAULT_MAX_MOUNTED_IFRAMES` | const; [constants.ts](../../src/features/iframe-pool/constants.ts) |
| `DEFAULT_MCP_CLIENT_ID`, `DEFAULT_MCP_SERVER_NAME`, `MCP_CLIENTS` | const; [constants.ts](../../src/features/integrations/constants.ts) |
| `DEFAULT_MEDIA_PROVIDER_CATALOG` | const; [constants.ts](../../src/features/media-providers/constants.ts) |
| `DEFAULT_NOTIFICATIONS_PREFERENCES` | const; [constants.ts](../../src/features/notifications/constants.ts) |
| `DEFAULT_PREVIEW_CANVAS_PADDING`, `PREVIEW_LOAD_FALLBACK_MS`, `PROMPT_COPY_FEEDBACK_RESET_MS`, `SEARCH_VISIBLE_THRESHOLD` | const; [constants.ts](../../src/features/version-manager/constants.ts) |
| `DEFAULT_PREVIEW_MODAL_ICONS` | const; [icons.tsx](../../src/renderers/preview-modal-shell/react/components/icons.tsx) |
| `DEFAULT_RECENTS_LIMIT`, `DEFAULT_RECENTS_STORAGE_NAMESPACE`, `DEFAULT_SCOPE_KEY`, `MAX_RESULTS` | const; [constants.ts](../../src/features/command-palette/constants.ts) |
| `DEFAULT_SCHEDULE_KINDS`, `DEFAULT_SCHEDULE_MINUTE`, `DEFAULT_SCHEDULE_TIME`, `DEFAULT_SCHEDULE_WEEKDAY`, `DEFAULT_WEEKDAYS` | const; [constants.ts](../../src/features/schedule-picker/constants.ts) |
| `DEFAULT_SRC_DOC_CSP` | const; [build.ts](../../src/renderers/srcdoc/build.ts) |
| `DEFAULT_SURFACE_STATUS_TEXT`, `SURFACE_BASE_CSS`, `SURFACE_CSP`, `SURFACE_NOT_PENDING_ERROR_CODE`, `SURFACE_SCRIPT_PRELUDE`, `SURFACE_STATUS_ELEMENT_ID` | const; [document.ts](../../src/features/mcp-ui/surfaces/document.ts) |
| `DEFAULT_TEST_ID`, `DEFAULT_TRIGGERS` | const; [constants.ts](../../src/features/lexical-rich-text-editor/constants.ts) |
| `DEFAULT_VISUAL_STABILITY_STORAGE_KEY` | const; [visual-stability.ts](../../src/utils/visual-stability.ts) |
| `DEFAULT_WORKING_DIR_LABELS` | const; [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `DRAFT_TEST_SCOPE`, `MASKED_VALUE_MIN_MASK_LENGTH`, `MASKED_VALUE_VISIBLE_SUFFIX_LENGTH`, `MASK_CHAR` | const; [constants.ts](../../src/features/source-config-list/constants.ts) |
| `DRAW_DOCK_GAP`, `DRAW_DOCK_MARGIN`, `DRAW_DOCK_MIN_HEIGHT`, `DRAW_DOCK_MIN_WIDTH`, `MARK_TOOL_OPTION_RULES` | const; [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `DebounceSchedulerPort` | interface; [useDebouncedValue.ts](../../src/react/hooks/useDebouncedValue.ts) |
| `DeckNavigateAction`, `DeckSlideState` | type; [types.ts](../../src/features/html-viewer/types.ts) |
| `DeckNavigationController` | type; [useDeckNavigation.ts](../../src/features/html-viewer/react/hooks/useDeckNavigation.ts) |
| `DeckNavigationControlsProps` | type; [DeckNavigationControls.tsx](../../src/features/html-viewer/react/components/DeckNavigationControls.tsx) |
| `DeleteConfirmDialogProps` | type; [DeleteConfirmDialog.tsx](../../src/features/asset-grid/react/components/DeleteConfirmDialog.tsx) |
| `DesignMdModule`, `DesignMdSlice` | interface; [design-md.ts](../../src/utils/design-md.ts) |
| `DesktopExportBridge`, `ExportDiagnosticsButtonProps`, `UseAutoClearStatusResult`, `UseExportDiagnosticsResult` | interface; [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `DetectInitialLocaleOptions` | type; [locale.ts](../../src/features/i18n/locale.ts) |
| `DismissSubscriptionPort`, `UseDismissOnOutsideOrEscapeOptions` | interface; [useDismissOnOutsideOrEscape.ts](../../src/browser/useDismissOnOutsideOrEscape.ts) |
| `DockPlacementInput`, `MarkToolOptionRule`, `SubmitOptionRule` | type; [rules.ts](../../src/renderers/annotation-canvas/rules.ts) |
| `EMPTY_SKILL_DRAFT` | const; [rules.ts](../../src/features/skills/rules.ts) |
| `EdgeAutoScroll` | interface; [useEdgeAutoScroll.ts](../../src/react/hooks/useEdgeAutoScroll.ts) |
| `ExecutionTabProps` | type; [ExecutionTab.tsx](../../src/features/execution/react/components/ExecutionTab.tsx) |
| `ExportLabels`, `ExportStatus`, `ResolvedExportLabels` | type; [ExportDiagnosticsButton.tsx](../../src/react/components/ExportDiagnosticsButton.tsx) |
| `ExternalMcpTabProps` | type; [ExternalMcpTab.tsx](../../src/features/external-mcp/react/components/ExternalMcpTab.tsx) |
| `FIELD_LABEL_STYLE` | const; [styles.ts](../../src/features/memory/react/styles.ts) |
| `FILE_DIALOG_FOCUS_DELAY_MS`, `FILE_DIALOG_STALE_MS`, `FILE_DIALOG_WARMUP_MS`, `FILE_DROPZONE_FONT_PANGRAM`, `FILE_DROPZONE_FONT_SPECIMEN`, `FILE_DROPZONE_GLYPH_ICON`, `FILE_DROPZONE_KIND_BY_EXTENSION`, `FILE_DROPZONE_PROCESSING_BYTES_THRESHOLD`, `FILE_DROPZONE_PROCESSING_FILE_COUNT_THRESHOLD`, `FILE_DROPZONE_PROCESSING_MIN_VISIBLE_MS`, `FILE_DROPZONE_TEXT_PREVIEW_BYTES`, `FILE_DROPZONE_TEXT_THUMB_CHARS` | const; [constants.ts](../../src/features/file-dropzone/constants.ts) |
| `FILE_SYSTEM_READ_ERROR_MESSAGE` | const; [file-system-errors.ts](../../src/utils/file-system-errors.ts) |
| `FORCE_LIGHT_SURFACE_THEME`, `SURFACE_TOKENS`, `SURFACE_TOKENS_DARK` | const; [tokens.ts](../../src/features/mcp-ui/surfaces/tokens.ts) |
| `FakeAssetTreeDependenciesOptions` | type; [dependencies.ts](../../src/features/asset-tree-browser/dependencies.ts) |
| `FakeConnectorsPortOptions` | type; [dependencies.ts](../../src/features/connectors/dependencies.ts) |
| `FakeExecutionPortOptions` | type; [dependencies.ts](../../src/features/execution/dependencies.ts) |
| `FakeMcpIntegrationsPortOptions` | type; [dependencies.ts](../../src/features/integrations/dependencies.ts) |
| `FakeMediaProvidersPortOptions` | type; [dependencies.ts](../../src/features/media-providers/dependencies.ts) |
| `FakeMemoryConnectorsPortOptions` | type; [dependencies.ts](../../src/features/memory/dependencies.ts) |
| `FakeProjectLocationsPortOptions` | type; [dependencies.ts](../../src/features/project-locations/dependencies.ts) |
| `FakeResourceBoardPortOptions`, `FakeResourceRowListPortOptions` | type; [dependencies.ts](../../src/features/resource-dashboard/dependencies.ts) |
| `FakeSkillsPortOptions` | type; [dependencies.ts](../../src/features/skills/dependencies.ts) |
| `FakeSourceConfigPortOptions` | interface; [dependencies.ts](../../src/features/source-config-list/dependencies.ts) |
| `FileDropzoneKind`, `FileDropzonePreviewState` | type; [types.ts](../../src/features/file-dropzone/types.ts) |
| `FileDropzoneLightboxProps` | type; [FileDropzoneLightbox.tsx](../../src/features/file-dropzone/react/components/FileDropzoneLightbox.tsx) |
| `FileDropzoneNameListProps` | type; [FileDropzoneNameList.tsx](../../src/features/file-dropzone/react/components/FileDropzoneNameList.tsx) |
| `FileDropzoneProps`, `FileDropzoneSecondaryAction` | type; [FileDropzone.tsx](../../src/features/file-dropzone/react/components/FileDropzone.tsx) |
| `FileDropzoneThumbnailGridProps` | type; [FileDropzoneThumbnailGrid.tsx](../../src/features/file-dropzone/react/components/FileDropzoneThumbnailGrid.tsx) |
| `FileImportPanelProps` | interface; [FileImportPanel.tsx](../../src/react/components/FileImportPanel.tsx) |
| `FilePreviewPaneProps` | type; [FilePreviewPane.tsx](../../src/features/asset-tree-browser/react/components/FilePreviewPane.tsx) |
| `FullscreenPort`, `HtmlViewerDependencies`, `NewTabPreviewPort` | type; [ports.ts](../../src/features/html-viewer/ports.ts) |
| `HeaderActionsMenuDisclosure`, `HeaderActionsMenuProps`, `HeaderMenuAction`, `UseHeaderActionsMenuResult` | interface; [HeaderActionsMenu.tsx](../../src/react/components/HeaderActionsMenu.tsx) |
| `HtmlRenderer` | const; [html.ts](../../src/renderers/renderers/html.ts) |
| `I18nProviderProps` | type; [context.tsx](../../src/features/i18n/context.tsx) |
| `IconName` | type; [icon-name.ts](../../src/icon-name.ts) |
| `IframeKeepAliveContext` | const; [pool-context.ts](../../src/features/iframe-pool/react/pool-context.ts) |
| `IframeKeepAlivePoolConfig`, `IframeKeepAlivePoolEntry`, `IframeKeepAlivePoolEvictOptions` | type; [types.ts](../../src/features/iframe-pool/types.ts) |
| `ImagePreviewModalProps` | type; [ImagePreviewModal.tsx](../../src/features/admin-widgets/components/ImagePreviewModal.tsx) |
| `ImageViewerBodyProps` | type; [ImageViewerBody.tsx](../../src/features/viewer-shell/react/components/ImageViewerBody.tsx) |
| `ImportChoiceProps` | interface; [ImportChoice.tsx](../../src/react/components/ImportChoice.tsx) |
| `InfoTipProps` | type; [InfoTip.tsx](../../src/features/admin-widgets/components/InfoTip.tsx) |
| `InputModality`, `TooltipPlacement` | type; [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `InstructionsTabProps` | type; [InstructionsTab.tsx](../../src/features/instructions/react/components/InstructionsTab.tsx) |
| `IntegrationsTabProps` | type; [IntegrationsTab.tsx](../../src/features/integrations/react/components/IntegrationsTab.tsx) |
| `InteractiveComponentManifest` | type; [types.ts](../../src/features/interactive-ui/types.ts) |
| `JINI_MCP_UI_METADATA_PREFIX`, `MCP_UI_ACTION_PLAN_META_KEY`, `MCP_UI_METADATA_PREFIX`, `MCP_UI_MIME_TYPE`, `MCP_UI_PREFERRED_FRAME_SIZE_META_KEY`, `MCP_UI_RESOURCE_URI_META_KEY`, `UI_RESOURCE_MIME_TYPES` | const; [resource.ts](../../src/features/mcp-ui/resource.ts) |
| `JINI_PAGE_ACTION_METHOD`, `JSON_RPC_ERROR_CODES`, `MCP_UI_HOST_NOTIFICATIONS`, `MCP_UI_HOST_REQUESTS`, `MCP_UI_SANDBOX_NOTE`, `MCP_UI_VIEW_METHODS`, `MCP_UI_VIEW_NOTIFICATIONS` | const; [mcp-ui-apps.ts](../../../agentic/src/core/mcp-ui-apps.ts) |
| `JsonPanelProps` | type; [JsonPanel.tsx](../../src/features/viewer-shell/react/components/JsonPanel.tsx) |
| `JsonRpcError`, `JsonRpcMessage`, `JsonRpcNotification`, `JsonRpcRequest`, `JsonRpcResponse` | type; [index.ts](../../../agentic/src/index.ts) |
| `KitErrorBoundaryProps` | interface; [KitErrorBoundary.tsx](../../src/react/components/KitErrorBoundary.tsx) |
| `LanguageMenuDisclosure`, `LanguageMenuProps`, `UseLanguageMenuResult` | interface; [LanguageMenu.tsx](../../src/react/components/LanguageMenu.tsx) |
| `LanguageTabProps` | type; [LanguageTab.tsx](../../src/features/language/react/components/LanguageTab.tsx) |
| `LassoHitTestInput` | interface; [polygon-selection.ts](../../src/utils/polygon-selection.ts) |
| `ListDetailItem`, `ListDetailItemRenderState` | type; [types.ts](../../src/features/list-detail-panel/types.ts) |
| `ListDetailPanelProps` | type; [ListDetailPanel.tsx](../../src/features/list-detail-panel/react/components/ListDetailPanel.tsx) |
| `LocalCliAgentCardProps` | type; [LocalCliAgentCard.tsx](../../src/features/execution/react/components/LocalCliAgentCard.tsx) |
| `LocalCliAgentListProps` | type; [LocalCliAgentList.tsx](../../src/features/execution/react/components/LocalCliAgentList.tsx) |
| `Locale` | type; [types.ts](../../src/features/i18n/types.ts) |
| `LocaleOption` | type; [types.ts](../../src/features/language/types.ts) |
| `LocalizedUrlOptions` | interface; [localized-url.ts](../../src/utils/localized-url.ts) |
| `LogoStage` | type; [BrandLogo.tsx](../../src/react/components/BrandLogo.tsx) |
| `LongTaskObserverOptions` | type; [long-task.ts](../../src/features/observability/long-task.ts) |
| `MCP_SOURCE_FIELD_SPECS` | const; [constants.ts](../../src/features/external-mcp/constants.ts) |
| `MCP_UI_PROTOCOL_VERSION` | const; [protocol.ts](../../src/features/mcp-ui/protocol.ts) |
| `MENTION_COLOR_PROPERTY` | const; [useMentionColorStamping.ts](../../src/features/lexical-rich-text-editor/react/hooks/useMentionColorStamping.ts) |
| `MODAL_WINDOW_DRAG_STRIP_HEIGHT` | const; [useModalWindowDragGuard.ts](../../src/browser/useModalWindowDragGuard.ts) |
| `MarkdownRenderer` | const; [markdown.ts](../../src/renderers/renderers/markdown.ts) |
| `MarkdownSplitPaneProps` | type; [MarkdownSplitPane.tsx](../../src/features/viewer-shell/react/components/MarkdownSplitPane.tsx) |
| `McpInstallInfoController` | type; [useMcpInstallInfo.ts](../../src/features/integrations/react/hooks/useMcpInstallInfo.ts) |
| `McpUiActionPlanAction`, `TextContent`, `UIResourceContent` | interface; [resource.ts](../../src/features/mcp-ui/resource.ts) |
| `McpUiHostEvent`, `McpUiToolCall` | interface; [useMcpUiHost.ts](../../src/react/mcp-ui/useMcpUiHost.ts) |
| `McpUiHostState`, `McpUiToolCallHandler` | type; [useMcpUiHost.ts](../../src/react/mcp-ui/useMcpUiHost.ts) |
| `MediaProviderCredentials`, `MediaProviderOption`, `MediaProvidersLoadState`, `MediaProvidersSaveState` | type; [types.ts](../../src/features/media-providers/types.ts) |
| `MediaProviderEditPatch`, `UseMediaProvidersTabOptions`, `UseMediaProvidersTabResult` | type; [useMediaProvidersTab.ts](../../src/features/media-providers/react/hooks/useMediaProvidersTab.ts) |
| `MediaProvidersTabLabels`, `MediaProvidersTabProps` | type; [MediaProvidersTab.tsx](../../src/features/media-providers/react/components/MediaProvidersTab.tsx) |
| `MemoryConfigController` | type; [useMemoryConfig.hooks.ts](../../src/features/memory/react/hooks/useMemoryConfig.hooks.ts) |
| `MemoryConfigFlagKey` | type; [rules.ts](../../src/features/memory/rules.ts) |
| `MemoryConnectorsController`, `MemoryConnectorsCoordination` | type; [useMemoryConnectors.hooks.ts](../../src/features/memory/react/hooks/useMemoryConnectors.hooks.ts) |
| `MemoryEntriesController`, `MemoryEntriesCoordination` | type; [useMemoryEntries.hooks.ts](../../src/features/memory/react/hooks/useMemoryEntries.hooks.ts) |
| `MemoryExtractionsController` | type; [useMemoryExtractions.hooks.ts](../../src/features/memory/react/hooks/useMemoryExtractions.hooks.ts) |
| `MemoryFlashController` | type; [useMemoryFlash.hooks.ts](../../src/features/memory/react/hooks/useMemoryFlash.hooks.ts) |
| `MemoryHookKey` | type; [MemoryHooksPanel.tsx](../../src/features/memory/react/components/MemoryHooksPanel.tsx) |
| `MemoryNavigationController`, `MemoryTopTab` | type; [useMemoryNavigation.hooks.ts](../../src/features/memory/react/hooks/useMemoryNavigation.hooks.ts) |
| `MemorySettingsPanelProps` | type; [MemorySettingsPanel.tsx](../../src/features/memory/react/components/MemorySettingsPanel.tsx) |
| `MentionAutocompleteProps` | type; [MentionAutocomplete.tsx](../../src/features/mention-autocomplete/react/components/MentionAutocomplete.tsx) |
| `MentionCategory`, `MentionCategoryFilter`, `MentionInsertResult`, `MentionItem`, `MentionTriggerMatch` | type; [types.ts](../../src/features/mention-autocomplete/types.ts) |
| `MentionCategoryTabsProps` | type; [MentionCategoryTabs.tsx](../../src/features/mention-autocomplete/react/components/MentionCategoryTabs.tsx) |
| `MentionEntity`, `MentionInsert`, `PopoverNavigationKey`, `RichTextTriggerAnchor`, `RichTextTriggerConfig`, `RichTextTriggerMatch` | type; [types.ts](../../src/features/lexical-rich-text-editor/types.ts) |
| `MentionPayload`, `SerializedMentionNode` | type; [mention-node.ts](../../src/features/lexical-rich-text-editor/mention-node.ts) |
| `MentionResultGroup` | type; [rules.ts](../../src/features/mention-autocomplete/rules.ts) |
| `MentionResultItemProps` | type; [MentionResultItem.tsx](../../src/features/mention-autocomplete/react/components/MentionResultItem.tsx) |
| `MentionResultsListProps` | type; [MentionResultsList.tsx](../../src/features/mention-autocomplete/react/components/MentionResultsList.tsx) |
| `MenuAnchorRect`, `MenuPositionOptions`, `RenameCommitDecision`, `TreeChildren` | type; [rules.ts](../../src/features/asset-tree-browser/rules.ts) |
| `MergeHistoryEntryMeta`, `MergeHistoryEntryOptions`, `NavigationHistoryDeltaResult`, `NormalizeBrowserAddressOptions`, `RecordNavigationOptions` | type; [rules.ts](../../src/features/browser-chrome/rules.ts) |
| `MutationStatus`, `QueryStatus` | type; [types.ts](../../src/features/panel-kit/fetch-query/types.ts) |
| `NewTabPreviewOptions` | type; [new-tab-preview.ts](../../src/renderers/new-tab-preview.ts) |
| `NoticeOutcome`, `NoticeProps` | interface; [Notice.tsx](../../src/react/components/Notice.tsx) |
| `NotificationsPreferences` | type; [types.ts](../../src/features/notifications/types.ts) |
| `NotificationsTabLabels`, `NotificationsTabProps` | type; [NotificationsTab.tsx](../../src/features/notifications/react/components/NotificationsTab.tsx) |
| `ONBOARDING_DROPDOWN_OPEN_EVENT`, `ONBOARDING_MENU_FALLBACK_VIEWPORT`, `ONBOARDING_MENU_FLIP_THRESHOLD`, `ONBOARDING_MENU_MAX_HEIGHT`, `ONBOARDING_MENU_MIN_HEIGHT`, `ONBOARDING_MENU_VIEWPORT_PADDING` | const; [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `OnboardingChipFieldOption` | interface; [OnboardingChipField.tsx](../../src/react/components/OnboardingChipField.tsx) |
| `OnboardingChipFieldProps` | type; [OnboardingChipField.tsx](../../src/react/components/OnboardingChipField.tsx) |
| `OnboardingDropdownMenuMetrics`, `OnboardingDropdownOption`, `UseOnboardingDropdownResult` | interface; [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `OnboardingDropdownPlacement`, `OnboardingDropdownProps` | type; [OnboardingDropdown.tsx](../../src/react/components/OnboardingDropdown.tsx) |
| `OnboardingPanelHeaderProps` | interface; [OnboardingPanelHeader.tsx](../../src/react/components/OnboardingPanelHeader.tsx) |
| `OptionCardsOption`, `OptionCardsProps` | interface; [OptionCards.tsx](../../src/react/components/OptionCards.tsx) |
| `PALETTE_TWEAKS_SWATCHES` | const; [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `PaletteHoverTarget`, `PaletteId` | type; [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `PaletteSwatch`, `PaletteTweaksProps`, `UsePaletteHoverResult` | interface; [PaletteTweaks.tsx](../../src/react/components/PaletteTweaks.tsx) |
| `ParsedSseFrame` | type; [sse.ts](../../src/utils/sse.ts) |
| `PendingConfirmation` | interface; [confirmation-store.ts](../../src/features/mcp-ui/confirmation-store.ts) |
| `PillButtonProps` | interface; [PillButton.tsx](../../src/react/components/PillButton.tsx) |
| `PopoverItemProps` | interface; [PopoverItem.tsx](../../src/react/components/PopoverItem.tsx) |
| `PopoverMenuProps` | interface; [PopoverMenu.tsx](../../src/react/components/PopoverMenu.tsx) |
| `PresentMenuProps` | type; [PresentMenu.tsx](../../src/features/html-viewer/react/components/PresentMenu.tsx) |
| `PresentModeController` | type; [usePresentMode.ts](../../src/features/html-viewer/react/hooks/usePresentMode.ts) |
| `PreviewCanvasSize`, `VersionManagerFileRef`, `VersionRecord`, `VersionRestoreResult`, `VersionRestoreWarning`, `VersionSource` | type; [types.ts](../../src/features/version-manager/types.ts) |
| `PreviewModalContentStatus`, `PreviewModalPrimaryAction`, `PreviewModalPrimaryActionMenuItem`, `PreviewModalScalerStyle`, `PreviewModalUnavailable` | type; [types.ts](../../src/renderers/preview-modal-shell/types.ts) |
| `PreviewModalContentViewLike`, `PreviewModalViewLike` | type; [rules.ts](../../src/renderers/preview-modal-shell/rules.ts) |
| `PreviewModalIconName` | type; [icons.tsx](../../src/renderers/preview-modal-shell/react/components/icons.tsx) |
| `PreviewModalShellController`, `UsePreviewModalShellOptions` | type; [usePreviewModalShell.ts](../../src/renderers/preview-modal-shell/react/hooks/usePreviewModalShell.ts) |
| `PreviewModalShellProps`, `PreviewModalSidebar`, `PreviewModalView` | type; [PreviewModalShell.tsx](../../src/renderers/preview-modal-shell/react/components/PreviewModalShell.tsx) |
| `PrivacyConsentState`, `TelemetryPreferences` | type; [types.ts](../../src/features/privacy/types.ts) |
| `PrivacyTabLabels`, `PrivacyTabProps` | type; [PrivacyTab.tsx](../../src/features/privacy/react/components/PrivacyTab.tsx) |
| `ProgressCardData`, `ProgressCardItem`, `ProgressStatus` | type; [types.ts](../../src/features/progress-card/types.ts) |
| `ProgressCardProps` | type; [ProgressCard.tsx](../../src/features/progress-card/components/ProgressCard.tsx) |
| `ProjectLocationDraft`, `ProjectLocationsActionResult`, `StoredProjectLocation` | type; [types.ts](../../src/features/project-locations/types.ts) |
| `ProjectLocationsTabLabels`, `ProjectLocationsTabProps` | type; [ProjectLocationsTab.tsx](../../src/features/project-locations/react/components/ProjectLocationsTab.tsx) |
| `ProviderChipGroupProps` | type; [ProviderChipGroup.tsx](../../src/features/execution/react/components/ProviderChipGroup.tsx) |
| `ProviderTabBarProps` | type; [ProviderTabBar.tsx](../../src/features/connectors/components/ProviderTabBar.tsx) |
| `REMIXICON_STYLESHEET_MARKER` | const; [RemixIcon.tsx](../../src/react/components/RemixIcon.tsx) |
| `ReactComponentRenderer` | const; [react-component.ts](../../src/renderers/renderers/react-component.ts) |
| `RecurringSchedulePickerProps` | type; [RecurringSchedulePicker.tsx](../../src/features/schedule-picker/react/components/RecurringSchedulePicker.tsx) |
| `ResizableSplitPaneController`, `UseResizableSplitPaneOptions` | interface; [useResizableSplitPane.ts](../../src/react/hooks/useResizableSplitPane.ts) |
| `ResolvedWorkingDirLabels`, `WorkingDirLabels`, `WorkingDirPlacement` | type; [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `ResourceBoardController`, `UseResourceBoardParams`, `UseWiredResourceBoardParams` | type; [useResourceBoard.ts](../../src/features/resource-dashboard/react/hooks/useResourceBoard.ts) |
| `ResourceBoardDependencies`, `ResourceBoardPort`, `ResourceRowListDependencies`, `ResourceRowListPort`, `ResourceViewModeStoragePort` | type; [ports.ts](../../src/features/resource-dashboard/ports.ts) |
| `ResourceBoardItem`, `ResourceBoardViewMode`, `ResourceMenuActionSpec`, `ResourceMetric`, `ResourceRowAction`, `ResourceRowItem`, `ResourceRunHistoryItem`, `ResourceSortOption`, `ResourceStatusOption`, `ResourceStatusTone`, `ResourceStatusToneMap` | type; [types.ts](../../src/features/resource-dashboard/types.ts) |
| `ResourceBoardProps` | type; [ResourceBoard.tsx](../../src/features/resource-dashboard/react/components/ResourceBoard.tsx) |
| `ResourceBoardToolbarProps` | type; [ResourceBoardToolbar.tsx](../../src/features/resource-dashboard/react/components/ResourceBoardToolbar.tsx) |
| `ResourceBoardViewProps` | type; [ResourceBoardView.tsx](../../src/features/resource-dashboard/react/components/ResourceBoardView.tsx) |
| `ResourceCardProps` | type; [ResourceCard.tsx](../../src/features/resource-dashboard/react/components/ResourceCard.tsx) |
| `ResourceErrorObserverOptions` | type; [resource-error.ts](../../src/features/observability/resource-error.ts) |
| `ResourceKanbanBoardProps`, `ResourceKanbanColumn` | type; [ResourceKanbanBoard.tsx](../../src/features/resource-dashboard/react/components/ResourceKanbanBoard.tsx) |
| `ResourceMetricsProps` | type; [ResourceMetrics.tsx](../../src/features/resource-dashboard/react/components/ResourceMetrics.tsx) |
| `ResourceRowListController`, `UseResourceRowListParams`, `UseWiredResourceRowListParams` | type; [useResourceRowList.ts](../../src/features/resource-dashboard/react/hooks/useResourceRowList.ts) |
| `ResourceRowListItemProps` | type; [ResourceRowListItem.tsx](../../src/features/resource-dashboard/react/components/ResourceRowListItem.tsx) |
| `ResourceRowListProps` | type; [ResourceRowList.tsx](../../src/features/resource-dashboard/react/components/ResourceRowList.tsx) |
| `ResourceRowListViewProps` | type; [ResourceRowListView.tsx](../../src/features/resource-dashboard/react/components/ResourceRowListView.tsx) |
| `ResourceRunHistoryListProps` | type; [ResourceRunHistoryList.tsx](../../src/features/resource-dashboard/react/components/ResourceRunHistoryList.tsx) |
| `RestoreDisabledInput` | interface; [rules.ts](../../src/features/version-manager/rules.ts) |
| `RevisionDiffCardProps` | type; [RevisionDiffCard.tsx](../../src/features/revision-review/react/components/RevisionDiffCard.tsx) |
| `RevisionHistoryListProps` | type; [RevisionHistoryList.tsx](../../src/features/revision-review/react/components/RevisionHistoryList.tsx) |
| `RevisionReviewFileChange`, `RevisionReviewItem`, `RevisionReviewStatus` | type; [types.ts](../../src/features/revision-review/types.ts) |
| `Rgb` | interface; [color-math.ts](../../src/utils/color-math.ts) |
| `SETTINGS_DIALOG_DICTIONARIES` | const; [index.ts](../../src/features/i18n/dictionaries/index.ts) |
| `SETTINGS_DIALOG_EN` | const; [settings-dialog.en.ts](../../src/features/i18n/dictionaries/settings-dialog.en.ts) |
| `SETTINGS_DIALOG_ES` | const; [settings-dialog.es.ts](../../src/features/i18n/dictionaries/settings-dialog.es.ts) |
| `STROKE_COLOR`, `STROKE_WIDTH`, `TARGET_COLOR` | const; [drawing.ts](../../src/renderers/annotation-canvas/drawing.ts) |
| `SURFACE_BRIDGE_GLOBAL`, `SURFACE_HANDSHAKE_FAILED_ATTRIBUTE` | const; [bridge.ts](../../src/features/mcp-ui/surfaces/bridge.ts) |
| `SandboxBridge`, `UseSandboxBridgeOptions` | type; [sandbox-bridge.ts](../../src/renderers/sandbox-bridge.ts) |
| `ScheduleEditorState`, `ScheduleKind`, `ScheduleKindOption`, `ScheduleSummaryParts`, `ScheduleValue`, `Weekday`, `WeekdayOption` | type; [types.ts](../../src/features/schedule-picker/types.ts) |
| `ScheduleFieldsProps` | type; [ScheduleFields.tsx](../../src/features/schedule-picker/react/components/ScheduleFields.tsx) |
| `ScheduleKindTabsProps` | type; [ScheduleKindTabs.tsx](../../src/features/schedule-picker/react/components/ScheduleKindTabs.tsx) |
| `ScheduleSummaryProps` | type; [ScheduleSummary.tsx](../../src/features/schedule-picker/react/components/ScheduleSummary.tsx) |
| `SearchableModelSelectAdditionalOption`, `SearchableModelSelectProps` | type; [SearchableModelSelect.tsx](../../src/features/execution/react/components/SearchableModelSelect.tsx) |
| `SeeMoreProps` | type; [SeeMore.tsx](../../src/features/admin-widgets/components/SeeMore/SeeMore.tsx) |
| `SegmentedToggleProps` | type; [SegmentedToggle.tsx](../../src/features/viewer-shell/react/components/SegmentedToggle.tsx) |
| `SelectAutoOpenOptions` | interface; [auto-open-file.ts](../../src/utils/auto-open-file.ts) |
| `SelectedMentionChipsProps` | type; [SelectedMentionChips.tsx](../../src/features/mention-autocomplete/react/components/SelectedMentionChips.tsx) |
| `SelectionActionBarProps` | type; [SelectionActionBar.tsx](../../src/features/asset-grid/react/components/SelectionActionBar.tsx) |
| `SelectionBandProps` | type; [SelectionBand.tsx](../../src/features/asset-grid/react/components/SelectionBand.tsx) |
| `SettingsDialogChromeLabels`, `SettingsDialogTabMeta`, `TabbedDialogChromeLabels`, `TabbedDialogTabMeta` | type; [types.ts](../../src/features/tabbed-dialog/types.ts) |
| `SettingsDialogDict` | type; [index.ts](../../src/features/i18n/dictionaries/index.ts) |
| `SettingsDialogShellController`, `UseSettingsDialogShellParams` | type; [useSettingsDialogShell.ts](../../src/features/settings/dialog/react/hooks/useSettingsDialogShell.ts) |
| `SettingsDialogTab` | type; [SettingsDialogShell.tsx](../../src/features/settings/dialog/react/components/SettingsDialogShell.tsx) |
| `SettingsThemeChoice` | type; [types.ts](../../src/features/appearance/types.ts) |
| `SketchDomTextOverrides`, `SketchExportImageResult`, `SketchExportedImageResult`, `SketchSceneChangeOptions`, `SketchToastState`, `SketchTooltipLabelKey`, `SketchTooltipLabels`, `SketchTooltipTarget`, `SketchTranslate` | type; [types.ts](../../src/features/sketch-editor/types.ts) |
| `SketchMainMenuProps` | type; [SketchMainMenu.tsx](../../src/features/sketch-editor/react/components/SketchMainMenu.tsx) |
| `SketchSaveStateBadgeProps` | type; [SketchSaveStateBadge.tsx](../../src/features/sketch-editor/react/components/SketchSaveStateBadge.tsx) |
| `SketchSaveWorkflowController`, `UseSketchSaveWorkflowParams` | type; [useSketchSaveWorkflow.ts](../../src/features/sketch-editor/react/hooks/useSketchSaveWorkflow.ts) |
| `SketchSceneController`, `UseSketchSceneParams` | type; [useSketchScene.ts](../../src/features/sketch-editor/react/hooks/useSketchScene.ts) |
| `SkillDetail`, `SkillDraft`, `SkillDraftError`, `SkillFileEntry`, `SkillFilterOption`, `SkillFilters`, `SkillSource`, `SkillSummary`, `SourceFilter` | type; [types.ts](../../src/features/skills/types.ts) |
| `SkillDraftFormLabels`, `SkillDraftFormProps` | type; [SkillDraftForm.tsx](../../src/features/skills/react/components/SkillDraftForm.tsx) |
| `SkillFilterDimension` | type; [rules.ts](../../src/features/skills/rules.ts) |
| `SkillFilterRow`, `UseSkillsTabOptions`, `UseSkillsTabResult` | type; [useSkillsTab.ts](../../src/features/skills/react/hooks/useSkillsTab.ts) |
| `SkillRowLabels`, `SkillRowProps` | type; [SkillRow.tsx](../../src/features/skills/react/components/SkillRow.tsx) |
| `SkillWritePayload` | type; [ports.ts](../../src/features/skills/ports.ts) |
| `SkillsTabLabels`, `SkillsTabProps` | type; [SkillsTab.tsx](../../src/features/skills/react/components/SkillsTab.tsx) |
| `SnippetBlockProps` | type; [SnippetBlock.tsx](../../src/features/integrations/react/components/SnippetBlock.tsx) |
| `SoundId`, `SoundOption` | type; [notifications-catalog.ts](../../src/features/notifications/notifications-catalog.ts) |
| `SourceActionKind`, `SourceConnectionStatus`, `SourceFieldKind`, `SourceFieldValues` | type; [types.ts](../../src/features/source-config-list/types.ts) |
| `SourceConfigAddFormController`, `UseSourceConfigAddFormParams`, `UseWiredSourceConfigAddFormParams` | type; [useSourceConfigAddForm.ts](../../src/features/source-config-list/react/hooks/useSourceConfigAddForm.ts) |
| `SourceConfigAddFormProps` | type; [SourceConfigAddForm.tsx](../../src/features/source-config-list/react/components/SourceConfigAddForm.tsx) |
| `SourceConfigAgentPropsOptions` | interface; [agent-handles.ts](../../src/features/source-config-list/agent-handles.ts) |
| `SourceConfigFieldProps` | type; [SourceConfigField.tsx](../../src/features/source-config-list/react/components/SourceConfigField.tsx) |
| `SourceConfigItemCardProps` | type; [SourceConfigItemCard.tsx](../../src/features/source-config-list/react/components/SourceConfigItemCard.tsx) |
| `SourceConfigListCapabilities`, `SourceConfigListController`, `UseSourceConfigListParams`, `UseWiredSourceConfigListParams` | type; [useSourceConfigList.ts](../../src/features/source-config-list/react/hooks/useSourceConfigList.ts) |
| `SourceConfigListProps` | type; [SourceConfigList.tsx](../../src/features/source-config-list/react/components/SourceConfigList.tsx) |
| `SourceConfigListViewProps` | type; [SourceConfigListView.tsx](../../src/features/source-config-list/react/components/SourceConfigListView.tsx) |
| `SourceConfigTestControlProps` | type; [SourceConfigTestControl.tsx](../../src/features/source-config-list/react/components/SourceConfigTestControl.tsx) |
| `SrcDocBridgeContext` | type; [index.ts](../../src/renderers/srcdoc/index.ts) |
| `StatCardProps` | interface; [StatCard.tsx](../../src/react/components/StatCard.tsx) |
| `StatusPillProps` | type; [StatusPill.tsx](../../src/features/resource-dashboard/react/components/StatusPill.tsx) |
| `SurfaceStatusText` | interface; [document.ts](../../src/features/mcp-ui/surfaces/document.ts) |
| `SvgRenderer` | const; [svg.ts](../../src/renderers/renderers/svg.ts) |
| `SvgSourcePaneProps`, `SvgViewerMode` | type; [SvgSourcePane.tsx](../../src/features/viewer-shell/react/components/SvgSourcePane.tsx) |
| `TOAST_DEFAULT_TTL`, `TOAST_EXIT_MS`, `TOAST_TONE_ICON` | const; [Toast.tsx](../../src/react/components/Toast.tsx) |
| `TOOLTIP_GAP`, `TOOLTIP_MARGIN` | const; [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `TabLauncherAction`, `TabLauncherAnchorRect`, `TabLauncherPosition`, `TabLauncherResultItem`, `TabLauncherSelection`, `TabLauncherTrackEvent` | type; [types.ts](../../src/features/tab-launcher-menu/types.ts) |
| `TabLauncherActionRowProps` | type; [TabLauncherActionRow.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherActionRow.tsx) |
| `TabLauncherMenuController`, `UseTabLauncherMenuOptions` | type; [useTabLauncherMenu.ts](../../src/features/tab-launcher-menu/react/hooks/useTabLauncherMenu.ts) |
| `TabLauncherMenuProps` | type; [TabLauncherMenu.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherMenu.tsx) |
| `TabLauncherResultRowProps` | type; [TabLauncherResultRow.tsx](../../src/features/tab-launcher-menu/react/components/TabLauncherResultRow.tsx) |
| `TabbedDialogController`, `UseTabbedDialogParams` | type; [useTabbedDialog.ts](../../src/features/tabbed-dialog/react/hooks/useTabbedDialog.ts) |
| `TabbedDialogTab` | type; [TabbedDialog.tsx](../../src/features/tabbed-dialog/react/components/TabbedDialog.tsx) |
| `TestStatus` | type; [rules.ts](../../src/features/notifications/rules.ts) |
| `ThemeOption` | type; [constants.ts](../../src/features/appearance/constants.ts) |
| `ToastPlacement`, `ToastRole`, `ToastTone`, `ToastToneIcon` | type; [Toast.tsx](../../src/react/components/Toast.tsx) |
| `ToastProps`, `UseToastAutoDismissOptions`, `UseToastAutoDismissResult` | interface; [Toast.tsx](../../src/react/components/Toast.tsx) |
| `ToggleRowProps` | interface; [ToggleRow.tsx](../../src/react/components/ToggleRow.tsx) |
| `TokenChipProps` | interface; [TokenChip.tsx](../../src/react/components/TokenChip.tsx) |
| `TooltipLayerProps`, `TooltipState`, `UseTooltipLayerResult` | interface; [TooltipLayer.tsx](../../src/react/components/TooltipLayer.tsx) |
| `TrackIframeLoadOptions` | type; [iframe.ts](../../src/features/observability/iframe.ts) |
| `TrackRunStartOptions` | type; [stuck-run.ts](../../src/features/observability/stuck-run.ts) |
| `TranslationDict`, `TranslationVars` | type; [i18n.tsx](../../src/renderers/react/i18n.tsx) |
| `UIResourceMimeType` | type; [resource.ts](../../src/features/mcp-ui/resource.ts) |
| `UrlLoadDecision` | type; [url-load-decision.ts](../../src/renderers/url-load-decision.ts) |
| `UseAssetGridDataParams`, `UseAssetGridDataResult`, `UseWiredAssetGridDataParams` | type; [useAssetGridData.ts](../../src/features/asset-grid/react/hooks/useAssetGridData.ts) |
| `UseAssetGridKeyboardShortcutsParams` | type; [useAssetGridKeyboardShortcuts.ts](../../src/features/asset-grid/react/hooks/useAssetGridKeyboardShortcuts.ts) |
| `UseAssetGridLiveUpdatesParams`, `UseWiredAssetGridLiveUpdatesParams` | type; [useAssetGridLiveUpdates.ts](../../src/features/asset-grid/react/hooks/useAssetGridLiveUpdates.ts) |
| `UseAssetGridSelectionResult` | type; [useAssetGridSelection.ts](../../src/features/asset-grid/react/hooks/useAssetGridSelection.ts) |
| `UseAssetTreeBatchActionsParams`, `UseAssetTreeBatchActionsResult` | type; [useAssetTreeBatchActions.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeBatchActions.ts) |
| `UseAssetTreeClipboardPasteUploadParams` | type; [useAssetTreeClipboardPasteUpload.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeClipboardPasteUpload.ts) |
| `UseAssetTreeCopyLocalPathResult` | type; [useAssetTreeCopyLocalPath.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeCopyLocalPath.ts) |
| `UseAssetTreeDragUploadResult` | type; [useAssetTreeDragUpload.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeDragUpload.ts) |
| `UseAssetTreeNavigationParams`, `UseAssetTreeNavigationResult` | type; [useAssetTreeNavigation.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeNavigation.ts) |
| `UseAssetTreePreviewResult` | type; [useAssetTreePreview.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreePreview.ts) |
| `UseAssetTreeRenameParams`, `UseAssetTreeRenameResult` | type; [useAssetTreeRename.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeRename.ts) |
| `UseAssetTreeRowMenuResult` | type; [useAssetTreeRowMenu.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeRowMenu.ts) |
| `UseAssetTreeSelectionResult` | type; [useAssetTreeSelection.ts](../../src/features/asset-tree-browser/react/hooks/useAssetTreeSelection.ts) |
| `UseCommentReorderResult` | type; [useCommentReorder.ts](../../src/features/viewer-shell/react/hooks/useCommentReorder.ts) |
| `UseCopyToClipboardResult` | type; [useCopyToClipboard.ts](../../src/features/viewer-shell/react/hooks/useCopyToClipboard.ts) |
| `UseDismissablePanelResult`, `UseRecentFlyoutResult`, `UseWorkingDirPickerInput`, `UseWorkingDirPickerResult`, `WorkingDirPickerProps` | interface; [WorkingDirPicker.tsx](../../src/react/components/WorkingDirPicker.tsx) |
| `UseExecutionTabOptions`, `UseExecutionTabResult` | type; [useExecutionTab.ts](../../src/features/execution/react/hooks/useExecutionTab.ts) |
| `UseFileDialogTrackingResult` | type; [useFileDialogTracking.ts](../../src/features/file-dropzone/react/hooks/useFileDialogTracking.ts) |
| `UseFileDropTargetResult` | interface; [useFileDropTarget.ts](../../src/browser/useFileDropTarget.ts) |
| `UseFileDropzoneParams`, `UseFileDropzoneResult` | type; [useFileDropzone.ts](../../src/features/file-dropzone/react/hooks/useFileDropzone.ts) |
| `UseFolderPathDropCaptureOptions` | type; [useFolderPathDropCapture.ts](../../src/features/folder-path-drop/react/hooks/useFolderPathDropCapture.ts) |
| `UseGlobalKeydownOptions` | interface; [useGlobalKeydown.ts](../../src/browser/useGlobalKeydown.ts) |
| `UseInViewOptions` | interface; [useInView.ts](../../src/react/hooks/useInView.ts) |
| `UseListDetailSelectionResult` | type; [useListDetailSelection.ts](../../src/features/list-detail-panel/react/hooks/useListDetailSelection.ts) |
| `UseMarkdownScrollSyncOptions`, `UseMarkdownScrollSyncResult` | type; [useMarkdownScrollSync.ts](../../src/features/viewer-shell/react/hooks/useMarkdownScrollSync.ts) |
| `UseMentionAutocompleteParams`, `UseMentionAutocompleteResult` | type; [useMentionAutocomplete.ts](../../src/features/mention-autocomplete/react/hooks/useMentionAutocomplete.ts) |
| `UseModalWindowDragGuardOptions` | interface; [useModalWindowDragGuard.ts](../../src/browser/useModalWindowDragGuard.ts) |
| `UseProjectLocationsTabOptions`, `UseProjectLocationsTabResult` | type; [useProjectLocationsTab.ts](../../src/features/project-locations/react/hooks/useProjectLocationsTab.ts) |
| `UseRecurringSchedulePickerParams`, `UseRecurringSchedulePickerResult` | type; [useRecurringSchedulePicker.ts](../../src/features/schedule-picker/react/hooks/useRecurringSchedulePicker.ts) |
| `UseRubberBandDragParams`, `UseRubberBandDragResult` | type; [useRubberBandDrag.ts](../../src/features/asset-grid/react/hooks/useRubberBandDrag.ts) |
| `UseSilentUpdatesToggleOptions`, `UseSilentUpdatesToggleResult` | type; [useSilentUpdatesToggle.ts](../../src/features/about/react/hooks/useSilentUpdatesToggle.ts) |
| `UseSketchDomEnhancementsParams` | type; [useSketchDomEnhancements.ts](../../src/features/sketch-editor/react/hooks/useSketchDomEnhancements.ts) |
| `UseVersionManagerOptions`, `VersionManagerController` | type; [useVersionManager.ts](../../src/features/version-manager/react/hooks/useVersionManager.ts) |
| `UseWiredConnectorsBrowserParams`, `WiredConnectorsBrowserController` | type; [useWiredConnectorsBrowser.ts](../../src/features/connectors/hooks/useWiredConnectorsBrowser.ts) |
| `ValueChipProps` | interface; [ValueChip.tsx](../../src/react/components/ValueChip.tsx) |
| `VersionManagerClipboardPort`, `VersionManagerPort` | type; [ports.ts](../../src/features/version-manager/ports.ts) |
| `VersionManagerModalProps` | type; [VersionManagerModal.tsx](../../src/features/version-manager/react/components/VersionManagerModal.tsx) |
| `VersionPreviewFrameProps` | type; [VersionPreviewFrame.tsx](../../src/features/version-manager/react/components/VersionPreviewFrame.tsx) |
| `VersionPromptPopoverProps` | type; [VersionPromptPopover.tsx](../../src/features/version-manager/react/components/VersionPromptPopover.tsx) |
| `VersionRestoreControlProps` | type; [VersionRestoreControl.tsx](../../src/features/version-manager/react/components/VersionRestoreControl.tsx) |
| `VersionSidebarProps` | type; [VersionSidebar.tsx](../../src/features/version-manager/react/components/VersionSidebar.tsx) |
| `VideoViewerBodyProps` | type; [VideoViewerBody.tsx](../../src/features/viewer-shell/react/components/VideoViewerBody.tsx) |
| `ViewMessageSource` | type; [host-message-source.ts](../../src/react/mcp-ui/host-message-source.ts) |
| `ViewerClipboardPort`, `ViewerShellDependencies` | type; [ports.ts](../../src/features/viewer-shell/ports.ts) |
| `ViewerEmptyStateProps`, `ViewerShellProps` | type; [ViewerShell.tsx](../../src/features/viewer-shell/react/components/ViewerShell.tsx) |
| `ViewerFileActionsProps` | type; [ViewerFileActions.tsx](../../src/features/viewer-shell/react/components/ViewerFileActions.tsx) |
| `ViewportSwitcherProps` | type; [ViewportSwitcher.tsx](../../src/features/viewer-shell/react/components/ViewportSwitcher.tsx) |
| `ViewportToggleGroupProps` | type; [ViewportToggleGroup.tsx](../../src/features/viewer-shell/react/components/ViewportToggleGroup.tsx) |
| `VisibilityObserverOptions` | type; [visibility.ts](../../src/features/observability/visibility.ts) |
| `WebObservabilityOptions` | type; [install.ts](../../src/features/observability/install.ts) |
| `WeekdayGridProps` | type; [WeekdayGrid.tsx](../../src/features/schedule-picker/react/components/WeekdayGrid.tsx) |
| `WhiteScreenDetectorOptions` | type; [white-screen.ts](../../src/features/observability/white-screen.ts) |
| `ZipEntry` | interface; [zip.ts](../../src/utils/zip.ts) |
| `ZoomController` | type; [useZoomControl.ts](../../src/features/html-viewer/react/hooks/useZoomControl.ts) |
| `ZoomMenuProps` | type; [ZoomMenu.tsx](../../src/features/html-viewer/react/components/ZoomMenu.tsx) |
| `defaultHtmlViewerDependencies` | const; [dependencies.ts](../../src/features/html-viewer/dependencies.ts) |
| `defaultSketchEditorDependencies`, `realSketchEditorEngine` | const; [dependencies.ts](../../src/features/sketch-editor/dependencies.ts) |
| `defaultVersionManagerDependencies` | const; [dependencies.ts](../../src/features/version-manager/dependencies.ts) |
| `fetchMemoryList`, `memoryConnectorsPort` | const; [dependencies.ts](../../src/features/memory/dependencies.ts) |
| `memoryConfigPort`, `memoryEntriesPort`, `memoryExtractionsPort` | reexport; [index.ts](../../src/features/memory/index.ts) |
| `nativeDataTableManifest`, `nativeDataTablePropsSchema` | const; [data-table.manifest.ts](../../src/features/interactive-ui/providers/native/data-table.manifest.ts) |
| `noopSafetyEventReporter` | const; [ports.ts](../../src/features/observability/ports.ts) |
| `rechartsBarChartManifest`, `rechartsBarChartPropsSchema` | const; [bar-chart.manifest.ts](../../src/features/interactive-ui/providers/recharts/bar-chart.manifest.ts) |
| `rechartsLineChartManifest`, `rechartsLineChartPropsSchema` | const; [line-chart.manifest.ts](../../src/features/interactive-ui/providers/recharts/line-chart.manifest.ts) |
| `rechartsPieChartManifest`, `rechartsPieChartPropsSchema` | const; [pie-chart.manifest.ts](../../src/features/interactive-ui/providers/recharts/pie-chart.manifest.ts) |
| `shadcnButtonManifest`, `shadcnButtonPropsSchema` | const; [action-button.manifest.ts](../../src/features/interactive-ui/providers/shadcn/action-button.manifest.ts) |
| `shadcnCardManifest`, `shadcnCardPropsSchema` | const; [content-card.manifest.ts](../../src/features/interactive-ui/providers/shadcn/content-card.manifest.ts) |
| `shadcnCheckboxManifest`, `shadcnCheckboxPropsSchema` | const; [checkbox-field.manifest.ts](../../src/features/interactive-ui/providers/shadcn/checkbox-field.manifest.ts) |
| `shadcnDataTableManifest`, `shadcnDataTablePropsSchema` | const; [data-table.manifest.ts](../../src/features/interactive-ui/providers/shadcn/data-table.manifest.ts) |
| `shadcnRadioGroupManifest`, `shadcnRadioGroupPropsSchema` | const; [radio-group-field.manifest.ts](../../src/features/interactive-ui/providers/shadcn/radio-group-field.manifest.ts) |
| `shadcnSelectManifest`, `shadcnSelectPropsSchema` | const; [select-field.manifest.ts](../../src/features/interactive-ui/providers/shadcn/select-field.manifest.ts) |
| `shadcnTextInputManifest`, `shadcnTextInputPropsSchema` | const; [text-input-field.manifest.ts](../../src/features/interactive-ui/providers/shadcn/text-input-field.manifest.ts) |
| `subscribeToViewMessages` | const; [host-message-source.ts](../../src/react/mcp-ui/host-message-source.ts) |

## Current manifest boundary

The current `package.json` exposes `.`, `./core`, `./sketch-editor`, `./lexical-rich-text-editor`, `./html-editor`, `./mcp-ui`, `./mcp-ui/surfaces`, `./interactive-ui`, `./interactive-ui/manifests`, `./a2ui`, `./renderers`, `./interactive-ui.css`, `./settings-dialog.css`, `./tabbed-dialog.css`, `./remixicon.css`, `./admin-widgets`, `./panel-kit`, `./fetch-query`, `./admin-widgets.css`, `./theme`, `./styles/*`. Internal source exports do not create additional supported import paths. The contracts above describe source, not generated output.
