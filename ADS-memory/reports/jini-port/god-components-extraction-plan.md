# God-component extraction plan — the actual task list

Derived from `ADS-memory/reports/jini-port/recon/r6-god-component-internals.md`'s priority order (§4). Source
files are vendored at `foundry/integrations/open-design/reference/components-original/`. Pattern: the
`MemorySection.tsx` refactor (`ADS-memory/reports/jini-port/od-reference-branches.md`'s PR #5228) — ports +
dependencies + hooks + presentational components + barrel `index.ts`, same discipline already
proven by `features/chat-pane`/`features/chat-composer`/`ConnectorsBrowser`-shaped work.

**Canary policy:** do `ConnectorsBrowser.tsx` alone first, verify it end-to-end (typecheck, tests,
guard, a real review of what shipped), and only then dispatch the rest of this list. Don't batch
multiple FULL SLICE items in parallel until the canary proves the pattern holds up for a cloud
session working from this plan doc alone.

**i18n policy (added after the canary's first pass got this wrong):** the vendored
`fixing-open-design-web/SKILL.md` says to preserve i18n keys verbatim — correct for its native
context (refactoring *inside* OD's own codebase, where OD's dictionaries stay in scope), but this
plan is extracting *into a different package* (`@jini/ui`) with its **own**, separate
`features/i18n` mechanism. Do NOT read "preserve i18n keys" as license to drop i18n from the ported
component — and do NOT read "OD's translated copy is product content, don't ship it" as license to
drop the *mechanism* either (that was the canary's first-pass mistake, self-corrected afterward).
The two are separable: OD's actual translated dictionaries are genuinely product content and should
NOT be ported, but `@jini/ui`'s `useT()` hook is a zero-cost no-op when unconfigured — `t(key)`
returns `key` verbatim with no `I18nProvider` mounted. The convention is **the English string itself
is the key** (`t('Connect')`, not a namespaced key like `t('connectors.connectLabel')`), so wrapping
every user-facing string costs nothing today and makes the component translatable for free later.
Wrap every user-facing string (JSX text, `aria-label`, `title`, default prop values for
label/message props) in `useT()`'s `t()`. Pure logic modules (a `rules.ts` with no React) stay
hook-free by design — wrap their return value at the call site instead (`t(statusLabel(status))`),
don't thread `t` into them. Verify the wiring actually works with a real test that mounts the
component under `I18nProvider` with a dictionary and asserts the translated text renders — a test
suite that only exercises the unconfigured/passthrough case cannot catch a hardcoded literal that
was never wrapped in the first place.

**React-layout policy (decided 2026-07-17, see `packages/ui/README.md`):** within every
`features/<domain>/` folder — new or being re-touched — files with zero React import (`types.ts`,
`constants.ts`, `rules.ts`, `ports.ts`, `dependencies.ts`, the barrel `index.ts`) stay at the
feature's top level; `hooks/` and `components/` (anything importing React) move under a `react/`
subfolder: `features/<domain>/react/{hooks,components}/`. This is deliberately a lighter
motivation than the `@jini/chat-core`/`@jini/chat-react` package split — there is no named non-React
consumer of `@jini/ui` driving it, so it stops at "keep the pure and React layers visibly separate
within one package" rather than a full package split with peer-dependency/export-map machinery.
`features/connectors/` and `features/progress-card/` (already shipped) still use the old flat
layout (`hooks/`, `components/` directly under the feature) — not yet retrofitted; new work should
use the new layout, and don't take their exact paths as the template, just their internal
discipline.

---

## Required cloud-dispatch preflight

Every cloud task for an item in this plan must start by recording, before any
edit, the source branch and commit SHA, Jini destination package, task branch,
and full validation command set. It must then prove it read the primary
`MemorySection` canary from the same OD branch:

- `apps/web/src/features/memory/`
- `apps/web/src/providers/memory/`
- `apps/web/tests/features/memory/`
- `docs/adr/0002-frontend-vertical-slice-decomposition.md`
- `apps/web/AGENTS.md`
- `scripts/check-web-slice-boundaries.ts`

The task must also enumerate the target's live callers and identify the
product-only adapter seam. If the branch cannot supply any of these references,
the task reports the gap and stops; a vendored snapshot is evidence only, never
a substitute for current source. Cloud tasks work on a task branch and open a
draft PR; they do not push directly to `main`.

`foundry/automation/project-runner/cloud-routine-prompts/god-component-extraction.md`
is the runnable template that enforces this gate for the next item.

---

## Consolidation map — where every remaining file actually lands (2026-07-17)

**Why this exists:** `r6-god-component-internals.md` correctly *identifies* several patterns that
recur across multiple god-files (§3, its cross-file pattern table), but only 2 of those clusters
(connector/source config, progress-card) were ever promoted into this plan's dispatch list — the
rest existed only as recon analysis. Without this written down, dispatching each remaining file cold
means re-deriving the grouping ad hoc every time, which risks 2-3 near-duplicate extractions landing
in separate feature folders that then need merging later (exactly the failure mode already flagged —
and not yet resolved — for the connector/source-config cluster below). Every dispatch prompt for an
item in this plan should reference this section for its target destination, not invent one.

Three destination *kinds*, not just "own feature folder":
- **Shared feature** — multiple source files feed one `packages/ui/src/features/<name>/` (or
  equivalent package) because the same interaction shape recurs more than once.
- **Own feature** — one source file yields one self-contained slice with no known duplicate
  elsewhere in this sweep.
- **Flat `components/`/`hooks/`/`utils/`** — the yield is a small, stateless, single-purpose
  primitive (matches the bucket-A treatment `Icon.tsx`/`Toast.tsx`/etc. already got) — a `features/`
  folder would be ceremony for something with no feature-local state or ports.

### A. Shared features (multiple sources → one destination)

| Target | Sources | Notes |
|---|---|---|
| `features/connectors/` (already exists — the canary) | `ConnectorsBrowser.tsx` (✅ done) | **Resolved (2026-07-17), narrower than first thought.** This is an OAuth-catalog-browse shape (search/filter a catalog, click to OAuth-connect, disconnect) — genuinely different from the shape below. Only Memory slice's connector *reducers* (not its UI) actually reuse this feature: `@jini/ui`'s shipped `features/connectors/rules.ts` already has `mergeConnectors`/`applyConnectorStatuses`/`hasConnectorStatusChanges`/`connectorAuthSnapshotChanged`, which substantially overlap Memory's `mergeMemoryConnector`/`applyMemoryConnectorStatus(es)`/`connectorStatusesChanged` (r6 §2 line ~546). When Memory slice work happens, check whether it can import these directly instead of re-deriving equivalents — a real, low-risk win, but a rules-level one, not a UI-component fold-in. |
| `features/source-config-list/` (new — generic `SourceConfigList`) | `McpClientSection.tsx`, `byok/*` (6 files), `PluginsView.tsx`'s `SourcesPanel` (§1.11), `EntryShell.tsx`'s `OnboardingByokSetupPanel` (§1.7, reinforces not newly discovers) | **Formerly bundled with `features/connectors/` above — split out (2026-07-17) because the interaction shape actually differs.** This is "add a source by URL/key + set trust level + list + per-item test/refresh/remove," not OAuth-catalog-browse. Still the single most-repeated shape in the whole sweep (4 places once split from the connectors cluster). `ui-extraction-plan.md`'s Bucket B previously targeted `byok/*` → `src/features/byok-config/` and `McpClientSection.tsx` → `src/features/mcp-config/` as two *separate* slices — that's now superseded; both fold into this one shared primitive instead, `ui-extraction-plan.md` updated to point here. |
| `features/progress-card/` | `DesignSystemFlow.tsx`'s `WorkspaceActivityCard`+`GenerationStatusCard` (✅ landed, PR #1) | r6 §3 also lists `RevisionDiffCard`/`RevisionHistoryList` (same file, §1.5) as conceptually related ("status-badged... progress bar + status icon" family) — not confirmed identical, still worth evaluating together before extracting either. |
| `features/tab-strip/` | `WorkspaceTabsBar.tsx` (1,220 lines, §1.3 addendum), `FileWorkspace.tsx`'s inline `Tab` (§1.4) | **✅ landed 2026-07-18, partial slice — the shared tab-strip-item primitive only, not a full `WorkspaceTabsBar.tsx` port.** Shipped `TabStrip`/`TabStripItem`/`useTabStripDragReorder`: drag-to-reorder (`'live'`-vs-`'onDrop'` timing, pinned-tab drop-edge coercion, per-tab draggable override), active/close-button affordances, host-injected tab content — proven against both source shapes via a dual-shape test. Deliberately NOT included (stays host-composed, per the task's own scope): `WorkspaceTabsBar.tsx`'s hover-preview popover, search-tabs popover, global keyboard shortcuts, and `localStorage`/`Route`-sync persistence — a fuller port of that component (the 3-things-to-parameterize note below still applies to it) remains open. `FileWorkspace.tsx`'s `scrollWorkspaceTabsWithWheel` is a separate atom in the plan's §7 batch sweep, not part of this slice. See `packages/ui/source-map.md`'s `features/tab-strip/` section. **Naming reconciled (2026-07-17):** `ui-extraction-plan.md`'s Bucket B previously named this same target `features/workspace-tabs/` and additionally listed `workspace/`'s `SideChatTab.tsx`/`TabLauncherMenu.tsx` as sources — `features/tab-strip/` is now the canonical name (updated in both docs). `SideChatTab.tsx`/`TabLauncherMenu.tsx` were only described at a shallow "tab-bar UI, low coupling" level (r5 §2), not verified at the depth `WorkspaceTabsBar.tsx` got (r6 §1.3) — treat their overlap with this target as an **unverified hypothesis, not a confirmed fold-in**: read `WorkspaceTabsBar.tsx`'s actual tab-strip-item shape first, then check whether `SideChatTab.tsx` is really the same shape or a different "tab launcher" concept before merging them in. `WorkspaceTabsBar.tsx` itself needs 3 things parameterized before it generifies further (its own full port, not this primitive): the tab-kind union, route-mapping functions, and storage/event key names (two of which are literal product-identity strings that would trip the neutrality guard verbatim). |
| `features/list-detail-panel/` (generic `ListDetailPanel<TSummary,TDetail>`) (✅ landed 2026-07-18) | `DesignSystemsTab.tsx` (§1.18) | **Resolved (2026-07-18)**: read `PluginsView.tsx`'s detail modal and `ProjectView.tsx`'s composition in full from a fresh OD clone — neither shares this shape. `PluginDetailsModal.tsx` is a `createPortal` overlay opened from a card click (no persistent list+synced-selection), and `ProjectView.tsx`'s composition is the already-ported `useResizableSplitPane` 2-pane resize, not a list-of-summaries. `DesignSystemsTab.tsx` was the only real source; shipped as a `DesignSystemsTab.tsx`-scoped (but still genuinely generic, real-TypeScript-generic) primitive rather than a guessed-at broader shape. See `packages/ui/source-map.md`. |
| Blocked — provider-grouped model picker | `NewProjectPanel.tsx`'s `MediaModelCards` (§1.13), `InlineModelSwitcher.tsx` (r5 §4, not one of these 23 files) | Confirmed recurring shape, but straddles the `@jini/ui` vs `@jini/chat-react`/`@jini/agent-runtime` package boundary r5 already flagged as unresolved. Don't dispatch either half until that boundary ruling happens — extracting `MediaModelCards` into `@jini/ui` first risks landing on the wrong side of a line not yet drawn. |
| Not yet actionable — iframe keep-alive LRU | `FileWorkspace.tsx`'s inline browser-webview cache (§1.4) | Third occurrence of the "cap N mounted iframes, LRU-evict" pattern (after `IframeKeepAlivePool.tsx`, r5 §3 — outside this 23-file sweep). §1.4's own read calls this instance "not independently extractable without a rewrite." Recognize it as a future third consumer once `IframeKeepAlivePool.tsx` itself gets a real slice; nothing to dispatch here yet. |

**5 more overlaps spotted while building this map, not in r6's own cross-file table** (r6's 9
parallel sub-analyses each read 2-5 files in isolation — nothing forced a side-by-side compare
across all 23 until now; the last 2 below came from reconciling this doc against
`ui-extraction-plan.md`'s coverage of the other ~230 non-god-sized files):

- **Viewport-preset switcher, twice — RESOLVED (2026-07-17), confirmed same shape, landed on BOTH sides
  independently.** `FileViewer.tsx`'s `PreviewViewportControls`/`FileVersionViewportControls` (§1.1,
  "self-contained responsive desktop/tablet/mobile viewport switcher, zero business types") and
  `DesignBrowserPanel.tsx`'s `BrowserViewportControls` (§1.12, "a responsive viewport-preset switcher")
  were diffed directly in two separate sessions and confirmed identical (same 3-preset dimensions, same
  origin i18n keys, same dropdown-trigger+listbox outside-click/Escape wiring). **Note: this produced
  two independent implementations that need reconciling, not one** — `browser-chrome/`'s session shipped
  `BrowserViewportControls` as the canonical primitive first; `viewer-shell/`'s session, working in
  parallel, shipped its own `ViewportSwitcher` in `features/viewer-shell/` before that landed. Both are
  the same shape. Whichever extraction merges second should fold its version onto the other's (or a
  shared home) rather than shipping both — flagged here so it isn't missed. `FileVersionViewportControls`
  is a real second, disclosed shape (inline toggle-button group vs. dropdown, shipped as
  `ViewportToggleGroup` in `viewer-shell/`) — not a duplicate, still correctly separate. See
  `packages/ui/source-map.md`'s `features/browser-chrome/` and `features/viewer-shell/` sections for
  both write-ups.
