# R4 — OD Web UI Architecture Recon (for "Jini" reusable chat/artifact engine)

Repo: `/Users/la/Desktop/Programming/OSS-Repos/open-design/apps/web/src` (READ-ONLY).
All line counts verified via `wc -l` on 2026-07-16. "Verified" = read the file/ran the count. "Inferred" = reasoned from imports/docs without exhaustive read.

---

## 1. Top-level structure of `apps/web/src` (verified)

Framework: Next.js 16 App Router + React 18 (per root AGENTS.md), but the runtime is a **fetch/SSE SPA** — the chat surface uses **no Next.js server APIs** (verified: `next/`, `useRouter`, `next/navigation`, `next/image` return NONE in ChatPane/AssistantMessage/ChatComposer/ToolCard). Routing is a hand-rolled `src/router.ts` (`navigate(...)`), not `next/navigation`.

Top-level dirs and their role:

| Dir | Role (verified from contents) |
|---|---|
| `analytics/` | Analytics context + event helpers. `provider.tsx` exposes `useAnalytics()` React context; `events.ts` typed trackers; `client.ts`, `identity.ts`, `scrub.ts`. |
| `artifacts/` | **Artifact parsing/rendering core** (2,414 lines). `renderer-registry.ts` (pluggable), `question-form.ts` (791), `parser.ts`, `strip.ts`, `validate.ts`, `manifest.ts`, `markdown.ts`. Mostly OD-agnostic. |
| `components/` | 217 entries, the god-file zone (see §1b). All UI. |
| `edit-mode/` | Canvas/source edit bridge (`bridge.ts`, `source-patches.ts`) — OD-specific (design editing). |
| `features/` | Vertical-slice home. Only `memory/` migrated + `libraryUi.ts`. |
| `hooks/` | Six app hooks (`useProjectDetail`, `useFinalizeProject`, `useDesignMdState`…) — OD-project-specific, NOT a shared hook layer (ADR forbids one). |
| `i18n/` | 18 locales + `useT`/`useI18n` context, typed `Dict` (`types.ts` 4,346 lines). |
| `lib/` | Small utilities (clipboard, updater, deck-preview-scale). |
| `media/` | Model catalogues (image/video/audio provider readiness). |
| `observability/` | Boot timing, white-screen, stuck-run, long-task client instrumentation. |
| `onboarding/` | First-run recommendation/starter-copy. OD-product-specific. |
| `providers/` | **Transport adapter layer** (see §1c). `fetch`/SSE/OAuth bridges. |
| `runtime/` | 43 files: streaming/parse/render helpers (`tool-renderers.ts`, `tool-events.ts`, `chat-events.ts`, `todos.ts`, `srcdoc.ts` 3,101, `markdown.tsx`, plus heavy OD design/brand runtime). |
| `state/` | Client stores (`projects.ts`, `mcp.ts`, `config.ts`, `appearance.ts`). Hand-rolled, no Redux/Zustand/TanStack. |
| `styles/` | Global cascade (tokens, base, primitives, `chat.css`, `viewer/`, `workspace/`). CSS Modules colocate with components. |
| `utils/` | Pure helpers (`agentLabels`, `chatTime`, `inlineMentions`, `uuid`). |
| Root loose files | `App.tsx`, `types.ts`, `comments.ts` (22.7 KB — comments-on-canvas), `router.ts`, `api-attachment-context.ts`. |

### 1b. God-files (verified line counts)

```
14276  components/FileViewer.tsx       ← OD file/deck/design preview
10124  components/ProjectView.tsx      ← OD project shell
 8566  components/SettingsDialog.tsx
 8008  components/FileWorkspace.tsx
 5608  components/ChatComposer.tsx     ← chat input (heavily OD-coupled)
 5439  components/DesignSystemFlow.tsx
 5001  components/HomeHero.tsx
 4342  components/ChatPane.tsx         ← chat message list (heavily OD-coupled)
 4203  components/EntryShell.tsx
 3654  components/DesignBrowserPanel.tsx
 3317  components/AssistantMessage.tsx ← message row (heavily OD-coupled)
 2677  App.tsx                         ← top orchestrator
```
Chat-relevant clean(er) files: `QuestionForm.tsx` 890, `QuestionsPanel.tsx` 521, `ToolCard.tsx` 582, `NextStepActions.tsx` 1069, `GenUISurfaceRenderer.tsx` 957.

