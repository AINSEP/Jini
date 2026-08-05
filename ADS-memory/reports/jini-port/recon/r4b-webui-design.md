# R4b — Jini Reusable Frontend Layer: Design

Design for the fresh Jini repo's reusable chat/artifact frontend, extracted from
`open-design/apps/web`. Grounded in verified OD shapes (§sources cite real files
+ line counts). "Verified" = read the actual code; "Design" = proposed for Jini.

Verified anchor shapes:
- Transport handler: `DaemonStreamHandlers` (`providers/daemon.ts:261`) = `{ onAgentEvent(ev), onToolInputDelta?(id,name,delta), ...StreamHandlers(onError,onDone) }`; entry `streamViaDaemon({...})` (`daemon.ts:628`).
- Event union: `PersistedAgentEvent` (`packages/contracts/src/api/chat.ts:568`) — generic variants (`status`,`text`,`thinking`,`tool_use`,`tool_result`,`usage`,`raw`) MIXED with OD variants (`live_artifact`,`live_artifact_refresh`,`plugin_candidate`,`conversation_title`,`diagnostic`).
- `ChatMessage` (`chat.ts:642`) = `{ id, role, content, agentId?, agentName?, events?: PersistedAgentEvent[], runId?, runStatus?, resumable?, ... }`.
- Tool render props: `ToolRenderProps` (`runtime/tool-renderers.ts:24`) = `{status,name,args,result,isError}`, status ∈ `inProgress|executing|complete|error`.
- Artifact renderer: `ArtifactRenderer` (`artifacts/renderer-registry.ts:11`) = `{id, supportsStreaming, renderPartial?, canRender(ctx)}`.

---

## 1. Three-package specs

### `@jini/chat-core` — framework-free types + pure parsers
- **Source origin (lift from):**
  - Event/message types: the *generic subset* of `packages/contracts/src/api/chat.ts` (`PersistedAgentEvent` minus OD variants; `ChatMessage`, `ChatRole`, `ChatRunStatus`).
  - Pure parsers: `apps/web/src/artifacts/{parser,strip,validate,manifest,question-form,recover,pointer}.ts` (~2,000 lines), `apps/web/src/runtime/{todos,tool-events,chat-events,partial-json}.ts`, `deriveToolStatus`/`toRenderProps` from `runtime/tool-renderers.ts:101-124`, transcript helpers from `providers/daemon.ts:73-245` (`latestUserPromptFromHistory`, `buildTranscript`, `sanitizePriorAssistantTurn`).
- **Public API surface:**
  - Types: `AgentEvent` (generic union + `{kind:'ext'; name:string; data:unknown}` escape hatch for host-specific events), `ChatMessage`, `ChatRole`, `RunStatus`, `ChatAttachment`, `ToolStatus`, `ToolRenderProps`, `ArtifactManifest`, `QuestionForm`/`DirectionCard`/`FormOption`.
  - Fns: `parseArtifacts()`, `splitStreamingArtifact()`, `stripArtifact()`, `validateArtifact()`, `parseQuestionForm()`, `splitOnQuestionForms()`, `formatFormAnswers()`, `deriveToolStatus()`, `toRenderProps()`, `dedupeToolUsesById()`, `parseTodoWriteInput()`, `latestTodoWriteInput()`, `parsePartialJson()`, `buildTranscript()`.
- **Allowed deps:** none beyond TypeScript stdlib. Pure functions only.
- **Forbidden:** React, DOM (`window`/`document`/`fetch`/`EventSource`), Next.js, any `@open-design/*` or product package, node fs/process.
- **Behind slots:** nothing — this is the shared vocabulary every layer + host speaks.

### `@jini/chat-react` — headless hooks + presentational + slots
- **Source origin:**
  - Presentational leaves already near-clean: `components/ToolCard.tsx` (582, 0 design refs), `QuestionForm.tsx` (890), `QuestionsPanel.tsx` (521), `NextStepActions.tsx` (1069, prune OD actions), `runtime/markdown.tsx`, `runtime/todos.ts` pinned-card logic.
  - Headless hooks: extracted from the three god-shells' state (see §3/§4).
  - Transport port: generalize `providers/daemon.ts` `streamViaDaemon` + `DaemonStreamHandlers`.
