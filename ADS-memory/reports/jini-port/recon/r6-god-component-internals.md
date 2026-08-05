# R6 — God-component internals: closing the r5 aggregate-coupling gap

## 0. Why this doc exists

`ADS-memory/reports/jini-port/recon/r5-components-sweep.md` §1 classified all 29 of OD's `apps/web/src/components/`
god-components (>900 lines) using aggregate import-coupling counts (fanout / od-import-hits) as a
shortcut, without opening most of them. That shortcut was a real methodological gap, not a safe one:
`SettingsDialog.tsx` was filed as flat OD-PRODUCT despite provably containing `McpClientSection.tsx`
(1,477 lines, already independently classified MIXED/reusable) as one of its 17 tabs. A high aggregate
OD-coupling number for a whole file says nothing about whether a genuinely generic chunk lives inside
it — file-level and section-level classification are different questions.

This doc re-reads all 26 god-components named in r5 §1 **minus the 3 chat files**
(`AssistantMessage.tsx`/`ChatComposer.tsx`/`ChatPane.tsx` — already handled by r4/r4b as `@jini/chat-react`
territory, out of scope here) — **23 files** — at the section/tab/cluster level, plus does the
piece-by-piece classification of the Memory feature-slice that r4 §2 reviewed only at the
architecture-pattern level. Every file below was actually opened and read (structural grep for
component/tab boundaries, then full or representative reads of each identified section), not
classified from its import list alone.