### 1c. Provider layer (verified)

- `providers/daemon.ts` (1,521) — SSE client for `/api/runs`; parses agent event streams (`text_delta`, `thinking_delta`, `tool_use`, `tool_result`, `usage`) into `AgentEvent`. **This is the core chat transport.** Depends only on `@open-design/contracts` + local `types`, `anthropic` StreamHandlers. Reusable seam, but named/shaped around the OD daemon `/api/*` contract.
- `providers/registry.ts` (2,856) — grab-bag transport barrel: connectors, figma import, design-system import, file versions, uploads, social share, `projectRawUrl`/`projectFileUrl`. Very OD-specific. Chat components import `projectRawUrl`, `projectFileUrl`, `uploadProjectFiles` from here.
- `providers/project-events.ts` (187) — reconnecting `EventSource` for project file-change + live-artifact SSE. OD-project-specific.
- `providers/sse.ts` (38) — generic SSE helper.
- `providers/memory/` (8 files, 408 lines) — the migrated slice's transport home.

---

## 2. Memory feature-slice + ADR 0002 (verified)

**ADR:** `docs/adr/0002-frontend-vertical-slice-decomposition.md` (Status: Proposed, issue #5201). Decomposes god-components by **vertical slicing** onto four homes:
1. Wire DTOs/SSE unions → `packages/contracts/src/api/` (never redeclared in a slice).
2. Transport adapters (fetch/SSE/OAuth) → `apps/web/src/providers/` (only where a real multi-consumer seam exists).
3. Ports + pure rules + UI types + state hooks + dumb components → `features/<slice>/`.
4. Tests → `apps/web/tests/features/<slice>/`.

Key ADR principles (load-bearing for Jini):
- **State that leaked upward is the real problem, not file length.** Extraction alone is cosmetic (MemorySection was a monolith even after being pulled to its own file).
- **Ports pattern:** the slice owns an interface (`ports.ts`); a single `dependencies.ts` binds a real provider to it. Feature files may NOT import `providers/` directly. Tests inject a hand-written fake — no global `fetch` mocking.
- **No shared/app-level hook layer.** Reuse across slices is *explicitly not a goal*; duplicated wiring is "cheap and safe to diverge." Share only what *correctness* requires (wire DTOs, transport adapters); duplicate convenience (hooks). This is the ADR's "asymmetric by intent" rule.
- **Components stay presentational:** props in, JSX out, no state/logic/fetch.
- **Rejected Full Feature-Sliced Design** (steiger) because `app`/`pages` layer names collide with Next.js App Router's reserved `app/`, and rejected TanStack/SWR (repo-wide migration, breaks behavior-preservation).

**Verified slice shape** (`features/memory/`, 4,176 lines, 22 files):
- `ports.ts` (71) — four port interfaces (`MemoryConfigPort`, `MemoryEntriesPort`, `MemoryExtractionsPort`, `MemoryConnectorsPort`), each a small method set typed against `@open-design/contracts`.
- `dependencies.ts` (68) — the ONLY file importing `providers/`; binds concrete fns to each port.
- `index.ts` (50) — public barrel: exports dumb components (`MemoryList`, `MemoryConnectedPanel`…), `useWired*` hooks + their controller types, pure formatters. The orchestrator (`components/MemorySection.tsx`, still 558 lines, lives OUTSIDE the slice) consumes only this.
- `types.ts` (74) — UI-only view-models (`DraftEntry`, `MemoryTab`, `MemorySectionProps`); note `ports.ts` may not even type-import `providers/`, so `ConnectorConnectResult` is re-declared slice-side and structurally bound in `dependencies.ts`.
- `hooks/*.hooks.ts` (state) + `hooks/*.store.ts` + `components/*.tsx` (dumb) + `rules.ts`/`formatters.ts` (pure). Interesting: accumulating browser subscriptions (OAuth poll/popup) are deliberately kept in the orchestrator, NOT the hook (matches the repo's "external subscriptions belong in the single-instance orchestrator" rule).

**Boundary guard** — `scripts/check-web-slice-boundaries.ts` (863 lines, wired into `pnpm guard`). Enforces:
1. Slice files are transport/DOM-free — no `fetch`/`EventSource`/`XMLHttpRequest`/`WebSocket`/`localStorage`/`sessionStorage`/`window`/`document` (bare, `globalThis.x`, `self["x"]`, or destructured).
2. Only `dependencies.ts` may import `providers/`.
3. No cross-slice deep imports — a slice is reachable only through its public barrel `features/<slice>`, and this holds outside-in (the orchestrator/any app file too). Specifier resolution delegated to `ts.resolveModuleName` against the real `apps/web/tsconfig.json`.
4. One transport home per route (`/api/memory/*` route-family normalization); inline component fetches of an owned route are a reported non-blocking backlog.
Explicitly a best-effort static guard, NOT an adversarial security boundary.

**Is it a good template for a reusable engine?** *Partially.* The **ports + dependencies + public-barrel** discipline is an excellent seam for cross-product reuse: it already isolates transport behind an injectable interface, which is exactly what a host app must swap. BUT the ADR's deliberate *anti-reuse* stance ("no shared hooks, duplicate wiring") is tuned for one app's internal decomposition, not for shipping a library consumed by *other* products. For Jini the port pattern is the right idea, but the "duplicate, don't share" rule must be **inverted** at the package boundary: the whole point is that `@jini/chat-react` IS the shared thing multiple products consume. Verdict: **adopt the port/adapter seam; drop the no-shared-layer rule at the package edge.**

---

## 3. Chat/artifact UI inventory — reusable vs OD-specific

### Genuinely reusable (low OD coupling — verified by import scan)

| Component/module | Lines | Coupling |
|---|---|---|
| `runtime/tool-renderers.ts` | 124 | **Zero OD.** A pluggable per-tool renderer registry, explicitly modeled on CopilotKit `useCopilotAction({render})` + AG-UI render-prop `({status,name,args,result,isError})`. `registerToolRenderer(name, fn)` → dispose handle. This is already a clean extension point. |
| `components/ToolCard.tsx` | 582 | Imports only `i18n`, `runtime/todos`, `runtime/tool-renderers`, `types` (`AgentEvent`), `Icon`. Design/brand/plugin refs = **0**. Reusable. |
| `components/QuestionForm.tsx` | 890 | Imports only `i18n` + `artifacts/question-form`. Design refs = **0**. Reusable (the `<question-form>` clarifying-question artifact). |
| `artifacts/question-form.ts` | 791 | Pure parse/format of the `<question-form>` artifact. Reusable. |
| `artifacts/renderer-registry.ts` | 108 | Pluggable `ArtifactRenderer` registry (`canRender(ctx)` + `renderPartial`), built-ins html/deck-html/react-component/markdown/svg. `ProjectFile`-typed context is the only OD tie. Reusable with a generic file type. |
| `artifacts/{parser,strip,validate,manifest,markdown,recover}.ts` | ~1,100 | Artifact stream parsing/sanitizing. Mostly OD-agnostic. |
| `runtime/todos.ts` | 166 | TodoWrite snapshot parsing (`latestTodoWriteInputForPinnedCard`, `dedupeSnapshotToolRetries`). Reusable. |
| `runtime/tool-events.ts`, `chat-events.ts` | 21 / 89 | Event dedup/derivation. Reusable. |
| `runtime/markdown.tsx`, `shiki.ts` | — | Markdown + syntax highlight rendering. Reusable. |
| `providers/daemon.ts` (SSE parse core) | 1,521 | The AgentEvent stream parser is reusable *as a shape*, but bound to the OD `/api/runs` contract — belongs behind an adapter interface. |
| `QuestionsPanel.tsx` | 521 | Mostly clean (7 design refs are incidental); ties to `providers/registry.uploadProjectFiles` + analytics. Reusable behind an upload port. |

### OD-product-specific (high coupling — verified)

Import-coupling scan (occurrences of design/brand/plugin/OdCard/deck/comment/sketch tokens):
- `ChatComposer.tsx`: 641 design/brand/plugin refs, 99 analytics refs. Pulls in `ComposerPlusMenu`, `LibraryPicker`, `FigmaImportModal`, `PluginsSection`, `DesignSystemSwitchPicker`, `PreviewDrawOverlay` (canvas annotation), `pet/pets`, `state/projects`, `state/mcp`, `router`. Deeply OD.
- `ChatPane.tsx`: 455 design/brand/plugin refs. Imports `OdCard`, `design-files/*`, `SketchPreview`, `design-system-auto-prompt`, `amrLoginPolling` (AMR billing), `runtime/design-toolbox`, `comments`.
- `AssistantMessage.tsx`: 239 refs. Imports `OdCard`, `design-files/pluginFolders`, `brand-browser-bridge`, `design-toolbox`, `FileOpsSummary`, `produced-files`.
- Fully OD surfaces: `FileViewer.tsx`, `FileWorkspace.tsx`, `ProjectView.tsx`, `DesignSystemFlow.tsx`, `DesignBrowserPanel.tsx`, `PreviewDrawOverlay.tsx` (comment/annotate on canvas), `OdCard.tsx`, all `Brand*`/`DesignSystem*`/`Plugin*`/`Amr*`/`Deck*`/`Sketch*`/`Connector*` components, `comments.ts`, `edit-mode/`.

### The core view-model (verified, `types.ts` 21 KB)
`ChatMessage`, `AgentEvent` (= `PersistedAgentEvent` from contracts), `Conversation`, `ChatAttachment`, `Project`, `ProjectFile`, `ProjectMetadata`, `PreviewComment`, `AppConfig`. The chat message/event/attachment triad is reusable; `Project*`/`PreviewComment`/`AppConfig` are OD. Note the reusable event shape already lives in `@open-design/contracts` (a pure-TS package — a natural home for `@jini/chat-core` types).

---

## 4. OD coupling carried by chat components (cited examples)

- **OD providers:** `ChatPane.tsx:34 import { projectRawUrl } from '../providers/registry'`; `:70 from '../providers/daemon'`. `AssistantMessage.tsx:9 import { projectFileUrl } from '../providers/registry'`. `ChatComposer.tsx:39` imports 8 fns from `providers/registry` (`uploadProjectFiles`, `openFolderDialog`, `applyLibraryAsset`…).
- **Project/workspace assumptions:** `ChatComposer.tsx:41 patchProject/duplicatePluginAsProject from '../state/projects'`, `:43 fetchMcpServers from '../state/mcp'`, `:42 navigate from '../router'`. `WorkspaceContextItem`, `Project`, `ProjectFile`, `ProjectMetadata` threaded through props.
- **Next.js APIs:** **NONE** in the chat surface (verified). This is a big positive — the chat runtime is portable React, not App-Router-bound.
- **Analytics:** pervasive but context-injected — `useAnalytics()` (React context from `analytics/provider.tsx`) + typed `trackXxx` fns from `analytics/events`. ChatComposer has 99 analytics refs, AssistantMessage 28, ChatPane 21. Because it's a context + injected trackers, it's *slot-able* (host supplies a no-op or its own analytics adapter).
- **i18n:** `useT()`/`useI18n()` context, typed `Dict`. ToolCard/QuestionForm use only this. Already a clean context seam; a host either provides OD's dict or its own.
- **OD-domain widgets welded in:** `OdCard`, `design-toolbox`, `brand-browser-bridge`, `pluginFolders`, `SketchPreview`, `comments` (canvas annotation → chat attachment via `buildVisualAnnotationAttachment`), AMR billing (`amrLoginPolling`, `AmrGuidance`, `AmrLoginPill`).

**Coupling verdict:** the *primitives* (ToolCard, QuestionForm, tool/artifact registries, markdown, todos, message/event types) are near-clean; the *composition shells* (ChatPane/ChatComposer/AssistantMessage) are where OD leaks in — via (a) direct `providers/*` transport imports, (b) `state/*` + `router` app-singletons, and (c) inlined OD-domain child components. All three are exactly the seams a slot/adapter design removes.

---

## 5. Recommendation for the Jini reusable engine

### 5a. Slice model: **feature-slice for the app, headless-package for the engine — a hybrid**
- Keep ADR 0002's vertical **feature-slice** discipline *inside each product* (it's proven and guard-enforced). But the reusable engine itself is NOT a feature slice — it's a **published headless package** with a slot/adapter API. The ADR's "duplicate, don't share; no shared hook layer" rule is a within-app decomposition tactic and must be **inverted** at the package boundary (the package IS the shared layer). So: *feature-slice how each product consumes Jini; headless-hooks + presentational + slots for what Jini ships.*

### 5b. Design: **headless hooks + presentational components + slots**
Three layers per the artifact-design/AG-UI/CopilotKit prior art the repo already cites:
1. **`@jini/chat-core`** (framework-free TS): the `AgentEvent`/`ChatMessage`/`ChatAttachment`/tool-lifecycle types + pure parsers (`artifacts/parser|strip|validate|question-form`, `runtime/todos|tool-events|chat-events`, `deriveToolStatus`). Lift from `@open-design/contracts` + `artifacts/*` + `runtime/*`. Zero React.
2. **`@jini/chat-react`** (headless hooks + dumb components): `useChatRun(transport)`, `useToolTimeline`, `usePinnedTodos`, plus presentational `MessageList`, `MessageRow`, `ToolCard`, `Composer`, `AttachmentTray`, `QuestionForm`/`QuestionsPanel`. Transport injected via a **`ChatTransport` port** (the `providers/daemon.ts` SSE shape generalized: `createRun`, `subscribe(runId) → AsyncIterable<AgentEvent>`, `stop`).
3. **`@jini/artifacts-react`**: the `RendererRegistry` + built-in html/markdown/svg/react-component renderers + `srcdoc` sandbox host, parameterized on a generic `ArtifactFile` (drop `ProjectFile`).

### 5c. Slot/adapter seams the engine must expose (each maps to an existing OD leak)
| Seam (slot/port) | Why (OD leak it replaces) | Existing analogue |
|---|---|---|
| **`ChatTransport` port** | `providers/daemon.ts` + `registry` fetch imports | `providers/daemon.ts` SSE parser; mirror the memory `ports.ts`+`dependencies.ts` binding |
| **Project/workspace context** (`ChatContextProvider`) | `Project`/`ProjectFile`/`WorkspaceContextItem` props threaded everywhere | React context (like `useAnalytics`) |
| **Tool renderer registry** | already clean | `runtime/tool-renderers.ts` — ship as-is |
| **Artifact renderer registry** | `ProjectFile` tie only | `artifacts/renderer-registry.ts` — generify the file type |
| **Model/agent picker slot** | `AgentPicker`, `InlineModelSwitcher`, `SessionModeToggle` | render-prop / slot component |
| **Composer plugin/attachment slots** | `ComposerPlusMenu`, `LibraryPicker`, Figma/plugins/design-system pickers | `+`-menu extension array + `AttachmentTray` slot |
| **Comments/annotation adapter** | `comments.ts`, `PreviewDrawOverlay`, `buildVisualAnnotationAttachment` | optional `onAnnotate → ChatAttachment` port |
| **Feedback adapter** | `ChatMessageFeedbackChange` | callback prop |
| **File-preview slot** | `FileViewer`/`FileWorkspace` (OD-huge) | host-supplied preview component keyed by artifact kind |
| **Analytics adapter** | `useAnalytics` + `trackXxx` (context already) | context, default no-op |
| **i18n adapter** | `useT`/`Dict` (context already) | context, host supplies dict or passthrough |

### 5d. Migration path (inferred)
Start bottom-up: (1) extract `@jini/chat-core` from `contracts`+`artifacts`+`runtime` pure files (already near-clean, guard-friendly); (2) ship `ToolCard`, `QuestionForm`, tool/artifact registries as the first `@jini/chat-react` exports (0 design refs today); (3) decompose `ChatPane`/`AssistantMessage`/`ChatComposer` behind the transport port + context + slots, leaving OD-domain children (OdCard, design-toolbox, brand-browser, comments) as **host-injected slots** rather than imports. The boundary guard (`check-web-slice-boundaries.ts`) is a ready-made model for a package-level "no direct transport/DOM in engine core" lint.

**Biggest risk (inferred):** the three composition shells are 4k–5.6k lines each and entangle transport + app-singletons (`state/projects`, `router`) + OD widgets in one file. The port/slot extraction is real work, not a re-export. But the primitives and the two registries are already the shape a reusable engine needs — OD essentially prototyped the AG-UI/CopilotKit extension model already.