- **Public API surface:**
  - Hooks: `useConversation`, `useRunStream`, `useComposer`, `useToolTimeline`, `usePinnedTodos`, `useQuestionForms`, `useArtifactStream` (§4).
  - Components (all presentational, props-in/JSX-out): `<MessageList>`, `<MessageRow>`, `<ToolCard>`, `<Composer>`, `<AttachmentTray>`, `<QuestionForm>`, `<QuestionsPanel>`, `<TodoCard>`, `<NextStepActions>`.
  - Context providers + slot registries: `<JiniChatProvider>` (wires transport, project, analytics, i18n, tool/artifact registries), `registerToolRenderer()` (re-export of `runtime/tool-renderers.ts` as-is — already 0 OD refs).
  - All slot interfaces from §2.
- **Allowed deps:** `react`, `react-dom` (portals only), `@jini/chat-core`, `@jini/artifacts-react`.
- **Forbidden:** direct `fetch`/`EventSource`/`localStorage`/`window` (transport reaches host via `ChatTransport` port), Next.js, any product package (`@open-design/*`), OD `providers/registry`, OD `state/*`, OD `router`.
- **Behind slots:** all OD-domain widgets (OdCard, design-toolbox, brand-browser, pluginFolders, sketch preview, comments/annotation, AMR billing, model/agent picker, file preview) — host injects via slots (§2).

### `@jini/artifacts-react` — RendererRegistry
- **Source origin:** `apps/web/src/artifacts/renderer-registry.ts` (108) + `artifacts/markdown.ts` + `runtime/srcdoc.ts` (3,101 — the sandbox srcdoc host, strip OD bridges) + `runtime/shiki.ts` + `components/file-viewer-render-mode.ts` (the url-vs-srcDoc decision).
- **Public API surface:** `RendererRegistry`, `ArtifactRenderer`, `ArtifactRendererContext` (generified — replace `ProjectFile` with `ArtifactFile = {name, kind, content?, url?, manifest?}`), built-in renderers (`HtmlRenderer`, `MarkdownRenderer`, `SvgRenderer`, `ReactComponentRenderer`; deck-html left to OD as a registered plugin), `<ArtifactView file registry slots>`, `<SrcDocSandbox>`, `renderMarkdownToSafeHtml()`, `UrlLoadDecision` port.
- **Allowed deps:** `react`, `@jini/chat-core`, a markdown lib, shiki. Optional peer for react-component eval.
- **Forbidden:** `@open-design/*`, OD providers, Next.js server APIs.
- **Behind slots:** deck rendering, OD design-kit preview, and every srcDoc bridge (deck/comment/inspect/palette/edit/tweaks — verified OD-only in AGENTS.md "Chat UI conventions") become host-registered `SrcDocBridge` plugins, not built-ins.

---

## 2. Slot / adapter interfaces (concrete TS)