**Method disclosure:** this pass was executed as 9 parallel deep-read sub-analyses (8 covering the
23 god-components in batches of 2–5 files each, 1 covering the Memory slice's 22 files in full), each
instructed to map internal structure first (tab arrays, JSX conditional-render blocks, top-level
`function`/`const` component boundaries, comment dividers) and then read every identified section's
actual body — not just its signature — before rendering a verdict. Line numbers cited below are as
reported by each sub-analysis against
`foundry/integrations/open-design/reference/components-original/*` (read-only vendored snapshot).

**Headline correction to r5:** of the 23 files, **zero** turned out to be pure aggregate-classifiable.
Every single one contains at least one section with a real generic UI pattern wrapped around an
OD-specific data type (the `byok/*`/`McpClientSection.tsx`/`EditorIcon.tsx`/`QuickSwitcher.tsx`
precedent) — including files r5 flagged as its highest-coupling, most-OD-tilted examples
(`ProjectView.tsx`, fanout=93; `EntryShell.tsx`, fanout=60, od=22). The *density* of generic material
varies enormously (from one ~250-line utility inside a 9,907-line file, to a file that is
near-entirely generic), but "nothing worth extracting" was never actually true for any of the 23.
Only one file (`pet/PetSettings.tsx`) came close, and even it yielded a few trivial reusable
utilities.

---

## 1. Per-file findings

Verdict legend: **FULL SLICE** = deserves the MemorySection-pattern vertical-slice treatment
(ports+dependencies+hooks+barrel) as a whole or near-whole file. **PARTIAL** = specific
sections/components are real extraction candidates; the rest stays OD-specific. **OD-SPECIFIC** =
read in full, confirmed no viable generic core beyond trivial utilities.

### 1.1 `FileViewer.tsx` (14,275 lines) — **PARTIAL**

The single largest god-component. ~50% of its bulk is one component, `HtmlViewer` (~7,110 lines),
which is irreducibly OD-specific (deploy-provider selection, live-artifact daemon streaming,
board/pod annotation, manual-edit CSS bridge) — confirmed by reading its full ~90-`useState` render
body. `FileVersionManagerModal` (~1,050 lines) is likewise OD-specific despite version-history being
a generic *concept* — the implementation is saturated with OD analytics/deploy/export calls.

Real generic finds, all verified by full read:
- **Media-viewer shell family** (`BinaryViewer`, `DocumentPreviewViewer`, `ImageViewer`, `SketchViewer`,
  `VideoViewer`, `AudioViewer`, `SvgViewer`, `TextViewer`) — a clean, **9-times-repeated** shared
  "viewer-toolbar + viewer-body" shell, parameterized only by a `{name,size,mtime}`-shaped file ref.
  Repetition across 9 independent components is strong evidence of a missing shared primitive.
- `PreviewViewportControls`/`FileVersionViewportControls` — self-contained responsive
  desktop/tablet/mobile viewport switcher, zero business types.
- `CommentSidePanel`/`CommentSideDock` — already prop-abstracted (comments/selectedIds/onToggleSelect/
  onReorder/onCreateComment/`composer: ReactNode` slot); only `PreviewComment`'s type is OD-specific —
  textbook generic-shape-OD-type-parameter.
- `CodeWithLines`, `JsonPanel` — trivial, zero-dependency, ship verbatim.
- `MarkdownViewer`'s split source/preview pane with scroll-sync — generic; only the artifact-status
  gate ties it to OD.

**Recommendation:** targeted extraction of the ~6-9 small generic pieces above into `@jini/ui`/
`@jini/renderers-react`; leave `HtmlViewer` and `FileVersionManagerModal` as OD-PRODUCT (consistent
with r5's own note that FileViewer's checkpoint branches were never merged and this is "the most
OD-tilted surface" — true for its bulk, not for 100% of its lines).

### 1.2 `ProjectView.tsx` (9,907 lines) — **PARTIAL (thin)**

Highest aggregate coupling in the directory (fanout=93, od=27 per r5) — and the read confirms this is
genuinely, overwhelmingly OD-specific: essentially one ~7,600-line function with 99 `useCallback`s /
56 `useEffect`s / 24 `useState`s, and OD-domain concerns (brand-extraction, AMR billing gating,
design-system audit, plugin-folder actions, comments, conversation/queue management, onboarding) are
**interleaved throughout**, not siloed into contiguous, separable tabs. This independently explains why
the prior checkpoint branch (`agent/project-view-merge-continue`, "18/22 clusters") never merged — the
concerns are cross-cutting, not cleanly tab-bound; the difficulty was real, not a classifier miss.

One genuine exception, verified: a **resizable split-pane / drag-to-resize chat panel** (~250 lines
across several line ranges) — pointer-drag width resize, RAF-throttled, RTL-aware, keyboard-resizable,
`ResizeObserver`-clamped, localStorage-persisted. Zero OD types touched; only residue is a renameable
storage-key string (`open-design.project.chatPanelWidth`).

**Recommendation:** lift the resizable-split-pane hook as a standalone `@jini/ui` hook
(`useResizableSplitPane`). Everything else — including the entire JSX composition shell, which is a
thin wrapper around exclusively-OD child components (`ChatPane`, `FileWorkspace`, `AmrBalanceDialog`,
`CritiqueTheaterMount`, `HandoffButton`, etc.) — stays OD-PRODUCT. This is the closest any file came to
confirming r5's original flat classification, but "flat" is still not quite accurate.

### 1.3 `SettingsDialog.tsx` (8,538 lines) — **PARTIAL, shell is reusable**

The canonical example motivating this whole recon pass. Reading the authoritative `SettingsSection`
tab-type declaration (18 values; `library` is a dead letter routed elsewhere; `orbit`/`routines` are
deep-link-only, no nav button) surfaces **the complete tab list r5 never enumerated**:

| Tab | Verdict | Notes |
|---|---|---|
| `execution` | MIXED | AMR/Vela wallet + local-CLI agent chrome (OD) wraps already-extracted `byok/*` components (`ByokConnectionTestControl`, `ByokProviderPicker`, `ByokKeyField`, etc.) |
| `instructions` | GENERIC shape | Plain textarea bound to a string field |
| `memory` | pre-extracted | Renders `MemorySection` (own file, see §2) |
| `media` | OD-specific data, generic-ish shape | Per-provider credential-card list, duplicates the byok pattern as a second unshared implementation |
| `mcpClient` | already known generic | Renders `McpClientSection` |
| `composio` | OD/vendor-specific | Composio key mgmt + embeds `ConnectorsBrowser` |
| `integrations` | **Generic mechanism, 100% branded content** | Multi-client "install me as an MCP server" snippet generator (Claude Code/Codex/Cursor/VS Code/Antigravity/Zed/Windsurf) — the mirror image of `McpClientSection`, currently hardcodes `'open-design'` literals throughout |
| `language` | GENERIC | Locale radio-tile grid |
| `appearance` | GENERIC | Theme + accent-color picker |
| `critiqueTheater` | OD-specific | Single feature-flag checkbox for OD's design-review pipeline |
| `notifications` | GENERIC | Sound toggle/picker + browser Notification-permission flow, browser-API only |
| `pet` | OD-specific (own file) | |
| `designSystems` | OD-specific (own file) | |
| `projectLocations` | OD-specific (own file) | |
| `privacy` | **likely generic, not fully verified** — flagged for follow-up | Telemetry consent card over generic `TelemetryConfig` |
| `about` | OD/Electron-specific | Version/updater/diagnostics |
| `orbit` | OD-specific | ~800 lines, OD's autonomous "Orbit" agent-run automation — largest single inline block after `execution` |
| `routines` | OD-specific (own file, not deep-verified) | |

**The dialog SHELL itself is a reusable "tabbed settings dialog" pattern**, independent of which tabs
are plugged in — proof: 8 of 17 real tabs are *already* separate files the shell merely mounts
(`memory`, `mcpClient`, `pet`, `designSystems`, `projectLocations`, `privacy`, `routines`, plus
`composio`'s embedded `ConnectorsBrowser`). The god-component mass concentrates in the tabs never split
out (`execution`, `orbit`, `media`, `composio`'s own key UI, `integrations`, `about`) plus shared shell
state (agent scan, AMR polling, autosave).

**Recommendation:** harden the shell as reusable chrome; extract `appearance`, `notifications`,
`language`, `instructions` (all small, clean, low-risk) and `integrations` (parameterize the branded
strings — same shape-class as `McpClientSection` but installer-direction-reversed) as new `@jini/ui`
feature slices. Verify `privacy` in a follow-up pass. Leave `execution`/`orbit`/`media`/`composio`/
`critiqueTheater`/`pet`/`designSystems`/`projectLocations`/`routines`/`about` as OD-specific.

**`WorkspaceTabsBar.tsx` (1,220 lines) — correction to r5.** r5 called it "generic... one OD residue
import (`router.ts`)." A full read shows the coupling is broader than one import: (1) `tabFromRoute`/
`routeForTab` convert directly to/from OD's `Route` shape, (2) `displayTabFor` reads OD-specific
`Project` fields (`pendingPrompt`, `customInstructions`), (3) the core `WorkspaceChromeTab.kind: 'entry'
| 'project' | 'marketplace'` union and the `EntryHomeView` enum bake in OD's specific top-level IA
(home/onboarding/projects/tasks/plugins/design-systems/library/brands/integrations) as hardcoded
switch/lookup tables, not injected data, and (4) two product-identity string literals
(`'open-design:workspace-tabs:v1'`, `'open-design:workspace-tabs:open'`) that would trip
`scripts/guard.ts`'s neutrality check verbatim. The drag/reorder/keyboard-shortcut/hover-preview/search/
persistence *chrome* is genuinely generic and portable, but extraction requires parameterizing three
things (tab-kind union, route-mapping functions, storage/event key names), not a one-line import swap.
Notably, `FileWorkspace.tsx` (§1.4) independently re-implements a near-identical `Tab` component rather
than importing this one — the pattern is duplicated internally in OD's own codebase, reinforcing that
it's a real missing shared primitive.

### 1.4 `FileWorkspace.tsx` (8,000 lines) — **PARTIAL (thin)**

Confirms r5's OD-PRODUCT classification for the great majority of the file: the tab-content router
(dispatches to `DesignFilesPanel`/`DesignSystemProjectPanel`/`SketchEditor`/`FileViewer`/
`TerminalViewer`/`SideChatTab`/`LiveArtifactViewer`/`DesignBrowserPanel`), the ~950-line
`DesignSystemProjectPanel` design-system review/brand-kit dashboard, and the `PageCreatorDialog`
template gallery (plugin-marketplace vocabulary, same domain r5 already filed OD-PRODUCT for
`plugins-home/`) are all genuinely OD-specific.

Two small, clean exceptions:
- `scrollWorkspaceTabsWithWheel` — fully structurally-typed, zero OD imports, pure function
  (horizontal-scroll-via-vertical-wheel for an overflowing tab bar). Ship verbatim.
- The `Tab` component (line ~7704) — same generic tab-strip-item shape as `WorkspaceTabsBar.tsx`
  above, independently reimplemented rather than shared.

Also notable: a browser-webview keep-alive LRU cache is inlined in this file's state, duplicating the
concept r5 §3 already flagged for `IframeKeepAlivePool.tsx` — not independently extractable without a
rewrite, but a signal of a third duplicate of the same "cap N mounted iframes" pattern in the codebase.

**Recommendation:** lift `scrollWorkspaceTabsWithWheel`; reconcile the `Tab` component with
`WorkspaceTabsBar.tsx`'s tab-strip item rather than treating it as a second separate extraction. This
corroborates that the closed/draft checkpoint branches (`agent/file-workspace-finish`,
`agent/file-workspace-clean`) were correctly scoped as OD-product work, not `@jini/*` material.

### 1.5 `DesignSystemFlow.tsx` (5,439 lines) — **PARTIAL**

The two orchestrators (`DesignSystemCreationFlow` wizard, `DesignSystemDetailView` tab container) and
the package/manifest/agent-prompt-building helpers are genuinely OD-specific (design-system ingestion
is a core OD product concept). But embedded inside is a real cluster of independently-discoverable
generic patterns:

- **`WorkspaceActivityCard` + `GenerationStatusCard`** — the *same* "progress bar + status icon +
  todo/step list" shape, **independently re-implemented twice** against two different data shapes
  (`ChatMessage.events`/`AgentEvent` vs. `DesignSystemGenerationJob`). Two independent occurrences of an
  identical pattern in one file is strong evidence of a missing shared primitive, not coincidence — and
  notably, this maps almost 1:1 onto Jini's own `Run`/`Agent`/`Tool` domain vocabulary, making it a
  higher-priority extraction than most other finds in this recon (it isn't just "generic," it's
  directly on-domain for the engine being built).
- **`DropZone`** — fully generic labeled drag/drop zone with browse-button, staged-selection chips,
  and a native-file-picker-return-detection heuristic. Zero OD types leak in.
- **`RevisionDiffCard`/`RevisionHistoryList`** — generic "proposed change review" widget (diff + accept/
  reject) and status-badged history list, coupled only to a swappable revision-shape.
- **`DesignMdTokenChip`/`DesignMdValueChip`/`DesignMdComponentKitPreview`** — generic token/value swatch
  chips and a theme-toggle-driven style-guide preview panel; only the token *source* (design.md parsing)
  is OD-specific.
- Color-contrast/luminance/hex-mixing math helpers — generic, travel with the above.

**Recommendation:** extract the progress-card pattern (unify `WorkspaceActivityCard`/
`GenerationStatusCard` into one generic component — likely reusable immediately for Jini's own run/job
dashboards), `DropZone`, the revision-review widget, and the token-chip/preview family. Leave the
wizard, detail-tab orchestrator, package cards, and prompt-building helpers as OD-specific.

### 1.6 `HomeHero.tsx` (5,004 lines) — **PARTIAL (thin)**

The main `HomeHero` component (~1,900 lines) is OD's chat-composer-on-the-home-screen god-object — a
100+-prop interface built entirely around OD domain types (`InstalledPluginRecord`, `McpServerConfig`,
`ConnectorDetail`, `SkillSummary`, Figma import, design systems) with OD analytics threaded through
nearly every handler. Not separable without gutting the file.

One clean exception, already living as its own file: `home-hero/EdgeAutoScroll.tsx`
(`useEdgeAutoScroll`/`EdgeScrollZones`) — completely data-agnostic edge-hover/click auto-scroll for any
horizontally overflowing rail, imported by HomeHero's two carousel rails. Zero OD types beyond an
`Icon` import.

Secondary, weaker candidate: `FooterSelectOption`'s search+group+outside-click-close dropdown shape —
legitimate reusable combobox, but more entangled (defined inline in the 5,000-line file) and lower
value to extract in isolation.

**Recommendation:** pull `home-hero/EdgeAutoScroll.tsx` out as-is (it's already isolated). Treat the
rest of the file as OD-specific.

### 1.7 `EntryShell.tsx` (4,200 lines) — **PARTIAL**

Second-highest coupling in the directory (fanout=60, od=22 per r5), confirmed genuinely OD-specific for
its two main bodies: the ~786-line `EntryShell()` main-shell function (AMR balance-gate dialogs, Vela
login, analytics, plugin/project creation) and the ~1,789-line `OnboardingView()` state machine (OD's
connect-a-coding-agent onboarding flow, AMR wallet gating). Neither warrants a vertical slice.

But five free-standing sub-components inside `OnboardingView` are cleanly OD-decoupled, verified by
full read:
- **`OnboardingDropdown`** (exported) — a full generic searchable/multi-select dropdown with
  viewport-aware flip placement, click-outside/Escape dismiss, single-open-at-a-time coordination, ARIA
  listbox roles. Options typed `{value,label,tag?,meta?}` — only one optional field is OD-flavored.
- **`OnboardingChipField`** — pure generic multi/single-select chip field, zero OD types.
- **`OnboardingChoiceCard`** — generic accessible "choice card" (icon/title/body/benefits/badge/selected
  state), only icon-enum values are OD-flavored.
- **`OnboardingPanelHeader`** — trivial generic title+body header.
- **`OnboardingByokSetupPanel`** — reinforces (does not newly discover) the already-known `byok/*`
  generic pattern.

**Recommendation:** lightweight UI-kit extraction of the 4 presentational components (no ports/hooks
needed, pure presentational) into `@jini/ui`. Leave the shell and onboarding flow as OD-specific.

### 1.8 `DesignKitView.tsx` (2,216 lines) — **PARTIAL; r5's uncertainty resolved**

r5 flagged this file explicitly as "not fully verified" (fanin=5, od=1 despite the OD-sounding name).
Resolved: the `od=1` count undercounted coupling because the domain type (`DesignKit` from
`../runtime/design-kit`) is a relative import, not an `@open-design/*` package import — the same import-
scan blind spot later confirmed for `PreviewDrawOverlay.tsx`. The main render (~1,650 lines,
`DesignKitViewInner`) is genuinely OD-specific: it's OD's brand-kit product feature (logo/fonts/
palette/voice-tone/imagery guidelines, embedded design-system iframe, downloadable assets).

Real generic finds:
- **`BrandLogo`** (exported) — logo-with-fallback-chain (CDN → custom URL → favicon → initial letter),
  pure props.
- **`HeaderActionsMenu`** (exported) — fully generic grouped "More" overflow menu, zero OD types.
- **`designMdModuleSlice`/`designMdHeadings`/`replaceDesignMdModule`/`normalizeDesignMdModuleDraft`** —
  generic markdown-heading-slice/replace utility set, reusable for any "edit one section of a
  heading-structured markdown doc" feature.
- **`useBrandFonts`** (exported hook) — the font-injection mechanism (Google Fonts link + `@font-face`
  from a manifest) is generic; only the fetch-URL builder call ties it to OD, and that's a swappable
  parameter.

**Recommendation:** lift `BrandLogo`, `HeaderActionsMenu`, and the `designMd*` markdown-slice utilities
as standalone `@jini/ui` exports; genericize `useBrandFonts`'s fetch parameter. Leave the ~1,650-line
brand-kit render as OD-specific — this is the exact `McpClientSection`-inside-`SettingsDialog` pattern
recurring at smaller scale.

### 1.9 `PreviewDrawOverlay.tsx` (2,158 lines) — **near-FULL SLICE — strongest single find**

r5 verified this as OD-domain content (`od_hits=0` by import-keyword scan, but domain-verified OD via
`PreviewVisualMarkKind`/`comments.ts`). A full read reveals the aggregate `od_hits=0` was actually
correct in spirit: only two relative imports touch OD concepts at all (`PreviewVisualMarkKind` from
`../types`, `requestPreviewSnapshot` from `../runtime/exports`) — everything else is React/DOM/canvas
primitives.

The large majority of the file (freehand pen drawing + undo/redo with keyboard shortcuts, canvas
redraw with rAF-coalescing and DPR scaling, box/rect multi-select, freeform draggable text-label tool
with autosize/drag/double-tap-to-edit, and — the strongest single sub-finding — a real
**collision-avoiding 4-side auto-flip floating-toolbar placement engine**, equivalent in spirit to a
hand-rolled Popper.js/floating-ui resolver) is a coherent, self-contained,
tldraw/Excalidraw-style annotation-canvas library with essentially **zero** OD data-model dependency.

Only a thin, already well-isolated seam is OD-specific: the iframe-snapshot/composite/submit pipeline
(`markKind()`, `data-od-active`/`data-od-render-mode` DOM attributes, `postMessage` bridge to the design
preview, the `ANNOTATION_EVENT`/`comments.ts` submission contract).

**Recommendation:** this is the clearest case in the whole sweep for a genuine port boundary at exactly
the generic/OD seam — a generic `AnnotationCanvas` component/hook emitting normalized marks + bounds,
with OD supplying the snapshot/composite/submit callback via a port. Higher-value extraction than
either `EntryShell` or `DesignKitView` in the same batch.

### 1.10 `HomeView.tsx` (2,728 lines) — **OD-SPECIFIC, confirmed**

The one file in this recon where r5's default classification holds up cleanly under a full read.
`HomeView` is essentially one function (~1,750 lines of state/handlers across 83 hook calls) that is
pure OD orchestration/glue — prompt-draft persistence, active-plugin/skill/mcp/connector "context"
selection sets, Figma-import project creation, analytics tracking — followed by ~360 lines of JSX that
is pure composition of other files' components (`HomeHero`, `RecentProjectsStrip`,
`PluginsHomeSection`, several modals). No independent UI markup exists in this file to classify — no
card grid, filter/facet UI, or carousel of its own. **No extraction candidate; genuinely OD-specific
top to bottom.**

### 1.11 `PluginsView.tsx` (2,099 lines) — **PARTIAL, meaningful yield**

The file r5's aggregate-count shortcut most likely undersold. Beyond the shell (OD marketplace/
analytics glue) and `PluginShareConfirmModal` (OD publish/contribute workflow, copy-heavy), five real
extraction candidates:

1. **`SourcesPanel`** — near-exact structural twin of the already-validated `McpClientSection.tsx`
   pattern: URL-add-form + trust-level select + list with per-item refresh/remove/trust-change actions.
   Strongest single candidate in this file.
2. **`AvailablePluginsPanel`** — a textbook marketplace search/filter/facet + card-grid + 3-way
   empty-state panel; separable if the card-body renderer becomes a slot/prop.
3. **`ImportChoice`** + **`FileImportPanel`** — small, fully generic, zero-OD-type primitives
   (tab-choice card; generic file/folder picker panel).
4. **`StatCard`** + **`Notice`** — trivial generic stat-tile and result/outcome banner primitives.
5. `PluginImportModal`'s wizard shell (tab-choice → per-kind-panel → footer) — generic once its
   GitHub-panel copy is pulled out to a prop.

**Recommendation:** partial vertical-slice extraction of these five, leaving the shell and share/publish
modal OD-specific.

### 1.12 `DesignBrowserPanel.tsx` (3,654 lines) — **PARTIAL, larger yield than expected**

r5's low-coupling read (fanout=14, od=3) undercounted real generic surface. Roughly 20-25% of the file
(600-900 lines) is a genuine, coherent "embeddable webview/iframe browser tab" primitive — navigation
stack, address-bar normalization, history/favicon utilities (`loadHistory`/`saveHistory`/
`normalizeBrowserAddress`/`faviconUrl`, all pure string/URL/localStorage functions, only residue a
renameable storage-key string), and a responsive viewport-preset switcher (`BrowserViewportControls`) —
reusable by any Jini consumer needing an in-app browser surface, not just OD.

Wrapped around it: OD-specific business logic (brand-extraction bridge registration
`registerBrandBrowser`, board-comment annotation `BrowserCommentMarkers`/`BrowserCommentComposer`, an
AI "browser-use" tool-action catalog, page-archive/brief capture for AI-agent consumption) plus hardcoded
design-inspiration bookmark content (`REFERENCE_GROUPS`) that stays OD-specific.

Additional shape-generic/OD-data components matching the `byok/*` precedent: `BrowserUseMenu`
(searchable grouped-action menu shape, OD action catalog data) and `BrowserInspectPanel` (generic
color-picker/range-slider quick-CSS-editor shape, OD element-snapshot data).

**Recommendation:** a real vertical slice for the browser-chrome core (ports for `onNavigate`/history
storage/brand-bridge registration), not the full-file treatment. Genuinely the second-strongest
"undersold by aggregate count" finding after `PluginsView.tsx`.

### 1.13 `NewProjectPanel.tsx` (3,195 lines) — **PARTIAL, several clean atoms**

Not a wizard/stepper as hypothesized — a single-screen tabbed create-form (no Next/Back progression
anywhere). Yields the cleanest small-atom harvest of the sweep:

- **`OptionCards<T>`** — generic radio-card grid, fully generic type parameter, zero OD imports.
  Strongest single extraction candidate in this file.
- **`CompactToggle`** / **`ToggleRow`** — two near-duplicate pure `{label,hint?,checked,onChange}`
  switch components, zero OD imports — a real generic UI atom, currently unshared even *within this one
  file*.
- **`FidelityCard`/`WireframeArt`/`HighFidelityArt`** — generic two-option illustrated-choice-card
  shape; only the two current SVG-art instantiations are OD content.
- **`PlatformPicker`** — generic multi-select popover/combobox interaction wrapped around
  `DESIGN_PLATFORMS` OD data — same shape-generic/type-parameter class as `QuickSwitcher.tsx`/
  `EditorIcon.tsx`.
- **`MediaModelCards`** — provider-grouped, credential-status-badged model picker; structurally the
  same pattern r5 §4 already named for `InlineModelSwitcher.tsx` (out of `@jini/ui` scope, belongs with
  `@jini/agent-runtime`/`@jini/chat-react`). Confirms this "provider-grouped model picker" shape recurs
  at least twice in OD's frontend.

**Cross-cutting methodology note:** this file's *lower* aggregate od-hit count (od=3) actually
correlates with genuinely *more* extractable generic surface than `FileWorkspace.tsx`'s much higher
count (od=20) — the opposite of what a coupling-count-only heuristic would predict, reinforcing why
this whole recon pass was necessary.

**Recommendation:** extract `OptionCards<T>`, `CompactToggle`/`ToggleRow`, and the `FidelityCard` shell
into `@jini/ui`'s generic form-control set. Flag `PlatformPicker`/`MediaModelCards` as candidates for a
future generic `MultiSelectPopover<T>`/`SearchableGroupedPicker<T>` abstraction. Leave the panel shell
and design-system/connector/template sub-pickers as OD-specific.

### 1.14 `DesignFilesPanel.tsx` (1,731 lines) — **PARTIAL**

The file-tree/browse chrome (breadcrumb nav from a flat path list, category-grouped sections,
batch-select + row context menu, drag-and-drop upload, inline rename, clipboard paste) is a classic
hierarchical-file-explorer pattern, parameterized over `ProjectFile`/`ProjectFolder` — same
generic-shape/OD-type-parameter class as elsewhere in this sweep. The kind-aware preview dispatcher
(`DfPreview`/`HtmlPreviewThumbnail`/`FilePreviewPlaceholder`) is likewise generic in shape.

OD-specific: live-artifacts row section, plugin-folder-agent-actions section, design-system-creation/
duplicate-project menu items — all tied to OD/Claude-plugin workflow concepts with no separable shape.
`RotatingTip`'s typewriter mechanic is generic but its content is hardcoded OD marketing copy, not
worth a slice alone.

**Recommendation:** a generic `AssetTreeBrowser<TFile>` + `FilePreviewPane<TFile>` slice, leaving
live-artifacts/plugin-folder/design-system-creation wiring in OD. Roughly 40% of the file is
irreducibly OD workflow logic.

### 1.15 `ConnectorsBrowser.tsx` (1,573 lines) — **FULL SLICE — cleanest full-file candidate**

Nearly the entire file is a generic "OAuth integration marketplace" UI pattern (comparable to a
Slack/Zapier app directory), OD-specific only through the `ConnectorDetail`/`ConnectorConnectResponse`/
`ConnectorStatusResponse` types and `providers/registry` fetch calls. Every mechanic generalizes:
search+filter, provider-tab bar (config-driven with a `match` predicate — currently one OD entry, but
the mechanism itself is generic), locked/gate state for missing API key, card grid, connect/disconnect
with pending+auth-pending+cancel states, a modal detail drawer with paginated tool-list, and — notably —
an OAuth `postMessage`/focus/visibility-refresh handshake with stale-auth auto-cancel that is exactly
the kind of concurrency-correctness logic worth reusing rather than re-deriving. Only OD-specific
residue: the ~90-entry Composio category→i18n label map (pure lookup-table data, not logic).

**Recommendation:** the clearest MemorySection-pattern candidate in the entire sweep — ports
(`fetchConnectors`/`connectConnector`/`disconnectConnector`/`fetchConnectorDetail`/status polling) +
generic `Connector`-shaped type + hooks (auth-pending persistence, OAuth callback handling) + a barrel
exposing grid/card/drawer. Strip the category-label map and Composio-specific auth-provider match
strings.

### 1.16 `LibrarySection.tsx` (1,401 lines) — **PARTIAL, substantial**

Second-strongest candidate after `ConnectorsBrowser.tsx`. A generic "live-updating, filterable,
multi-selectable asset grid" pattern (comparable to a photo library/DAM) is real and separable:
**rubber-band multi-select** (`snapshotCardRects`/`cardIdsInBand` — 100% generic, operates purely on
`HTMLElement` rects and `Set<string>` ids, never touches the OD asset type — the cleanest generic core
found in the whole sweep), day-bucketed timeline grouping, kind/source facet filtering, debounced
search, SSE live-merge reconciliation for incremental updates, grid/timeline view toggle, bulk-delete-
with-confirm, and keyboard shortcuts (Cmd/Ctrl+A, Esc, Delete). Kind-aware thumbnail dispatch
(`MediaThumb`/`Thumb`/`LibraryThumb`) is generic in shape, OD-specific in which kinds exist.

OD-specific and non-separable: `LibraryCard`'s "origin" action row (design-system/project/edit-as-page
navigation) and the "multi-select → add to design system" bulk action.

**Recommendation:** a generic `AssetGrid<TAsset>` slice (rubber-band select + facets + search + SSE
live-merge + day grouping + bulk delete + kind-dispatch thumbnails), leaving the origin-navigation and
design-system bulk-add logic behind.

### 1.17 `DesignsTab.tsx` (1,386 lines) — **PARTIAL — previously unclassified, real yield**

Had no prior detail beyond the r5 OD-PRODUCT default; undersold. The dashboard shell — sub-tab
filtering (recent/yours), search filter, select-mode + bulk delete, kebab menu (rename/duplicate/
delete), grid/kanban view toggle persisted to localStorage, and a **config-driven status-kanban board**
— is a genuine, separable generic "resource dashboard" pattern. Notably, the kanban's status vocabulary
(`not_started/running/awaiting_input/succeeded/failed/canceled`) reads like a generic agent-run/job
lifecycle, not an OD-specific concept — this is directly relevant to Jini's own eventual `Run`-entity
dashboard needs, plausibly reusable almost as-is. (No drag-and-drop was found in the kanban — grep for
`onDragStart`/`draggable`/`dnd` returned nothing; it's a static status-grouped board.)

OD-specific: project-card rendering (cover-thumbnail resolution across html/image/video/logo file
kinds, live-artifact iframe cards, design-system-project tagging, analytics calls throughout).

**Recommendation:** extract the dashboard shell (sub-tabs + search + select-mode/bulk-actions + kebab
menu + status-kanban board) — flag as a plausible near-term source for a Jini `RunsView`. Leave card
content/cover-resolution as OD-specific.

### 1.18 `DesignSystemsTab.tsx` (1,282 lines) — **PARTIAL — previously unclassified, real yield**

Also undersold by the default OD-PRODUCT bucket. The master-detail (list+preview) navigator shell —
search + scope-tab bar (mine/official/enterprise) + surface facet pills + category dropdown → sidebar
list → detail pane, with skeleton/empty states — is a real, separable generic pattern (a common
mail-client-style navigator), OD-specific only via the `DesignSystemSummary`/`DesignSystemDetail` types
and the specific scope/surface vocabulary. `SystemRow` (logo/palette-swatch/status-badge list row) is
generic in shape.

`DesignSystemDetail` (the majority of the file's actual logic — brand.json/DESIGN.md parsing, embeds
`DesignKitView`, publish/make-default/download/edit-with-agent actions) is genuinely OD-specific top to
bottom.

**Recommendation:** extract a generic `ListDetailPanel<TSummary, TDetail>` shell; leave
`DesignSystemDetail`'s payload as OD-specific.

### 1.19 `NewAutomationModal.tsx` (1,171 lines) — **PARTIAL**

Roughly a third of the file is reusable pattern wrapped in OD data:
- **Recurring-schedule editor** (`SchedulePopover`, kind-tabs + weekday-grid + time/timezone-select) —
  a generic "cron-lite schedule builder"; only the `RoutineSchedule` type is OD-specific.
- **@mention/capability-picker** (inline `@`-token detection, tabbed multi-category filtered results,
  removable chips) — a reusable "mention autocomplete over pluggable capability categories" widget,
  directly analogous to the `QuickSwitcher.tsx` precedent; OD-specific only via the capability data
  types (`SkillSummary`/`InstalledPluginRecord`/`McpServerConfig`/`ConnectorDetail`).
- **Popover chrome primitives** (`PillButton`, `PopoverMenu`, `PopoverItem`) — generic, no OD types.
- Timezone utilities (`detectLocalTimezone`, `listSupportedTimezones`) — pure `Intl` wrappers.

OD-specific: `FormState`/schedule-building tied to `Routine` contracts, the template-picker content
(OD's automation-template catalog), project-target picker, and the form-submit/REST-endpoint wiring.

**Recommendation:** extract the schedule-editor and mention-picker as standalone `@jini/ui` components
(`RecurringSchedulePicker`, `MentionAutocomplete`), matching the byok/McpClientSection precedent.

### 1.20 `TasksView.tsx` (1,135 lines) — **PARTIAL (thin)**

Page-level shells are generic — hero header with metric tiles + primary CTA, a tabbed filterable
template gallery (filter-tabs + card grid), and a row-list-with-expandable-run-history pattern (list
item → status meta → action buttons → lazy-loaded sub-history) — a recognizable generic "scheduled-job
list" CRUD shape. But unlike `NewAutomationModal.tsx`, OD-specific business logic (template
categorization/taxonomy, the proposals/"crystallize" evolution workflow, four hardcoded REST endpoints)
runs through nearly every function, not just the top-level types, making this a much thinner slice
candidate.

**Recommendation:** extract the three list-view shells as parameterized `@jini/ui` shells; the domain
logic (template taxonomy, proposal review, REST wiring) stays OD-specific — this file confirms the
hypothesis that "CRUD list+form shell can be generic even when the domain concept isn't," but with a
much lower generic-to-total ratio than `NewAutomationModal.tsx`.

### 1.21 `pet/PetSettings.tsx` (1,132 lines) — **OD-SPECIFIC, confirmed**

The one file (besides `HomeView.tsx`) where a full read confirms rather than overturns r5's flat
classification. The domain — a gamified desktop pet driven by proprietary "Codex atlas" spritesheet
conventions and a community pet-hatching/sharing registry — has no generic analog in a headless agent
engine. Only trivial few-line utilities are generic (`probeImageDimensions`, `copyHatchPrompt`,
an accent-swatch picker shape), none rising to slice-worthy. **No viable vertical slice; confirmed
genuinely OD-specific top to bottom.**

### 1.22 `SketchEditor.tsx` (1,088 lines) — **near-FULL SLICE — strongest find among the small files**

The majority of the file (theme-sync effect, saved/dirty-indicator timers, scene diff/save/export
glue via content-signature dedupe, `excalidrawUIOptions`/custom MainMenu composition, and especially a
**~300-line DOM-enhancement/shim toolkit** — MutationObserver-driven tooltip injection, context-menu
simplification, i18n text overrides, toast rewriting, portal/modal enhancement for Mermaid dialogs) is
solving "how do you embed and polish a third-party library (Excalidraw) that exposes no hooks for
this," not anything OD-product-specific. Roughly 60-70% of the file's logic is genuinely reusable —
the highest ratio of any file under ~2,000 lines in this sweep.

OD-specific residue, cleanly separable: legacy sketch-item migration (OD's pre-Excalidraw hand-rolled
format), the `.sketch.json`/file-model naming convention in callback contracts, OD's own i18n hook and
locale-string override tables, and `od-*` CSS class names.

**Recommendation:** a real vertical slice (ports for `onSave`/`onExportImage`/scene persistence, a
parameterized tooltip/i18n-override table) belongs in `@jini/renderers-react` or a components package
— any Jini consumer wanting an Excalidraw-backed sketch surface needs exactly this shim.

---

## 2. Memory feature-slice — piece-by-piece classification

**Location and reconciliation flag (not resolved here, per task scope):** this slice lives at
`/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/web/src/features/memory/` on branch
`refactor/web-memory-slice` (PR #5228) — a **different local clone/branch** than the one backing
`foundry/integrations/open-design/reference/components-original/` (that snapshot's tracked `main` does **not**
have this slice merged; `MemorySection.tsx` is still 2,636 lines there, confirmed by r4/r5). Before any
extraction PR lifts pieces of this slice into `@jini/*`, a Coordinator/Software-Architect-Agent decision
is needed on which repo/branch is authoritative and whether Jini's OD snapshot needs re-vendoring from
the branch with this slice merged. **This recon flags but does not decide that question.**

r4-webui.md §2 already reviewed the slice's *architecture pattern* (ports+dependencies+barrel,
ADR 0002) and concluded: adopt the pattern, drop the ADR's "no shared hooks" anti-reuse rule at the
package boundary. This section goes further — classifying the slice's actual *pieces*.

### Ready to lift almost as-is (generic engine primitives)

| Piece | Why |
|---|---|
| `async-commit-guard.ts` (40 lines) | Pure concurrency primitive — monotonic revision guard for ordering async reads against local writes. Zero domain coupling; ship unchanged into a shared hooks-utils module. |
| `hooks/useMemoryExtractions.store.ts` | **The single most reusable artifact in the slice.** A pure (no React, no transport) state machine reconciling three concurrent fact sources (SSE push, GET pull, local optimistic mutation) via explicit ordering rules (client-clock, server-progression, tombstone-permanence). Would work verbatim for a run-history, job-queue, or notification-feed store — not memory-specific at all. |
| `rules.ts`'s connector-list reducers (`mergeMemoryConnector`, `upsertMemoryConnector`, `applyMemoryConnectorStatus(es)`, `connectorWithPendingAuthorization`, `connectorStatusesChanged`) | A generic "reconcile live status onto a cached connector catalogue" toolkit — pairs naturally with `McpClientSection.tsx`'s and `ConnectorsBrowser.tsx`'s connector-list patterns (§1.15); likely the same underlying need surfacing a third time. |
| `formatters.ts` time/byte formatters (`formatRelativeTime`, `formatAbsoluteTime`, `formatDuration`, `formatRelativeTimeAgo`, `formatConnectorContextBytes`, `memoryCountLabel`) | Zero domain coupling. |
| `hooks/useMemoryFlash.hooks.ts` | Generic timed-confirmation-pill hook. |
| Component shapes: `MemoryEntryCard.tsx`, `MemoryExtractionCard.tsx`, `MemoryList.tsx`, `MemoryAdvancedModal.tsx` | Presentational, low-coupling — same generic-shape-plus-type-parameter class as `EditorIcon.tsx`/`QuickSwitcher.tsx`. |

### Need genericization work first (real but bounded)

| Piece | What needs to change |
|---|---|
| `hooks/useMemoryConfig.hooks.ts` (per-flag optimistic write-queue) | Generic state shape; hard-typed against 4 OD-specific flag keys (`chatExtractionEnabled`/`profileEnabled`/`rewriteEnabled`/`verifyEnabled`) — genericize the flag set to a type parameter. |
| `hooks/useMemoryEntries.hooks.ts` (race-safe CRUD list) | Generic "list+tree+filter+preview+edit with monotonic tokens" shape; data types are OD-shaped but structurally generic (id/name/description/type/tree). |
| `hooks/useMemoryConnectors.hooks.ts` (connect→scan→suggest→save pipeline) | Excellent generic state-management pattern — arguably the most valuable hook-level find for any "import content from connected apps" feature — but hard-typed to a 6-app OD catalogue, `chatAgentId`/`chatModel` context param, and English copy strings inlined directly in state setters rather than routed through formatters. |
| `MemoryConnectedPanel.tsx`, `MemoryManualEditor.tsx` | Generic panel/form shapes; pull in OD-branded child components (`ConnectorLogo`, `@open-design/components` `Button`) and hardcoded copy needing host-injected slots. |
| `formatters.ts`'s `providerDisplayName`/`memoryTypeLabels`/`memorySourceTabs`/`memoryFlashLabels` | Generic lookup-table *pattern*, OD-specific *table contents* — straightforward to make host-configurable maps. |
| `ports.ts`'s `MemoryConnectorsPort.suggestConnectorMemories` | Generic port shape overall; the `context: {chatAgentId, chatModel}` param is OD-specific and should become a generic extraction-context type parameter. |

### Pure OD glue — stays behind in `foundry/integrations/open-design/`

- `dependencies.ts` in full — by design, the adapter; the template for how a *host* wires its own
  transport to the port interfaces, not something that moves to the engine.
- `constants.ts`'s `TYPES` (OD's `MemoryType` taxonomy — profile/user/feedback/project/reference/rule,
  explicitly documented as tied to OD's "intent gateway"/"post-turn self-verify" LLM features), `STARTERS`,
  `MEMORY_CONNECTOR_APP_IDS/LABELS` (hardcoded 6-app Composio catalogue), and
  `CONNECTOR_CALLBACK_MESSAGE_TYPE` — a literal `'open-design:connector-connected'` string that would
  trip the neutrality guard verbatim.
- `rules.ts`'s `MemoryConfigFlagKey`/`enabledPatch`/`singleFlagPatch` — OD's chat-extraction/profile/
  rewrite/verify hook pipeline is a genuinely OD-specific LLM-prompt-composition feature, not a generic
  "memory" concept.
- `formatters.ts`'s `describeExtractionFailure` (hardcodes "OpenDesign could not...") and
  `MemoryHowPanel.tsx` (hardcodes OD's specific onboarding→brand→chat-signals extraction-pipeline
  diagram and copy verbatim) — the clearest examples in the slice of "what gets extracted from" and
  literal product-name copy, exactly the non-portable category the task brief called out.

**Bottom line:** the Memory slice is a strong architecture-pattern template (per r4) *and*, at the
piece level, contains at least 3 genuinely drop-in-reusable artifacts (the extraction-store state
machine, the async-commit-guard, the connector-reconciliation reducers) plus several MIXED
hook-level patterns worth genericizing. The taxonomy (`MemoryType`), the specific 6-connector catalogue,
and all literal OD copy/product-name strings are the parts that must stay behind.

---

## 3. Cross-cutting patterns discovered across multiple files

Several generic patterns recurred **independently** across unrelated god-components — evidence these
are real missing shared primitives, not one-off coincidences:

| Pattern | Where it recurs | Implication |
|---|---|---|
| **"URL/OAuth source add + trust/status + list + per-item test/refresh/remove"** (the McpClientSection archetype) | `McpClientSection.tsx` (own file), `byok/*`, `PluginsView.tsx`'s `SourcesPanel`, `ConnectorsBrowser.tsx`, Memory slice's connector reducers, `EntryShell.tsx`'s `OnboardingByokSetupPanel` | This is the single most-repeated shape in the entire sweep — appears in at least 6 independent places. A generic `SourceConfigList`/`ConnectorCatalog` primitive would consolidate real, currently-duplicated work. |
| **"Viewer toolbar + viewer body" shell** | 9 components inside `FileViewer.tsx` | Strongest intra-file repetition found; textbook missing shared primitive. |
| **"Progress bar + status icon + step/todo list" card** | `WorkspaceActivityCard` + `GenerationStatusCard` in `DesignSystemFlow.tsx` (independently implemented twice against different data), conceptually also `RevisionDiffCard`/`RevisionHistoryList` | Directly on-domain for Jini's own `Run`/`Agent`/`Tool` vocabulary — higher priority than a purely "generic UI" finding. |
| **Draggable/reorderable tab-strip item** | `WorkspaceTabsBar.tsx`, `FileWorkspace.tsx`'s inline `Tab` (independently reimplemented, not shared even within OD's own codebase) | Confirms this needs consolidating, not just extracting once. |
| **"Cap N mounted iframes, LRU-evict the rest"** | `IframeKeepAlivePool.tsx` (r5 §3), `FileWorkspace.tsx`'s inline browser-webview keep-alive | Third occurrence of the same technique; worth a real shared hook. |
| **Provider-grouped, credential-status-badged model picker** | `InlineModelSwitcher.tsx` (r5 §4, chat/agent-runtime scope), `NewProjectPanel.tsx`'s `MediaModelCards` | Confirms the pattern recurs at least twice; needs the same `@jini/chat-react`/`@jini/agent-runtime`/`@jini/ui` boundary ruling r5 already called for. |
| **Master-detail (list+preview) navigator** | `DesignSystemsTab.tsx`, conceptually `PluginsView.tsx`'s detail modal, `ProjectView.tsx`'s composition | A generic `ListDetailPanel<TSummary,TDetail>` would serve more than one consumer. |
| **Rubber-band / marquee multi-select** | `LibrarySection.tsx` (cleanest instance — zero domain types touched) | Not repeated elsewhere in this sweep, but flagged as a uniquely clean, portable primitive. |

---

## 4. Recommendation summary

**Bucket counts across the 23 god-components (r5's remaining >900-line files after excluding the 3
chat files):**

| Verdict | Count | Files |
|---|---:|---|
| FULL SLICE (near-whole-file vertical slice) | 2 | `ConnectorsBrowser.tsx`, `PreviewDrawOverlay.tsx` |
| Strong PARTIAL (substantial generic yield, ≥25% of file) | 5 | `SketchEditor.tsx`, `DesignBrowserPanel.tsx`, `LibrarySection.tsx`, `PluginsView.tsx`, `SettingsDialog.tsx` (shell + several tabs) |
| Moderate PARTIAL | 11 | `FileViewer.tsx`, `DesignSystemFlow.tsx`, `NewProjectPanel.tsx`, `DesignFilesPanel.tsx`, `DesignsTab.tsx`, `DesignSystemsTab.tsx`, `NewAutomationModal.tsx`, `EntryShell.tsx`, `DesignKitView.tsx`, `WorkspaceTabsBar.tsx`, `TasksView.tsx` |
| Thin PARTIAL (one small utility in an otherwise OD-specific file) | 3 | `ProjectView.tsx`, `FileWorkspace.tsx`, `HomeHero.tsx` |
| OD-SPECIFIC (confirmed by full read, no viable extraction) | 2 | `HomeView.tsx`, `pet/PetSettings.tsx` |

**Zero files warrant "flat OD-PRODUCT, no read needed."** This is the central finding of the recon:
the r5 aggregate-coupling shortcut would have under-extracted real, valuable, sometimes
McpClientSection-grade generic material in at least 18 of the 23 files, and even the two files that
most closely confirm a flat classification (`HomeView.tsx`, `pet/PetSettings.tsx`) required a full read
to establish that with confidence, not an assumption from import counts.

**Priority order for a Coordinator/Software Architect Agent scheduling actual extraction work:**

1. **`ConnectorsBrowser.tsx`** — cleanest full-file vertical-slice win; directly reusable for any
   Jini consumer needing an integration/connector marketplace, and it consolidates a pattern (URL/OAuth
   source config) that independently recurs in at least 5 other places in this sweep.
2. **`PreviewDrawOverlay.tsx`** — a nearly-complete, zero-OD-dependency annotation-canvas library
   behind a thin, already-isolated OD seam. Second-cleanest full-file win.
3. **The recurring "progress/status card" pattern in `DesignSystemFlow.tsx`** — directly on-domain for
   Jini's `Run`/`Agent`/`Tool` vocabulary; higher strategic value than a purely generic-UI finding.
4. **`SketchEditor.tsx`**'s Excalidraw-integration shim — needed by any consumer embedding Excalidraw
   without forking it; ~60-70% of the file is this shim.
5. **Consolidate the McpClientSection-archetype duplicates** (`byok/*`, `PluginsView.tsx`'s
   `SourcesPanel`, `ConnectorsBrowser.tsx`, Memory slice's connector reducers, `EntryShell.tsx`'s BYOK
   panel) into one shared primitive rather than treating each as an independent extraction — same
   pattern, at least 6 places.
6. **`SettingsDialog.tsx`**'s shell + the 4-5 clean tabs (`appearance`/`notifications`/`language`/
   `instructions`/`integrations`) — half the tab-splitting work is effectively already proven by the 8
   tabs already living in their own files.
7. **`LibrarySection.tsx`**'s rubber-band select + asset-grid shell, and `DesignsTab.tsx`'s status-kanban
   dashboard shell — both plausible near-term sources for Jini's own list/dashboard UI needs, beyond
   their value as pure OD-decoupling wins.
8. The remaining "moderate" and "thin" PARTIAL files — lower urgency, smaller individual yield, but each
   contains at least one legitimate small atom (`OptionCards<T>`, `CompactToggle`/`ToggleRow`,
   `BrandLogo`, `HeaderActionsMenu`, `scrollWorkspaceTabsWithWheel`, `useResizableSplitPane`,
   `home-hero/EdgeAutoScroll.tsx`) worth batching into a single `@jini/ui` "atoms" sweep rather than
   individual extraction PRs.

**Reconciliation items flagged for the Coordinator (not resolved by this recon):**
- The Memory slice's authoritative source-of-truth branch question (§2) — same open item r5 §7 already
  flagged for the chat-pane/chat-composer slices, now confirmed to apply to Memory too.
- `WorkspaceTabsBar.tsx`'s coupling was undersold by r5 in the same direction as the god-components —
  a second, smaller instance of the same aggregate-count blind spot, now corrected in §1.3.
- Several god-components (`FileViewer.tsx`, `ProjectView.tsx`, `FileWorkspace.tsx`) have prior
  checkpoint/draft branches (per `ADS-memory/reports/jini-port/od-reference-branches.md`) attempting full decomposition
  that never merged; this recon's finding that their bulk is genuinely, deeply OD-specific (especially
  `ProjectView.tsx`'s cross-cutting-not-tabbed structure) is independent corroborating evidence for why
  those attempts stalled, not a contradiction of them.