- **Resource-dashboard shell, twice, both directly Run-vocabulary-relevant**: `DesignsTab.tsx`'s
  dashboard shell (§1.17 — sub-tabs, search, bulk-actions, a **config-driven status-kanban** whose
  vocabulary `not_started/running/awaiting_input/succeeded/failed/canceled` "reads like a generic
  agent-run/job lifecycle") and `TasksView.tsx`'s list shells (§1.20 — hero+metric-tile header,
  tabbed template gallery, **row-list-with-expandable-run-history**, "a recognizable generic
  scheduled-job list CRUD shape"). Both are independently flagged as plausible sources for Jini's own
  future run/job dashboard. Building these as two separate primitives risks shipping two competing
  "Run list" shapes when Jini only needs one — evaluate together, likely as one
  `features/resource-dashboard/` (or a name that doesn't presuppose "design" — this is the single
  most core-engine-relevant cluster in the whole sweep and deserves care over speed).
- **Choice-card shape, maybe three times**: `EntryShell.tsx`'s `OnboardingChoiceCard` (§1.7, "generic
  accessible choice card: icon/title/body/benefits/badge/selected state") and `NewProjectPanel.tsx`'s
  `OptionCards<T>`/`FidelityCard` (§1.13, "generic radio-card grid" / "two-option illustrated-choice-
  card shape") all describe a selectable card with icon/title/body — not confirmed identical (could
  be 2-3 genuinely distinct shapes that just sound similar in prose), but worth a direct read-side-by-
  side before extracting more than one "choice card" primitive.
- **Icon-by-key renderer, twice**: the already-ported `Icon.tsx` (bucket A, `packages/ui/src/
  components/Icon.tsx`) and `EditorIcon.tsx` (r5 §5, "same shape as `Icon.tsx`," keyed by OD's
  `HostEditorId`) render the identical pattern — a lookup table mapping a string key to an SVG/icon.
  Never resolved whether `EditorIcon.tsx` should just become a data config passed to the existing
  `Icon.tsx` (a new icon set registered under a different key namespace) rather than its own
  component. Check this before porting `EditorIcon.tsx` as a separate file.
- **"Type a trigger character, get a filtered picker" shape, maybe three times**: `QuickSwitcher.tsx`
  (r5 §5, Cmd-K-style fuzzy switcher, typed on OD's `WorkspaceContextItem`/`ProjectFile`),
  `NewAutomationModal.tsx`'s `@mention`/capability-picker (already named in this plan's §1 item 5 as
  "directly analogous to the `QuickSwitcher.tsx` precedent" — the only pair r6 itself cross-referenced),
  and `composer/*`'s Lexical `@mention` system (`MentionNode.ts` + siblings, r5 §2, "generic Lexical
  rich-text/mention editor primitive," `ui-extraction-plan.md`'s target `features/rich-text-input/`).
  All three are "type a trigger, filter a list, pick an item" interactions; whether the rich-text
  editor's inline `@mention` really shares a component-level shape with a Cmd-K modal switcher (as
  opposed to just superficially both being "autocomplete") hasn't been checked — read all three
  side by side before committing to 3 separate primitives.