```ts
// ---- @jini/chat-core: the event/message vocabulary (generic subset) ----
export type AgentEvent =
  | { kind: 'status'; label: string; detail?: string; code?: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; stopReason?: string }
  | { kind: 'raw'; line: string }
  | { kind: 'ext'; name: string; data: unknown }; // host-specific (OD live_artifact/plugin_candidate ride here)

// ---- ChatTransport port (generalizes providers/daemon.ts streamViaDaemon) ----
export interface RunHandlers {
  onEvent: (ev: AgentEvent) => void;
  onToolInputDelta?: (id: string, name: string, delta: string) => void; // ephemeral, never persisted
  onError: (err: Error) => void;
  onDone: (finalEvents: AgentEvent[]) => void;
}
export interface StartRunInput {
  history: ChatMessage[];
  agentId?: string;
  conversationId?: string | null;
  attachments?: ChatAttachment[];
  context?: RunContext;              // opaque per-host payload (OD: projectId/skillIds/designSystemId)
  signal: AbortSignal;               // stops the browser subscription; run continues host-side
  cancelSignal?: AbortSignal;        // explicit user cancel
}
export interface ChatTransport {
  startRun(input: StartRunInput, handlers: RunHandlers): Promise<{ runId: string }>;
  reattachRun(runId: string, handlers: RunHandlers): Promise<void>;
  fetchRunStatus(runId: string): Promise<RunStatus | null>;
  stopRun(runId: string): Promise<void>;
  reportFeedback?(change: FeedbackChange): Promise<void>;
}

// ---- ProjectContext (replaces threaded Project/ProjectFile/Workspace props) ----
export interface ProjectContextValue {
  projectId: string | null;
  files: ArtifactFile[];
  resolveFileUrl: (path: string) => string;      // was providers/registry.projectFileUrl
  resolveRawUrl: (path: string) => string;       // was projectRawUrl
  uploadFiles?: (files: File[]) => Promise<ChatAttachment[]>;
  linkedDirs?: string[];
}

// ---- Model / agent picker slot ----
export interface ModelAgentPickerSlot {
  value: { agentId: string; model?: string; sessionMode?: string };
  onChange: (next: { agentId: string; model?: string; sessionMode?: string }) => void;
  render?: (props: { value; onChange; agents: AgentOption[] }) => ReactNode; // host owns the UI
}

// ---- Composer plugin + attachment slots ----
export interface ComposerPlusItem {          // generalizes ComposerPlusMenu / LibraryPicker / Figma / plugins
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<ChatAttachment | null>;
}
export interface ComposerSlots {
  plusMenuItems?: ComposerPlusItem[];
  mentionSources?: MentionSource[];           // @-mention providers (skills, files, plugins)
  leadingAccessories?: ReactNode;             // e.g. SessionModeToggle, DesignSystemSwitchPicker
  onAttach?: (a: ChatAttachment) => void;
  annotationAdapter?: AnnotationAdapter;      // below
}
export interface AttachmentTraySlot {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  renderItem?: (a: ChatAttachment) => ReactNode; // host renders exotic attachment kinds
}

// ---- Tool-renderer registry (SHIP AS-IS, runtime/tool-renderers.ts) ----
export type ToolRenderer = (props: ToolRenderProps) => ReactNode; // {status,name,args,result,isError}
export function registerToolRenderer(name: string, r: ToolRenderer): () => void;
export function getToolRenderer(name: string): ToolRenderer | undefined;

// ---- Artifact renderer registry (generify ProjectFile -> ArtifactFile) ----
export interface ArtifactFile { name: string; kind: string; content?: string; url?: string; manifest?: ArtifactManifest; }
export interface ArtifactRenderer {
  id: string; supportsStreaming: boolean;
  renderPartial?: (content: string) => string;
  canRender: (ctx: { file: ArtifactFile; hints?: Record<string, unknown> }) => boolean;
}
export class RendererRegistry { resolve(ctx): ArtifactRenderMatch | null; }

// ---- Comments / annotation adapter (optional; OD comments.ts + PreviewDrawOverlay) ----
export interface AnnotationAdapter {
  enabled: boolean;
  toAttachment: (selection: unknown) => ChatAttachment;     // was buildVisualAnnotationAttachment
  displayName: (a: ChatAttachment) => string;               // was commentTargetDisplayName
}

// ---- Feedback callback ----
export type FeedbackChange = { messageId: string; runId?: string; rating: 'positive' | 'negative'; reasonCode?: string; note?: string };
export type OnFeedback = (change: FeedbackChange) => void;

// ---- File-preview slot (host supplies; OD's FileViewer/FileWorkspace are huge & product-specific) ----
export interface FilePreviewSlot {
  render: (props: { file: ArtifactFile; onClose?: () => void }) => ReactNode;
}

// ---- Analytics adapter (default no-op; OD analytics/provider.tsx already a context) ----
export interface AnalyticsAdapter { track: (event: string, props?: Record<string, unknown>) => void; }

// ---- i18n adapter (default passthrough; OD useT/Dict already a context) ----
export interface I18nAdapter { t: (key: string, vars?: Record<string, string | number>) => string; locale: string; }

// ---- One provider wires them all ----
export interface JiniChatProviderProps {
  transport: ChatTransport;
  project?: ProjectContextValue;
  analytics?: AnalyticsAdapter;   // default no-op
  i18n?: I18nAdapter;             // default passthrough (returns key)
  toolRegistry?: ToolRegistry;    // default = module registry
  artifactRegistry?: RendererRegistry;
  slots?: { modelPicker?: ModelAgentPickerSlot; composer?: ComposerSlots; filePreview?: FilePreviewSlot; annotation?: AnnotationAdapter };
  onFeedback?: OnFeedback;
  children: ReactNode;
}
```

