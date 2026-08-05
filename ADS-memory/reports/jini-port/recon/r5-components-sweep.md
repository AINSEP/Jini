# R5 — OD `apps/web/src/components/` sweep (for `@jini/ui`)

Scope: `apps/web/src/components/` — 254 `.ts`/`.tsx` files (not 217; see §0). Backends used:
**Graphify** (graph built from commit `4101f1ee`, 8,314 nodes / 18,642 edges / 353 communities,
`AI-Dev-Shop/ADS-memory/reports/graphify-out/web-50aa2d5d/graph.json`) and **Codebase Memory MCP**
(project `Users-la-Desktop-Programming-OSS-Repos-open-design-agentic-apps-web`, 14,251 nodes /
40,701 edges, `head_sha` `951fa5f1` — matches the target's current HEAD exactly). All counts below
are graph-derived (`imports`/`imports_from` edges, per-file fan-in/fan-out) or `wc -l` verified;
"verified" = read the file's import header directly, "inferred" = reasoned from name/domain without
a full read.

---

## 0. Corpus reality check (verified, differs from the dispatch's "217" figure)

The dispatch's "217 files" undercounts. Verified via `find`:

| Slice | Count |
|---|---|
| Flat files directly in `components/` (`.tsx` + `.ts`) | 169 |
| Files in 11 subdirectories (`Theater/`, `design-files/`, `composer/`, `workspace/`, `plugins-home/`, `use-everywhere/`, `home-hero/`, `pet/`, `byok/`, `share-to-community/`, `plugin-details/`) | 85 |
| **Total `.ts`/`.tsx`** | **254** |
| Plus: `.module.css` (35, not classified — CSS follows its component 1:1) and one `Theater/AGENTS.md` | — |

**Graph freshness caveat (verified):** the harness's `check_graphify_freshness.py` reports the graph
`stale` — not because the graph content is wrong, but because `.ads-graphify-status.json` was never
written for this target (the metadata file is absent, not mismatched). The graph's own
`built_at_commit` (`4101f1ee76c39c26a252ee816d670204e1056a09`) is a **snapshot commit inside the
target's history**, not `HEAD` — Graphify records the commit at index time, and the target repo has
since advanced. Codebase Memory MCP's index, by contrast, reports `head_sha: 951fa5f1...`, which
**does match** the target's current `git rev-parse HEAD` exactly. `detect_changes` shows 5 files
under `components/` with uncommitted working-tree drift (`Icon.tsx`, `McpClientSection.tsx`,
`ProjectView.tsx`, `workspace/SideChatTab.tsx`, `workspace/useConversationChat.ts` — 132
insertions/135 deletions total) plus one new untracked file (`GlobalAssistantHost.tsx`, 595 lines).
This drift is small relative to 254 files and none of it changes a classification below — **did not
re-run `graphify update`**; the existing graph's node/edge coverage of `src/components/` (255 of 254
files have at least one graph node — one file, `Theater/AGENTS.md`, is non-code) is complete enough
that a re-index wasn't worth the token/time cost for a code-structural question. Recommend the
harness write the missing `.ads-graphify-status.json` on the next Graphify touch of this target so
the freshness check stops reporting stale for a merely-unwritten reason.

**Important target-identity finding (verified via `git remote -v` / `git log`):** this sweep's target
is `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic` on the fork's `main` branch (HEAD
`951fa5f1`). **This is a different checkout than r4-webui.md analyzed** — r4 read
`/Users/la/Desktop/Programming/OSS-Repos/open-design` on branch `refactor/web-memory-slice` (HEAD
`f65eea034`). The two checkouts have diverged in which vertical-slice PRs are actually merged:

| Slice | In `open-design` (r4's target) | In `open-design-agentic` (this sweep's target, `main`) |
|---|---|---|
| `features/memory` (PR #5228) | **Present** — `MemorySection.tsx` reduced, per r4 | **Absent** — `MemorySection.tsx` is still 2,636 lines, no `features/memory/` dir |
| `features/chat-pane` (PR #5461) | Absent (r4 read `ChatPane.tsx` at 4,342 lines) | **Present** — `ChatPane.tsx` is 1,212 lines, `git log` shows `58fe43587 refactor(web): decompose ChatPane.tsx into a features/chat-pane vertical slice` on `main` |
| `features/chat-composer` (PR #5465) | Absent (r4 read `ChatComposer.tsx` at 5,608 lines) | **Present** — `ChatComposer.tsx` is 1,774 lines, `features/chat-composer/` exists with `components/`+`hooks/` |
| `features/project-view`, `file-workspace`, `file-viewer` | Absent | **Absent** — `ProjectView.tsx` (9,907), `FileWorkspace.tsx` (8,000), `FileViewer.tsx` (14,275) are still monoliths, matching `od-reference-branches.md`'s "CLOSED (checkpoint, not for merge)" / "OPEN (draft)" status for those PRs |

This means **`ADS-memory/reports/jini-port/od-reference-branches.md`'s PR-state table is stale for #5461/#5465** —
it lists both as "OPEN (draft)", but they are merged into this sweep's target's `main`. Do not
re-slice `ChatPane.tsx`/`ChatComposer.tsx` — that work is done; treat the current 1,212/1,774-line
files as the **post-slice orchestrator shells** (see §3). Flag to the Coordinator: reconcile which
checkout is the source of truth for the extraction plan before scheduling any chat-slice work.

---

## 1. God-component tier (>900 lines, verified `wc -l`)

All are **OD-PRODUCT or MIXED** — none are flat-groupable; each needs the ports+hooks+barrel
treatment from ADR 0002 (ports.ts / dependencies.ts / index.ts barrel / dumb components), same as
`features/chat-pane`/`features/chat-composer` already did.

| File | Lines | Class | Slice status | Notes |
|---|---:|---|---|---|
| `FileViewer.tsx` | 14,275 | OD-PRODUCT | Checkpoints only (`agent/file-viewer-continue-ghf` CLOSED, `agent/file-viewer-clean` OPEN draft) — **not merged to this target's `main`** | Design/deck/sketch preview, the most OD-tilted surface (r4). Not `@jini/ui` material; reference `foundry/integrations/open-design/` if that adapter ever wants it. |
| `ProjectView.tsx` | 9,907 | OD-PRODUCT | Checkpoint only (`agent/project-view-merge-continue` CLOSED, "18/22 clusters") — **not merged** | Project shell; fanout=93, od-import-hits=27 (highest coupling in the directory) — `AmrBalanceDialog`, `comments.ts`, brand/plugin/design-system imports throughout. |
| `SettingsDialog.tsx` | 8,538 | OD-PRODUCT | No known slice branch | fanout=55, od=9 — connectors, AMR billing (`amrLoginPolling`), `ConnectorsBrowser`. |
| `FileWorkspace.tsx` | 8,000 | OD-PRODUCT | Checkpoints only (`agent/file-workspace-finish` CLOSED complete, `agent/file-workspace-clean` OPEN draft, cleaner base) — **not merged** | fanout=54, od=20 — `LibraryPicker`, `SketchEditor`, `SketchEnginePrewarm`, brand-font banners. |
| `DesignSystemFlow.tsx` | 5,439 | OD-PRODUCT | No known slice branch | fanout=33, od=12. Design-system import/token flow, per its name. |
| `HomeHero.tsx` | 5,004 | OD-PRODUCT | No known slice branch | fanout=41, od=15 — Figma help, library assets, plugin-home preview cards. OD's marketing landing hero. |
| `EntryShell.tsx` | 4,200 | OD-PRODUCT | No known slice branch | fanout=60, od=22 (second-highest coupling) — AMR attribution/auth/onboarding-session everywhere. |
| `DesignBrowserPanel.tsx` | 3,654 | OD-PRODUCT | No known slice branch | fanout=14, od=3 but also imports `comments.ts` + `providers/registry` + `runtime/brand-browser-bridge` directly (r4-verified pattern). |
| `AssistantMessage.tsx` | 3,289 | **Covered by r4** (chat message row, "high coupling") | **Not sliced** in this target (r4 read 3,317 lines on the other checkout; here 3,289 — effectively unchanged) | Belongs to `@jini/chat-react`'s message-row extraction, not `@jini/ui`. Genuine remaining god-file gap: chat-pane and chat-composer got sliced, `AssistantMessage` did not. |
| `NewProjectPanel.tsx` | 3,195 | OD-PRODUCT | No known slice branch | fanout=18, od=3 — `BrandPreviewCard`, `runtime/brands`. |
| `HomeView.tsx` | 2,728 | OD-PRODUCT | No known slice branch | fanout=38, od=15 — Figma import, plugin home/loop/details. |
| `MemorySection.tsx` | 2,636 | OD-adjacent MIXED | **Slice exists on a different repo/branch** (`open-design` @ `refactor/web-memory-slice`, PR #5228, per r4 §2) but **is not merged into this target** | The memory-slice work is real and directly transplantable if the source-of-truth checkout question above gets resolved — do not re-do it from scratch here. |
| `DesignKitView.tsx` | 2,216 | OD-PRODUCT | No known slice branch | fanin=5 (moderately reused), od=1 (only `providers/registry`) despite the name — worth a closer read before assuming full monolith status. |
| `PreviewDrawOverlay.tsx` | 2,158 | OD-PRODUCT (verified) | No known slice branch | Canvas comment/annotation overlay (r4 already flagged this exact file). `od_hits=0` by my import-keyword scan but verified OD-domain by content: draws visual marks tied to `PreviewVisualMarkKind` from `types.ts` and feeds `comments.ts`. |
| `PluginsView.tsx` | 2,099 | OD-PRODUCT | No known slice branch | fanout=12, od=6 — plugin marketplace shell. |
| `ChatComposer.tsx` | 1,774 | **Already sliced** — thin orchestrator | **Merged** (`features/chat-composer/`, PR #5465 equivalent) | Residual od=13 (Figma help/import, library picker) is the legitimate OD-adapter residue an orchestrator keeps per ADR 0002 — not unfinished work. |
| `DesignFilesPanel.tsx` | 1,731 | OD-PRODUCT | No known slice branch | fanout=17, od=6 — `design-files/*` cluster (see §2). |
| `ConnectorsBrowser.tsx` | 1,573 | OD-PRODUCT | No known slice branch | Composio connector catalog browsing (matches r1's `connectors/` daemon-side finding — same product concept, frontend half). |
| `McpClientSection.tsx` | 1,477 | MIXED | No known slice branch | MCP client config UI — the *protocol* (MCP server config: add/list/test a server) is a genuinely reusable pattern for any agent-runtime consumer; OD-specific residue is `providers/registry` binding + Settings-dialog placement. Good vertical-slice candidate: `features/mcp-config` with a `McpConfigPort`. |
| `LibrarySection.tsx` | 1,401 | OD-PRODUCT | No known slice branch | OD's asset-library browsing (uploads/library picker/preview modals). |
| `DesignsTab.tsx` | 1,386 | OD-PRODUCT | No known slice branch | — |
| `DesignSystemsTab.tsx` | 1,282 | OD-PRODUCT | No known slice branch | — |
| `WorkspaceTabsBar.tsx` | 1,220 | MIXED | No known slice branch | Tab-bar-of-open-workspace-tabs is a generic layout pattern (fanout=4, od=1 — only `router.ts`); OD residue is the hand-rolled `router.ts` singleton import. Extractable behind a navigation port. |
| `ChatPane.tsx` | 1,212 | **Already sliced** — thin orchestrator | **Merged** (`features/chat-pane/`, PR #5461 equivalent) | Residual od=7 (AMR guidance/login, plugin folder actions) is expected orchestrator residue, not a gap. |
| `NewAutomationModal.tsx` | 1,171 | OD-PRODUCT | Checkpoint exists (`refactor/web-automations-slice`, PR #5475 OPEN draft) — not merged here | Per `od-reference-branches.md`: OD-product, not `@jini/*` material regardless. |
| `InlineModelSwitcher.tsx` | 1,162 | Cross-package (agent-runtime/chat-react domain) | — | Model/agent picker cluster (§4) — out of `@jini/ui` scope per its own README (chat/model UI is `@jini/chat-react`+`@jini/agent-runtime` territory). |
| `TasksView.tsx` | 1,135 | OD-PRODUCT | — | Automations/tasks list, references `NewAutomationModal`. |
| `pet/PetSettings.tsx` | 1,132 | OD-PRODUCT | — | See `pet/` cluster (§2) — OD's gamified desktop-pet feature. |
| `PreviewModal.tsx` | 1,095 | Cross-package (artifact-renderer domain) | — | Uses `runtime/srcdoc` (the artifact sandbox host r4 named as `@jini/renderers-react` material). `od_hits=0` — genuinely low OD coupling, but belongs in the renderer package, not `@jini/ui`. |
| `SketchEditor.tsx` | 1,088 | OD-PRODUCT | — | OD's Excalidraw-based sketch tool integration. |

---

## 2. Subdirectory clusters (11 dirs, 85 files) — cluster-level classification

| Directory | Files | Class | Evidence |
|---|---:|---|---|
| `Theater/` | 15 | **OD-PRODUCT** | OD's "Critique Theater" — AI-panelist design-critique scoring UI (`PanelistLane`, `ScoreTicker`, `TheaterStage`, `CritiqueTheaterMount`). Verified: all imports are internal to the cluster or pure React; the *domain* (critique/panelist/scoring) is what makes it product-specific, not import coupling. Has its own `AGENTS.md` (0 lines counted, doc-only). |
| `plugins-home/` | 20 | **OD-PRODUCT**, with one exception | Plugin marketplace browsing: facets, cards, localization, saved/curated ordering. **Exception (verified, read in full): `useInView.ts`** (66 lines) — a pure `IntersectionObserver` React hook, zero imports beyond `react`, fan-in=5. **GENERIC-ENGINE** → `@jini/ui/src/hooks/useInView.ts`. Everything else in the dir is marketplace-domain (facet labels, plugin card previews, curated priority). |
| `plugin-details/` | 9 | **OD-PRODUCT** | Plugin detail-view variants (`PluginMediaDetail`, `PluginScenarioDetail`, `PluginDesignSystemDetail`, `PluginExampleDetail` all showing od=7 — heavy internal + `plugins-home/localization` coupling). |
| `design-files/` | 3 | **OD-PRODUCT** | `designArtifacts.ts`, `pluginFolders.ts`, `pluginFolderActions.ts` — OD's file-kind/plugin-folder classification (the same "OD notion of artifact" r1/r4 already flagged for the daemon/runtime side). |
| `home-hero/` | 11 | **OD-PRODUCT** | Marketing landing-page carousel/scenario content (`PlaceholderCarousel`, `ScenarioArt`, `TemplatePicker`, hardcoded `placeholderScenarios.ts`). Copy/content-heavy, not reusable. |
| `pet/` | 8 | **OD-PRODUCT** | OD's gamified "desktop pet" novelty feature tied to Codex/agent activity (`codexAtlas.ts`, `PetSpriteFace`, `taskCenter.ts`). Highly brand-specific. |
| `use-everywhere/` | 2 | **OD-PRODUCT** | Onboarding/marketing copy for OD's "use everywhere" cross-surface pitch. |
| `share-to-community/` | 1 | **OD-PRODUCT** | `shareToCommunityPrompt.ts` — OD marketplace community-sharing copy. |
| `workspace/` | 5 | **MIXED** | `SideChatTab.tsx`/`TabLauncherMenu.tsx` (tab-bar UI, low coupling, od=0) are generic-shaped; `useConversationChat.ts` and `TerminalViewer.tsx` import `state/projects.ts` + `providers/daemon.ts` directly (OD project/transport singletons). Split: tab-bar UI → `@jini/ui`; conversation/terminal wiring → stays OD-adapter or becomes a `@jini/chat-react` port. |
| `composer/` | 5 | **MIXED, verified** | `LexicalComposerInput.tsx`/`CaretFloatingLayer.tsx`/`serialize.ts`/`deserialize.ts` are a **generic Lexical rich-text/mention editor primitive** (zero OD imports, verified by reading headers). `MentionNode.ts` is the one exception: imports `connectorBrandColor`/`resolveBrandTheme` from `utils/` to color-code `@mention` chips by OD "connector" brand — genuinely OD-tilted one function. Extraction: ship the Lexical input as a `@jini/ui` rich-text primitive with an injectable `resolveMentionColor` prop; drop the concrete `connectorBrandColor` import. |
| `byok/` | 6 | **MIXED, verified** | "Bring Your Own (API) Key" provider-config UI (`ByokKeyField`, `ByokModelField`, `ByokProviderPicker`, `ByokConnectionTestControl`, `ByokProviderBaseUrl`, `validation.ts`) is a **genuinely reusable concept** for any agent-runtime consumer letting users configure their own LLM credentials — not OD-branded in any name or copy. Currently typed against OD-specific `state/config.KnownProvider` and `state/apiProtocols.API_KEY_PLACEHOLDERS` (verified imports). Good `@jini/ui/src/features/byok-config/` vertical-slice candidate: port out `KnownProvider`/`ApiProtocol` as a generic provider-catalog port. |

---

## 3. Verified GENERIC-ENGINE candidates (flat files, spot-read import headers)

These have **zero** OD-directory import hits, no OD-domain filename signal, and were individually
verified by reading their `import` lines (not just the keyword heuristic) to confirm the classifier
wasn't fooled by a thin OD type creeping in through `@open-design/contracts`.

| File | Lines | Fan-in | Evidence (verified) | Proposed `@jini/ui` home |
|---|---:|---:|---|---|
| `Icon.tsx` | 849 | **109** | Zero imports beyond `SVGProps`. The single most fanned-in file in the whole directory — this *is* the shared icon set. | `src/components/Icon.tsx` — highest-value single extraction in this sweep. |
| `RemixIcon.tsx` | 27 | 6 | Pure, `CSSProperties` only. | `src/components/RemixIcon.tsx` |
| `AgentIcon.tsx` | 107 | 6 | Pure, `CSSProperties` only. (Name suggests agent-domain but content is a generic icon-by-key renderer — verify at implementation time it doesn't hardcode OD's agent list.) | `src/components/AgentIcon.tsx` (verify content before landing) |
| `Toast.tsx` | 170 | 10 | Only imports `Icon`. Literally the example the `packages/ui/README.md` scope note names ("a generic toast/notification system"). | `src/components/Toast.tsx` |
| `Loading.tsx` | 62 | 5 | Only imports `Icon`. | `src/components/Loading.tsx` |
| `TooltipLayer.tsx` | 307 | 0 | Pure React + `createPortal`, zero deps. (fan-in 0 — currently unused or newly added; verify before porting.) | `src/components/TooltipLayer.tsx` |
| `CustomSelect.tsx` | 329 | 0 | Pure React + `createPortal` + `Icon`. (fan-in 0 — same caveat.) | `src/components/CustomSelect.tsx` |
| `KitErrorBoundary.tsx` | 61 | 1 | `i18n` + `analytics/error-tracking` (context, already slot-able per r4's analytics-adapter pattern) + local CSS module. | `src/components/KitErrorBoundary.tsx` (swap concrete `reportHandledException` import for an injected callback) |
| `LanguageMenu.tsx` | 112 | 1 | `i18n` context + `Icon` only. Generic locale switcher; `LOCALES`/`LOCALE_LABEL` content is swappable data, not code coupling. | `src/components/LanguageMenu.tsx` |
| `WorkingDirPicker.tsx` | 199 | 2 | `i18n` + `Icon` only, zero OD. | `src/components/WorkingDirPicker.tsx` (note: r4/od-reference-branches.md's chat-composer slice also names a `WorkingDirPort` — this flat component is the UI atom that port would bind to) |
| `AppChromeHeader.tsx` | 79 | 2 | `ReactNode` + `i18n` + `RemixIcon` — a generic header-shell slot wrapper. | `src/components/AppChromeHeader.tsx` |
| `ExportDiagnosticsButton.tsx` | 147 | 1 | `i18n` + `Icon` only. Generic "export diagnostics" action button. | `src/components/ExportDiagnosticsButton.tsx` |
| `IframeKeepAlivePool.tsx` | 403 | 2 | Pure, no cross-file imports in header. Generic sandboxed-iframe-pooling utility — but note this overlaps `@jini/renderers-react`'s srcdoc sandbox host domain (r4 §5b); place there instead if that package needs it first. | `src/components/IframeKeepAlivePool.tsx` OR `@jini/renderers-react` (resolve before landing either) |
| `PaletteTweaks.tsx` | 129 | 0 | `Icon` only. Appears to be a generic theme/color-palette dev-tweak panel (fan-in 0 — verify it's live, not dead, before porting). | `src/components/PaletteTweaks.tsx` (verify usage first) |
| `agentOrdering.ts`, `auto-open-file.ts`, `composer-detail-position.ts`, `composer-flyout-placement.ts`, `enterpriseUrl.ts`, `markdown-scroll-sync.ts` | <60 each | 0–3 | Zero imports, pure functions/constants (positioning math, URL parsing). Generic layout/utility helpers. | `src/hooks/` or a `src/utils/` bucket (these are non-React helper functions, not components — `packages/ui/README.md` doesn't define a `utils/` slot; recommend adding one, or folding into whichever `src/components/` file consumes them) |

**Caveat on this table:** "zero fan-in" appears on a few of these (`TooltipLayer`, `CustomSelect`,
`PaletteTweaks`). A 0-fan-in file inside a 254-file directory is a genuine **dead-code-candidate**
flag per the CodeBase Analyzer's escalation criteria — verify each is actually referenced (e.g. via
a barrel export, dynamic import, or test) before porting it as "reusable," since porting dead code
into `@jini/ui` just relocates the dead weight.

---

## 4. Cross-package scope note: chat/model/agent-picker cluster (NOT `@jini/ui`)

`packages/ui/README.md`'s scope boundary explicitly excludes chat/artifact UI ("that's
`@jini/chat-core`... `@jini/chat-react`... `@jini/renderers-react`... kept separate deliberately").
A meaningful slice of this sweep's "low OD coupling" files are **chat/agent-runtime domain**, not
generic UI, and would violate that boundary if landed in `@jini/ui`:

| File(s) | Domain | Correct home |
|---|---|---|
| `ToolCard.tsx`, `QuestionForm.tsx` | Already fully analyzed in r4 §3 — zero design/brand refs, reusable | `@jini/chat-react` (r4 already recommends "ship as-is") — **do not re-analyze or re-home here** |
| `SessionModeToggle.tsx` | Typed on `ChatSessionMode` from `@open-design/contracts` | `@jini/chat-react` (r4 §5c names it directly in the slot table) |
| `NextStepActions.tsx` | Typed on `ChatSessionMode`, skill localization, chat analytics events | `@jini/chat-react` |
| `ConversationsMenu.tsx` | Imports `conversationMetaLabel` from `ChatPane.tsx`, `Conversation` type | `@jini/chat-react` |
| `FileOpsSummary.tsx` | Consumed by `AssistantMessage.tsx` (r4-covered file) to summarize tool-driven file ops | `@jini/chat-react` |
| `InlineModelSwitcher.tsx`, `modelOptions.tsx`, `modelCapabilityTags.ts`, `agentModelSelection.ts`, `providerModelsCache.ts`, `AgentDiagnosticRow.tsx`, `AgentPicker.tsx` | Model/agent picker UI over `@jini/agent-runtime`'s agent definitions | `@jini/agent-runtime` UI surface or `@jini/chat-react` (needs a Software-Architect-Agent call on which package owns "pick a model/agent") |
| `PreviewModal.tsx`, `IframeKeepAlivePool.tsx` | Artifact sandbox/srcdoc rendering | `@jini/renderers-react` |
| `byok/*` | Provider credential config, closely tied to the model-picker cluster above | Could go either `@jini/ui/src/features/byok-config/` (generic feature) or alongside the agent-runtime UI cluster — needs the same architecture call |

**Recommendation:** before landing any of §3's generic components, get a Software Architect Agent
ruling on the `@jini/chat-react` / `@jini/agent-runtime` / `@jini/ui` boundary for this cluster —
several of these files are "generic" only in the sense of zero-OD-coupling, not in the sense of
"belongs in `@jini/ui`."

---

## 5. MIXED files needing a real split (beyond the clusters in §2)

| File | Lines | Generic core | OD-specific residue |
|---|---:|---|---|
| `QuickSwitcher.tsx` | 329 | Cmd-K-style fuzzy switcher UX (generic pattern) | Typed against `WorkspaceContextItem`/`ProjectFile` from `@open-design/contracts` — needs a generic "switchable item" type param. |
| `EditorIcon.tsx` | 168 | Icon-by-key rendering (same shape as `Icon.tsx`) | Keyed by `HostEditorId` from `@open-design/contracts` (which external code editor OD detected: VSCode/Cursor/etc.) — generify the key union. |
| `MemoryToast.tsx` | 166 | Thin wrapper over the generic `Toast.tsx`/`toastSlideUp` motion primitive | Typed on `MemoryChangeEvent` from `@open-design/contracts` — Memory-feature-specific, not a `@jini/ui` atom; the underlying `Toast.tsx` is (see §3). |
| `TrustBadge.tsx` | 67 | Badge-rendering shape looks generic | **Verified by full read**: typed on `MarketplaceTrust`/`TrustTier` from `@open-design/contracts`, i18n keys hardcoded to `pluginsView.trust.*`. This is OD marketplace-trust vocabulary wearing a generic-looking component — reclassify from an initial "looks generic" pass to **OD-PRODUCT**, not MIXED. (Kept here as a worked example of why import-count heuristics alone under-catch domain coupling — the pure "read the whole file" check mattered.) |
| `LiveArtifactBadges.tsx` | 43 | Badge rendering pattern | Typed on `LiveArtifactRefreshStatus`/`LiveArtifactStatus` — OD live-artifact concept. |
| `McpClientSection.tsx` | 1,477 | MCP server add/list/test config UX — genuinely reusable for any MCP-capable agent-runtime consumer | Bound to `providers/registry` + lives inside `SettingsDialog`'s tab structure. |
| `WorkspaceTabsBar.tsx` | 1,220 | Generic open-tabs bar layout | One `router.ts` import (OD's hand-rolled singleton router). |
| `DesignKitView.tsx` | 2,216 | Unclear without a deeper read — only 1 OD-dir import hit despite the OD-sounding name | **Not fully verified** — flagged for a follow-up read before committing to a classification; do not assume monolith status from the name alone. |

---

## 6. OD-PRODUCT bulk list (directory/name-cluster level, r1-style)

Everything not named above defaults to OD-PRODUCT by verified domain-name or verified `@open-design/*`
type import. Representative clusters (full per-file detail in the underlying data, available on
request — this is the r1-style directory-table altitude for the long tail):

- **Amr\* cluster** (`AmrBalanceDialog`, `AmrGuidance`, `AmrLoginPill`, `AmrLowBalanceDialog`): OD's
  billing/balance vendor (AMR) UI. All import `analytics/amr-*` or `runtime/amr-*` directly.
- **Brand\* cluster** (`BrandsTab`, `BrandPickerModal`, `BrandPreviewCard`, `BrandReadyPrompt`,
  `BrandReferencePicker`, `BrandEnrichmentBanner`, `NewBrandModal`, `MissingBrandFontsBanner`): OD
  brand-kit UI, mirrors r1's `brands/` daemon-side finding.
- **Design\*/Sketch\*/Deck\*/Figma\* clusters**: design-system tabs/kit views, sketch editor +
  preview + prewarm, deck slide thumbnails, Figma import/help modals. All product-domain.
- **Connector\*/Marketplace\* cluster**: `ConnectorLogo`, `ConnectorsBrowser`, `MarketplaceView` —
  Composio connector catalog, same product concept as r1's daemon-side `connectors/`.
- **Library\* cluster**: `LibraryPicker`, `LibraryPreviewModal`, `LibraryUploadModal`,
  `LibraryAssetMeta` — OD asset library.
- **Onboarding/recommendation**: `RecommendedStartRegion.tsx` imports `onboarding/onboarding-entry`,
  `onboarding/recommendation`, `onboarding/starter-copy` directly — OD first-run flow.
- **Vendor/social widgets**: `GithubStarBadge.tsx`/`useGithubStars.ts`,
  `useDiscordPresence.ts`, `XaiOAuthControl.tsx` (verified: X.AI-specific OAuth control despite a
  generic-looking import header — the vendor name is the tell) — OD marketing/vendor-integration
  widgets, not reusable.
- **`PlanBadge.tsx`** (36 lines) — **verified by full read**: its own docstring says *"The Open
  Design plan nameplate... one source of truth for the free / plus / pro / max tier pill."*
  Unambiguous OD-PRODUCT despite trivial size and zero imports.
- **`GlobalAssistantHost.tsx`** (595 lines, **new/untracked** — not yet committed) — verified:
  imports `Button`/`VisuallyHidden` from `@open-design/components` (OD's *own* internal design-system
  package) directly, plus `ChatPane`, `AvatarMenu`, `useConversationChat`. Strong OD-PRODUCT signal;
  also a signal that new god-file surface is still being added to this directory even as slicing
  work proceeds elsewhere — the sweep's OD-PRODUCT/MIXED ratio is a moving target, not a one-time
  fixed backlog.
- **`UpdaterPopup.tsx`** — typed on `OpenDesignHostUpdaterStatusSnapshot` from `@open-design/host`.
- **`UseEverywhereModal.tsx`, `IntegrationsView.tsx`, `ContinueInCliButton.tsx`,
  `ProjectActionsToolbar.tsx`** — each verified by reading imports: marketing-analytics event names
  (`trackIntegrationsUseEverywhereTabClick`), OD-project hooks (`useDesignMdState`,
  `useFinalizeProject` — the same `hooks/` directory r4 flagged as "OD-project-specific, NOT a
  shared hook layer"), or direct composition of other OD-product components (`ConnectorSection`,
  `McpClientSection`). All OD-PRODUCT despite generic-sounding names.

---

## 7. Simple flat-grouping vs. real vertical-slice — the split the dispatch asked for

**Flat-grouping candidates (correct classification + a barrel is enough, no ports/hooks needed):**
the §3 GENERIC-ENGINE list (`Icon`, `RemixIcon`, `AgentIcon`, `Toast`, `Loading`, `TooltipLayer`,
`CustomSelect`, `KitErrorBoundary`, `LanguageMenu`, `WorkingDirPicker`, `AppChromeHeader`,
`ExportDiagnosticsButton`, the tiny pure-utility `.ts` files) — these are presentational leaves or
pure functions with no state of their own; group them under `@jini/ui/src/components/` (and a
`src/utils/` or `src/hooks/` bucket for the non-component helpers) with a single barrel export,
mirroring the daemon's `capability-barrel`/`flat-grouping` pattern. `plugins-home/useInView.ts` joins
this bucket too (→ `src/hooks/`).

**Real vertical-slice candidates (needs ports+dependencies+hooks+barrel, ADR 0002 shape):**
`byok/*` (→ `features/byok-config/`), `composer/*` minus `MentionNode.ts`'s one OD binding (→ a
generic rich-text/mention `features/rich-text-input/` or ship as a `src/components/` primitive with
an injectable color-resolver prop — smaller lift than a full feature slice, judgment call for
implementation time), `McpClientSection.tsx` (→ `features/mcp-config/`), `workspace/`'s tab-bar half
(→ `features/workspace-tabs/` or fold into a `@jini/ui` component if state stays simple enough after
extraction).

**Already-done, do not re-slice:** `features/chat-pane/`, `features/chat-composer/` (merged into this
target's `main` — verified via `git log`). **Real work exists elsewhere but isn't merged here:**
`features/memory` (different repo/branch — `open-design` @ `refactor/web-memory-slice`), the
`project-view`/`file-workspace`/`file-viewer` checkpoint branches (draft/closed PRs per
`od-reference-branches.md`, not merged to this target's `main` either) — none of these are `@jini/ui`
material regardless (all OD-product per that doc's own scoping decision), but the Coordinator should
know the checkpoint work exists before assigning anyone to redo it inside
`foundry/integrations/open-design/`.

---

## 8. Recommendation summary

**Bucket counts (254 `.ts`/`.tsx` files):**

| Bucket | Approx. count | Notes |
|---|---:|---|
| GENERIC-ENGINE (verified, `@jini/ui` home identified) | ~18 flat files + 1 hook (`useInView.ts`) | §3 |
| Cross-package (chat/model/agent-picker — NOT `@jini/ui`, route to `@jini/chat-react`/`@jini/agent-runtime`/`@jini/renderers-react`) | ~14 | §4 |
| MIXED (split generic core from OD residue) | ~15 (7 in §5 + ~8 across `workspace/`, `composer/`, `byok/` clusters in §2) | §2, §5 |
| OD-PRODUCT god-components (>900 lines) | 29 | §1 |
| OD-PRODUCT (remaining flat files + 7 of the 11 subdirectory clusters) | ~177 | §6, §2 |

1. **Highest-value single win:** `Icon.tsx` (849 lines, 109 fan-in, zero deps) — port first, it
   unblocks nothing else being blocked on OD-branded icon imports.
2. **Get the `@jini/chat-react`/`@jini/agent-runtime`/`@jini/ui` boundary ruled on** before porting
   §4's cluster — several files that read as "generic" by coupling count are chat/model-picker domain
   by subject matter, and `packages/ui/README.md` already excludes chat UI by design.
3. **Reconcile the two OD checkouts** (`open-design` vs `open-design-agentic`) before scheduling any
   more chat-slice or memory-slice work — they disagree on what's already merged, and
   `od-reference-branches.md`'s PR-state table needs a refresh pass (out of scope for this sweep;
   flagging for the Coordinator).
4. `byok/*` and `McpClientSection.tsx` are the two best net-new vertical-slice candidates this sweep
   surfaced beyond what r1/r4 already found — both are provider/protocol config concepts genuinely
   useful to any `@jini/agent-runtime` consumer, not just OD.
5. Treat `TooltipLayer.tsx`/`CustomSelect.tsx`/`PaletteTweaks.tsx` (0 fan-in) as **dead-code-verify**
   items, not automatic ports, per the CodeBase Analyzer's standing escalation rule for zero-usage
   signals.