### B. Own feature (single source, no known duplicate elsewhere in this sweep)

| Target | Source | 
|---|---|
| `features/annotation-canvas/` | `PreviewDrawOverlay.tsx` (❌ reverted 2026-07-17 — a first attempt via Codex Cloud landed with 2 undisclosed gaps found on independent review, submit-action picker + keyboard shortcuts, and skipped the branch+draft-PR convention; the merged code was reverted, `packages/renderers-react` is back to a placeholder stub. Open again — see `god-component-extraction.md`) |
| `features/sketch-editor/` (or `@jini/renderers-react`) | `SketchEditor.tsx`'s Excalidraw-integration shim |
| `features/asset-grid/` (generic `AssetGrid<TAsset>`) (✅ landed 2026-07-17, redo — see `packages/ui/source-map.md`) | `LibrarySection.tsx` — rubber-band multi-select (the single cleanest generic core in the whole sweep, per §1.16), facets, debounced search, SSE live-merge, day-bucketed grouping, kind-dispatch thumbnails |
| `features/asset-tree-browser/` (generic `AssetTreeBrowser<TFile>` + `FilePreviewPane<TFile>`) | `DesignFilesPanel.tsx` |
| `features/browser-chrome/` (embeddable webview/iframe browser tab) | `DesignBrowserPanel.tsx` — nav stack, address-bar normalization, history/favicon utilities, ports for `onNavigate`/history storage/brand-bridge registration (✅ partial slice shipped 2026-07-17 — the listed pieces only, not the full file; webview/iframe embedding, brand-extraction logic, comment annotation, the AI browser-use catalog, and `REFERENCE_GROUPS` stay in OD. `BrowserUseMenu`/`BrowserInspectPanel` deferred, not silently dropped. Shipped its own `BrowserViewportControls`, which duplicates `viewer-shell/`'s `ViewportSwitcher` — see the viewport-preset-switcher overlap note above, needs reconciling. See `packages/ui/source-map.md`.) |
| `features/viewer-shell/` (the 9-times-repeated "viewer toolbar + body" shell) (✅ done 2026-07-17) | `FileViewer.tsx` — `BinaryViewer`/`DocumentPreviewViewer`/`ImageViewer`/`SketchViewer`/`VideoViewer`/`AudioViewer`/`SvgViewer`/`TextViewer`, plus `CommentSidePanel`/`CommentSideDock` and the `MarkdownViewer` split-pane. Shipped as `packages/ui/src/features/viewer-shell/` — see `packages/ui/source-map.md` for the full writeup, including two gaps this row's own description didn't call out (the comment-label/timestamp derivation is OD-specific *logic*, not just an OD-specific type; `MarkdownViewer`'s coupling goes well beyond "just the artifact-status gate" — its autosave/upload/rendering/highlighting pipeline was also dropped, not ported). |
| `features/settings-dialog/` (shell) + `features/settings-dialog/tabs/{appearance,notifications,language,instructions,integrations}` | `SettingsDialog.tsx` — shell is reusable chrome (8 of 17 tabs already separate files prove it); `integrations` needs its hardcoded `'open-design'`-branded MCP-install-snippet strings parameterized (same shape-class as `McpClientSection`, installer-direction-reversed — plausibly worth a note in the connectors cluster above, since it's the mirror image, even though it doesn't share code today); `privacy` still needs the r6-flagged follow-up verification before it's added to this list |
| `features/schedule-picker/` (`RecurringSchedulePicker`) | `NewAutomationModal.tsx` |
| `features/mention-autocomplete/` (`MentionAutocomplete`, same shape as the existing `QuickSwitcher.tsx` precedent) | `NewAutomationModal.tsx` |
| `hooks/useResizableSplitPane` | `ProjectView.tsx` (the one genuine exception in an otherwise ~99%-OD-specific 9,907-line file) |

### C. Flat `components/`/`hooks/`/`utils/` (small atoms — bucket-A treatment, not a `features/` folder)

- **Components**: `BrandLogo`, `HeaderActionsMenu` (`DesignKitView.tsx`); `OptionCards<T>`,
  `CompactToggle`/`ToggleRow` (`NewProjectPanel.tsx` — see the choice-card overlap flagged above
  before treating these as fully separate from `OnboardingChoiceCard`); `PillButton`/`PopoverMenu`/
  `PopoverItem` (`NewAutomationModal.tsx`); `StatCard`/`Notice`, `ImportChoice`/`FileImportPanel`
  (`PluginsView.tsx`); `OnboardingDropdown`/`OnboardingChipField`/`OnboardingPanelHeader`
  (`EntryShell.tsx`); `CodeWithLines`/`JsonPanel` (`FileViewer.tsx`)
- **Hooks**: `scrollWorkspaceTabsWithWheel` (`FileWorkspace.tsx`); `home-hero/EdgeAutoScroll.tsx`
  (`HomeHero.tsx` — already isolated, ship as-is); `useBrandFonts` (`DesignKitView.tsx`, genericize
  its fetch-URL-builder parameter)
- **Utils**: `designMd*` markdown-heading-slice utilities (`DesignKitView.tsx`); `detectLocalTimezone`/
  `listSupportedTimezones` (`NewAutomationModal.tsx`, pure `Intl` wrappers); color-contrast/luminance/
  hex-mixing math (`DesignSystemFlow.tsx`, travels with whichever token-chip feature ends up
  consuming it)

### D. Confirmed OD-specific — do not attempt (full read already done, see §2 below for the rest)

`HomeView.tsx`, `pet/PetSettings.tsx` (both r6 §1.10/§1.21, joining the list in the existing §2
below).

---

## 0. Canary — `ConnectorsBrowser.tsx` (1,573 lines)

**Verdict (r6 §1.15): FULL SLICE — cleanest full-file candidate in the whole sweep.** Nearly the
entire file is a generic "OAuth integration marketplace" UI (comparable to a Slack/Zapier app
directory). OD-specific only via `ConnectorDetail`/`ConnectorConnectResponse`/`ConnectorStatusResponse`
types, `providers/registry` fetch calls, and a ~90-entry Composio category→i18n label lookup table
(pure data, not logic).

**Target:** `packages/ui/src/features/connectors/` (or reconsider naming once the McpClientSection-
archetype consolidation below happens — this may become the shared primitive other slices bind to,
not just its own isolated feature).

**What ships:**
- `ports.ts` — `fetchConnectors`/`connectConnector`/`disconnectConnector`/`fetchConnectorDetail` +
  status polling, typed against a **generic** `Connector` shape (not `ConnectorDetail` verbatim —
  strip Composio-specific fields, generify).
- `dependencies.ts` — the one file that would bind a real transport (a host supplies this; ship a
  fake/test double in this package, not a real `providers/registry` call).
- `hooks/` — auth-pending persistence, the OAuth `postMessage`/focus/visibility-refresh handshake
  with stale-auth auto-cancel (r6 flags this concurrency-correctness logic as worth keeping intact,
  not simplifying).
- `components/` — search+filter, provider-tab bar (config-driven, keep the `match`-predicate
  mechanism generic even though only one entry exists today), locked/gated state for missing API
  key, card grid, connect/disconnect state UI, modal detail drawer with paginated tool list.
- Drop: the ~90-entry Composio category→i18n label map (OD-specific data, not logic — a host
  supplies its own category labels).
- `index.ts` — public barrel.

**Gate for calling the canary successful:** typecheck/test/guard all green, `source-map.md` written
with the same rigor as every prior package, no product-identity strings, real tests exercising the
OAuth handshake states (pending/authenticated/stale-cancel), not just the presentational shell, and
(per the i18n policy above) every user-facing string wired through `useT()` with an `I18nProvider`
end-to-end test proving it — the canary's first pass shipped without this and needed a follow-up fix;
don't repeat that on the next items in this list.

---

## 1. Next in priority order (per r6 §4) — dispatch only after the canary is verified

1. **`PreviewDrawOverlay.tsx`** (2,158 lines) — near-complete annotation-canvas engine (freehand
   draw/undo-redo, canvas redraw with rAF/DPR handling, box-select, draggable text labels, a
   collision-avoiding floating-toolbar placement engine). OD-specific only via a thin,
   already-isolated seam (`markKind()`, `data-od-*` attributes, the snapshot/composite/submit
   pipeline). Target: a generic `AnnotationCanvas` component/hook in `@jini/renderers-react` or
   `@jini/ui`, OD supplying the snapshot/submit callback via a port.
2. **The "progress/status card" pattern from `DesignSystemFlow.tsx`** — `WorkspaceActivityCard` +
   `GenerationStatusCard`, independently reimplemented twice in the same file against different data
   shapes. Higher strategic priority than a purely generic-UI finding: this maps almost 1:1 onto
   Jini's own `Run`/`Agent`/`Tool` vocabulary. Unify into one generic progress-card component.
3. **`SketchEditor.tsx`**'s Excalidraw-integration shim (~60-70% of the 1,088-line file) — theme
   sync, save/dirty timers, scene diff/export glue, and a ~300-line DOM-enhancement toolkit for
   embedding a third-party library that exposes no hooks for this. Target: `@jini/renderers-react`
   or a components package. Drop: legacy sketch-item migration, `.sketch.json` naming convention,
   OD's i18n override tables, `od-*` CSS classes.
4. **Consolidate the McpClientSection-archetype duplicates** — the "URL/OAuth source add +
   trust/status + list + per-item test/refresh/remove" shape recurs independently in
   `McpClientSection.tsx`, `byok/*`, `PluginsView.tsx`'s `SourcesPanel`, and `EntryShell.tsx`'s
   `OnboardingByokSetupPanel`. **Resolved (2026-07-17), see the Consolidation map above**: this is
   a different interaction shape than `ConnectorsBrowser.tsx`'s OAuth-catalog-browse pattern (the
   canary), so it does NOT fold into `features/connectors/` — it gets its own shared
   `features/source-config-list/` instead. Memory slice's connector reducers are a separate,
   rules-level (not UI) reuse case — see the Consolidation map's `features/connectors/` row.
5. **`SettingsDialog.tsx`**'s shell + clean tabs (8,538 lines total, but 8 of 17 tabs are *already*
   separate files — this is mostly assembly, not fresh extraction). Ship the tab-container shell as
   reusable chrome, plus the `appearance`/`notifications`/`language`/`instructions` tabs (small,
   clean) and `integrations` (parameterize the hardcoded `'open-design'`-branded MCP-install-snippet
   strings — same shape-class as `McpClientSection`, installer-direction-reversed). Leave
   `execution`/`orbit`/`media`/`composio`/`critiqueTheater`/`pet`/`designSystems`/`projectLocations`/
   `routines`/`about` as OD-specific. Verify `privacy` in a follow-up (r6 flagged it "likely generic,
   not fully verified").
6. ~~`LibrarySection.tsx`'s rubber-band multi-select + asset-grid shell~~ — ✅ landed 2026-07-17, see
   `features/asset-grid/` above and `packages/ui/source-map.md`. **`DesignsTab.tsx`**'s
   status-kanban dashboard shell is still open — a plausible near-term source for Jini's own list/
   dashboard UI (the kanban's status vocabulary — `not_started/running/awaiting_input/succeeded/
   failed/canceled` — reads like a generic agent-run lifecycle, not an OD concept).
7. **Batch "atoms" sweep** — the remaining moderate/thin PARTIAL files each yield one or two small,
   low-risk extractions not worth an individual PR each: `OptionCards<T>`/`CompactToggle`/
   `ToggleRow`/`FidelityCard` shell (`NewProjectPanel.tsx`), `BrandLogo`/`HeaderActionsMenu`/the
   `designMd*` markdown-slice utilities (`DesignKitView.tsx`), `scrollWorkspaceTabsWithWheel`
   (`FileWorkspace.tsx`), `useResizableSplitPane` (`ProjectView.tsx`), `home-hero/EdgeAutoScroll.tsx`
   (as-is, already isolated). The media-viewer-shell family + `PreviewViewportControls` +
   `CommentSidePanel`/`CommentSideDock` + `CodeWithLines`/`JsonPanel` (`FileViewer.tsx`) — listed here
   as part of the batch sweep — was pulled forward and done as its own dispatch (✅ done 2026-07-17,
   see the `features/viewer-shell/` row in the consolidation map above), not bundled into this batch.
   The generic `ListDetailPanel<TSummary,TDetail>` shell (`DesignSystemsTab.tsx`) was likewise pulled
   forward and done as its own dispatch (✅ done 2026-07-18, see the `features/list-detail-panel/` row
   above), not bundled into this batch.
   `RecurringSchedulePicker`/`MentionAutocomplete`/popover chrome primitives
   (`NewAutomationModal.tsx`), `AssetTreeBrowser<TFile>`/`FilePreviewPane<TFile>`
   (`DesignFilesPanel.tsx`), `RevisionDiffCard`/`RevisionHistoryList`/token-chip family
   (`DesignSystemFlow.tsx`, beyond the progress-card pattern in item 2), 4 presentational
   onboarding components (`EntryShell.tsx`). `DropZone` (`DesignSystemFlow.tsx`) was pulled
   forward and done as its own dispatch (✅ done 2026-07-18) — consolidated together with
   `DesignSystemAssetDropzone.tsx` (not itself in this plan's 23-file sweep, but the same
   "file-staging zone" interaction shape, confirmed by reading both in full) into one
   `features/file-dropzone/` primitive, not bundled into this batch. See
   `packages/ui/source-map.md`'s `features/file-dropzone/` section for the consolidation
   evidence.
8. **`WorkspaceTabsBar.tsx`** — corrected from r5's "one-import fix" to a real parameterization job:
   extract the drag/reorder/keyboard-shortcut/hover-preview/search/persistence chrome, but requires
   genericizing three things (the tab-kind union, route-mapping functions, storage/event key names),
   not a one-line swap. Reconcile with `FileWorkspace.tsx`'s independently-duplicated `Tab` component
   rather than treating them as two extractions. **Partial — the shared drag/reorder tab-strip-item
   ✅ landed 2026-07-18** as `features/tab-strip/` (see the Consolidation map row above and
   `packages/ui/source-map.md`); the keyboard-shortcut/hover-preview/search/persistence chrome and
   the tab-kind-union/route-mapping/storage-key genericization for a full `WorkspaceTabsBar.tsx`
   port are still open.

## 2. Confirmed genuinely OD-specific — do not attempt

`HomeView.tsx`, `pet/PetSettings.tsx` (both read in full, no viable extraction beyond trivial
utilities). The bulk of `FileViewer.tsx` (`HtmlViewer`, `FileVersionManagerModal`), `ProjectView.tsx`
(cross-cutting, not tab-separable — this independently explains why the prior checkpoint branch
never merged), `FileWorkspace.tsx`'s tab-content router and panels, `HomeHero.tsx`'s main component,
`EntryShell.tsx`'s main shell/onboarding state machine, `DesignSystemFlow.tsx`'s wizard/detail-tab
orchestrator, `DesignKitView.tsx`'s brand-kit render, `PluginsView.tsx`'s share/publish modal,
`DesignSystemsTab.tsx`'s `DesignSystemDetail`, `TasksView.tsx`'s domain logic, `NewAutomationModal.tsx`'s
form/REST wiring.

## 3. Open reconciliation items (not resolved by this plan — Coordinator decision needed)

- **Memory slice source-of-truth branch** — same open item as chat-pane/chat-composer
  (`ADS-memory/reports/jini-port/od-reference-branches.md`), now confirmed to apply to Memory too. Its 3 drop-in
  reusable pieces (`useMemoryExtractions.store.ts`, `async-commit-guard.ts`, connector-reconciliation
  reducers) are ready to lift once this is resolved.
- Several god-components (`FileViewer.tsx`, `ProjectView.tsx`, `FileWorkspace.tsx`) have prior
  checkpoint/draft branches attempting full decomposition that never merged — r6 confirms their bulk
  is genuinely, deeply OD-specific (independent corroborating evidence for why those attempts
  stalled, not a contradiction of them). Don't restart those as full-file efforts.