---

## 3. Extraction sequence for the three god-shells (no visual change)

Universal loop per shell: **(0) characterize → (1) lift pure helpers → (2) transport port → (3) slot extraction → (4) presentational split**, each step behavior-preserving and guard/typecheck-green. Follows ADR 0002's "one file, one complete pass, behavior-preserving" rule.

### ChatComposer.tsx (5,608 lines — the hardest; 641 design/plugin refs, 99 analytics)
1. **Characterize:** snapshot tests for submit, attachment add/remove, @-mention popover, session-mode toggle, plus a Playwright pin of the composer visual. (Concurrent OD work already decomposed this to 1,774 lines / 27 commits per memory — reuse that as the starting baseline.)
2. **Lift pure helpers:** `inlineMentions`, `composer-detail-position`, `composer-flyout-placement`, upload-cohort derivation → `@jini/chat-core`/local pure files.
3. **Transport/state port:** replace direct `providers/registry` (uploadProjectFiles, openFolderDialog, dirExists), `state/projects` (patchProject, listPlugins), `state/mcp`, `router.navigate` with `ProjectContextValue` + `ComposerSlots` callbacks.
4. **Slot extraction:** `ComposerPlusMenu`/`LibraryPicker`/`FigmaImportModal`/`PluginsSection`/`DesignSystemSwitchPicker`/`pet` → `ComposerPlusItem[]` + `leadingAccessories` slots; `PreviewDrawOverlay` annotation → `AnnotationAdapter`.
5. **Presentational split:** headless `useComposer` (draft/attachments/mentions state) + dumb `<Composer>` (Lexical input + tray + send).

### ChatPane.tsx (4,342 lines — 455 design refs)
1. **Characterize:** message-list render + pinned-todo slot + jump-button + question banner snapshots; ChatPane already has memory-noted auto-scroll ResizeObserver/MutationObserver behavior to pin.
2. **Lift pure helpers:** `splitOnQuestionForms`, `stripArtifact`, todo pinning (`latestTodoWriteInputForPinnedCard`), `agentDisplayName` → chat-core/utils.
3. **Transport port:** replace `providers/daemon` reattach + `providers/registry.projectRawUrl` + `amrLoginPolling` with `useRunStream(transport)` + `ProjectContextValue`.
4. **Slot extraction:** `OdCard`, `design-files/*`, `SketchPreview`, `design-system-auto-prompt`, `runtime/design-toolbox`, `comments` → host slots / `NextStepActions` variants; AMR billing UI → `ext` event + host slot.
5. **Presentational split:** headless `useConversation` (message array + scroll intent) + dumb `<MessageList>`/`<PinnedTodoSlot>`.

### AssistantMessage.tsx (3,317 lines — 239 design refs)
1. **Characterize:** render tests for text/thinking/tool-group/question-form/od-card/file-ops per message; strip TodoWrite groups invariant.
2. **Lift pure helpers:** `deriveFileOps`, `dedupeToolUsesById`, `stripTodoToolGroups`, `filterImplicitProducedFiles`, `splitStreamingArtifact` → chat-core.
3. **Transport port:** `providers/registry.projectFileUrl` → `ProjectContextValue.resolveFileUrl`.
4. **Slot extraction:** `OdCardView`, `design-files/pluginFolders`, `brand-browser-bridge`, `design-toolbox` action ids → `ext`-event renderers + `ToolRenderer`/`ArtifactRenderer` registrations; `FileOpsSummary` stays (generic).
5. **Presentational split:** dumb `<MessageRow>` consuming `useToolTimeline` output + tool/artifact registries; question-form rendering already delegates to clean `QuestionForm.tsx`.

**Order across shells:** AssistantMessage first (smallest, most self-contained, feeds the registries) → ChatPane (depends on MessageRow) → ChatComposer last (most tangled with app singletons). This bottom-up order lets each shell's extracted primitives land in the package before the next shell consumes them.

---

## 4. Headless hooks

All hooks own only view/interaction state and take injected ports (never import transport/DOM directly — enforced by the §5 lint). They speak `@jini/chat-core` types.

| Hook | Owns | Transport-agnostic via |
|---|---|---|
| `useConversation()` | message array, optimistic user message, scroll-intent flag, active conversation id | reads `ChatMessage[]` from props/context; mutations go through `useRunStream` |
| `useRunStream(transport)` | current `runId`, streaming flag, accumulated `AgentEvent[]`, error/terminal state, tool-input-delta buffer keyed by tool id | calls `transport.startRun/reattachRun/stopRun`; never touches `fetch`/`EventSource` — the `ChatTransport` port is the only I/O |
| `useComposer()` | draft text, attachments, mention popover state, selected agent/model/sessionMode | attachments via `ProjectContextValue.uploadFiles` + `ComposerSlots`; no direct provider import |
| `useToolTimeline(events)` | per-tool lifecycle rows (dedup by id, status via `deriveToolStatus`), expand/collapse | pure over `AgentEvent[]`; zero I/O |
| `usePinnedTodos(messages)` | latest TodoWrite snapshot, dismissed-key, progress count | pure over messages (`runtime/todos.ts` logic) |
| `useQuestionForms(messages)` | parsed `<question-form>` artifacts, submitted answers, active form | pure parse (`splitOnQuestionForms`); submit returns a next-user-message payload the host posts via transport |
| `useArtifactStream(events, registry)` | streaming artifact buffer, resolved renderer, partial-vs-complete state | pure over events + injected `RendererRegistry` |

Transport-agnostic guarantee: every hook that performs I/O receives a `ChatTransport` (or a `ProjectContextValue` callback) as an argument/context; none constructs an `EventSource`, calls `fetch`, or reads `window`. Accumulating browser subscriptions (SSE reconnection, cross-tab notify) live in the **single-instance orchestrator/provider**, not in feature hooks — matching the memory-slice rule verified in `features/memory` (OAuth poll/popup kept in orchestrator, per `ports.ts` docblock).

---

## 5. Slice-model verdict + engine-core boundary lint

**Confirm the hybrid.** Per-product code that *consumes* Jini stays vertically sliced under ADR 0002 (`features/<capability>/` with `ports.ts` + `dependencies.ts` + public barrel, guard-enforced). The engine is a **published headless package**, and the ADR's within-app "duplicate, don't share / no shared hook layer" rule is deliberately **inverted at the package boundary** — the package IS the shared layer multiple products consume. The port/adapter seam the memory slice proves (transport behind an injectable interface, one binder file, public barrel) is exactly the seam a host swaps to reuse Jini; keep that, drop the anti-sharing stance at the package edge.

**Engine-core boundary lint** — adapt `scripts/check-web-slice-boundaries.ts` (863 lines; already an AST guard using `ts.resolveModuleName`) into `packages/*/scripts/check-engine-boundaries.ts` for Jini, wired into the package's own `guard`. Rules:
1. **No transport/DOM in `@jini/chat-core` and `@jini/artifacts-react` core:** reuse the exact `forbiddenSliceGlobals` set (`fetch`,`EventSource`,`XMLHttpRequest`,`WebSocket`,`localStorage`,`sessionStorage`,`window`,`document`) plus its bare/`globalThis.x`/`self["x"]`/destructure detection. `chat-core` also forbids React. All I/O must reach through the `ChatTransport` port.
2. **No product imports:** any specifier resolving into a product package (`@open-design/*`, an OD `providers/`/`state/`/`router`, or any host app path) is a violation. Reuse `resolveViaTypeScript` against the package tsconfig so `paths`/`baseURL` drift can't reopen the gap; the allow-list is only `react`, `react-dom`, sibling `@jini/*`, and declared peers.
3. **Slot discipline:** the only files allowed to import a concrete adapter are the package's own `dependencies`/provider composition root (the `@jini/chat-react` `<JiniChatProvider>`), mirroring rule 2 of the OD guard ("only `dependencies.ts` may bind a provider"). Everything else depends on the slot *interface*, not an implementation.
4. **Public-barrel boundary:** consumers reach a package only through its `index.ts` (mirrors OD rule 3 outside-in). Deep imports into `@jini/chat-react/src/...` fail.

This is a best-effort static guard (same scope statement as the OD original), not a security boundary — it catches the accidental relapse (a stray `fetch`, a re-imported OD widget) that would re-couple the engine to one product.
