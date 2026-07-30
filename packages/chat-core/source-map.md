# `@jini/chat-core` — provenance

Origin: `nexu-io/open-design` (fork `leonaburime-ucla/open-design`), branch `main`,
commit `951fa5f1541c3b7af23ccb07e3e60b294def56b1` (2026-07-12), local reference
clone `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic`.

Per `foundry/docs/jini-port/extraction-plan.md` §12 C3 and
`foundry/docs/jini-port/recon/r4b-webui-design.md` §1: `@jini/chat-core` is the
framework-free "reusable center" — the generic event/message vocabulary plus
every pure artifact/question-form/tool/todo/transcript parser, so a non-React
host (e.g. a Vue shell) can consume the same logic `@jini/chat-react` will
later wrap in hooks. Re-verified every source file's actual current content
against the recon's claims before lifting (see "Deviations from recon"
below) rather than trusting the line-count/coupling summary blindly.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/events.ts` | `packages/contracts/src/api/chat.ts` (`PersistedAgentEvent`, lines ~561-624) | Kept the generic variants (`status`, `text`, `thinking`, `tool_use`, `tool_result`, `usage`, `raw`) as `AgentEvent`. Dropped every OD-specific variant: `conversation_title`, `live_artifact`, `live_artifact_refresh`, `diagnostic`, `plugin_candidate`. Dropped `failureCategory`/`failureDetail` off `status` (they type against OD's `RunFailureCategory`/`RunFailureDetail`, re-exports of the daemon's analytics-shaped failure taxonomy — an OD import, not generic). Added `{ kind: 'ext'; name: string; data: unknown }` (new, per r4b §2) as the escape hatch a host uses to carry the dropped/product-specific kinds through the same envelope. `usage`'s fields are the union of the real source (`durationMs`) and r4b §2's literal target type (`stopReason`) — both kept as optional since r4b's design doc and the actual source disagree on this one field and neither costs anything to keep. |
| `src/messages.ts` | `packages/contracts/src/api/chat.ts` (`ChatMessage` lines ~626-660, `ChatRole`, `CHAT_RUN_STATUSES`/`ChatRunStatus` lines ~310-318, `ChatAttachment` lines ~522-532) | `ChatRunStatus`/`CHAT_RUN_STATUSES` → `RunStatus`/`RUN_STATUSES` (renamed per r4b §1's target name; note this name is reused for a *different*, richer shape by `@jini/protocol`'s own `RunStatus` — see the doc-comment on this type and "Known ambiguity" below). Dropped from `ChatMessage`: `sessionMode` (OD's design/chat/plan modes), `runContext` (`RunContextSelection`, OD), `appliedPluginSnapshot` (OD plugin system), `producedFiles`/`traceObjectFiles`/`preTurnFileNames` (typed `ProjectFile[]`, OD's project-file model), `commentAttachments` (OD canvas-annotation feature), `feedback` (`ChatMessageFeedback`, OD-specific rating taxonomy), `telemetryFinalized` (OD request-only marker). Kept: `id`, `role`, `content`, `agentId`, `agentName`, `events`, `createdAt`, `runId`, `runStatus`, `resumable`, `lastRunEventId`, `startedAt`, `endedAt`, `attachments` — the generic conversational shape. Added `isTerminalRunStatus()` (new, mirrors `@jini/protocol`'s `isTerminalRunState` for the same convenience at this layer). |
| `src/partial-json.ts` | `apps/web/src/runtime/partial-json.ts` (94 lines) | Verbatim except doc-comment wording (no OD nouns existed in the original; only reworded "the `<question-form>` discovery/clarification form" framing slightly for a non-web-specific audience). |
| `src/tool-events.ts` | `apps/web/src/runtime/tool-events.ts` (21 lines) | Verbatim logic; retyped `AgentEvent` import to `./events.js`. |
| `src/tools.ts` | `apps/web/src/runtime/tool-renderers.ts` (124 lines) | Lifted only the pure subset: `ToolStatus`, `ToolRenderProps`, `deriveToolStatus()`, `toRenderProps()`. **Deliberately did NOT port** `ToolRenderer` (the `(props) => ReactNode` type — React-typed), `registerToolRenderer()`, `getToolRenderer()`, `clearToolRenderers()` — the module-scoped renderer *registry* is a presentational, React-facing extension point per the task brief, and belongs to `@jini/chat-react`/`@jini/renderers-react`, not this framework-free package. Re-exports `dedupeToolUsesById` from `./tool-events.js` so the tool-lifecycle surface reads as one module. |
| `src/todos.ts` | `apps/web/src/runtime/todos.ts` (163 lines) | Verbatim logic (parse/derive functions), retyped against local `AgentEvent`/`RunStatus`. Added `latestTodoWriteInput` as an exported alias of `latestTodoWriteInputFromMessages` to match the literal name in the task's target API list — kept the original (more descriptive) name as the primary export too, since `@jini/chat-react` and other call sites benefit from the disambiguation once `latestTodoWriteInputForPinnedCard` exists alongside it. |
| `src/question-form.ts` | `apps/web/src/artifacts/question-form.ts` (738 lines) | Verbatim parsing/formatting logic; import of `parsePartialJson` repointed from `'../runtime/partial-json'` to `'./partial-json.js'`. Added `parseQuestionForm()` as a thin wrapper over `findFirstQuestionForm()` (drops the matched raw-text half) to satisfy the exact name in the target API list — the richer `findFirstQuestionForm`/`parsePartialQuestionForm`/`splitOnQuestionForms` are shipped alongside it, not replaced. |
| `src/artifacts/types.ts` | `apps/web/src/artifacts/types.ts` (60 lines) | Verbatim shapes (`ArtifactKind`, `ArtifactRendererId`, `ArtifactExportKind`, `ArtifactStatus`, `ArtifactManifest`). Every optional field additionally typed `| undefined` (e.g. `status?: ArtifactStatus | undefined`) — required by Jini's stricter root `tsconfig.base.json` (`exactOptionalPropertyTypes: true`, which OD's own tsconfig does not set); purely a strictness accommodation, not a shape change. |
| `src/artifacts/markdown-context.ts` | `apps/web/src/artifacts/markdown-context.ts` (139 lines) | Verbatim algorithm (`computeSkipRanges`, `isRealArtifactOpenAt`, `rangeContains`, `FENCE_OPEN_RE`/`FENCE_CLOSE_RE`/`INLINE_CODE_RE`). Marked `@internal` and **not re-exported from the package barrel** — it is an implementation detail shared by `parser.ts`/`strip.ts`, not part of chat-core's public surface (the origin file wasn't in the task's named source list either, but `parser.ts`/`strip.ts` both hard-depend on it, so it had to be lifted too — flagged here as an undocumented transitive dependency the recon's file list didn't call out). |
| `src/artifacts/parser.ts` | `apps/web/src/artifacts/parser.ts` (252 lines) | Verbatim streaming state machine (`createArtifactParser`, `ArtifactEvent`). Added `parseArtifacts(content: string): ArtifactEvent[]` (new) — a one-shot wrapper (`feed` + `flush` over a complete string) to satisfy the literal `parseArtifacts()` name in the target API list, since the real API is a stateful streaming parser, not a single function. |
| `src/artifacts/strip.ts` | `apps/web/src/artifacts/strip.ts` (375 lines) | Verbatim logic for `stripArtifact`, `stripRecoveredHtmlFallbackForDisplay` (name unchanged; only its doc-comment was genericized, see below), `matchPersistedArtifactFile`, `PersistedArtifactFileRef`, `summarizeArtifactsForTranscript`, `splitStreamingArtifact`/`StreamingArtifact`. Doc-comment for the fallback-recovery function dropped a reference to a specific OD onboarding template feature ("Grok Build") and reworded generically as "a fallback shape some models emit" — the *logic* it describes (recovering a bare HTML document/fence reply) is generic; only the comment named a product feature. `artifactTranscriptSummary`'s wording changed "saved to the project file" → "saved to the file" / "grep the project directory" → "grep the workspace directory" (no behavior change, just dropping OD's "project" noun in a user-facing string template). |
| `src/artifacts/validate.ts` | `apps/web/src/artifacts/validate.ts` (204 lines) | Verbatim validation algorithm. One content change: the reserved-path denylist was `.live-artifacts`, `.od`, `.tmp` in the origin (`.od` being OD's own dot-directory convention); shipped here as `.live-artifacts`, `.workspace`, `.tmp` — dropped the OD-specific `.od` segment and substituted a generic `.workspace` placeholder. A host that uses a different reserved-directory name should treat this list as illustrative and is expected to run its own equivalent check with its own path if it needs this guarantee; chat-core does not expose the list as configurable in this task (flagged as a follow-up below, not addressed here to keep this slice's scope bounded). Doc-comment and internal function/regex names renamed from "project" to "workspace" (`RESERVED_PROJECT_PATH_RE` → `RESERVED_WORKSPACE_PATH_RE`, `referencesReservedProjectPath` → `referencesReservedWorkspacePath`, etc.) for the same reason. |
| `src/artifacts/manifest.ts` | `apps/web/src/artifacts/manifest.ts` (189 lines) | Verbatim logic (`createHtmlArtifactManifest`, `serializeArtifactManifest`, `parseArtifactManifest`, `inferLegacyManifest`, `artifactManifestNameFor`). Object-literal construction switched from unconditional field assignment to the same computed values, now typed against the `| undefined`-widened `ArtifactManifest` fields (see `types.ts` entry) to satisfy `exactOptionalPropertyTypes`. |
| `src/artifacts/recover.ts` | `apps/web/src/artifacts/recover.ts` (107 lines) | Verbatim logic (`recoverHtmlArtifactFromPrecedingDocument`, `resolvePersistedArtifactHtml`, `recoverStandaloneHtmlDocument`, `recoverHtmlDocumentFromMarkdownFence`). `RecoverHtmlArtifactInput`'s optional fields widened with `| undefined` for the same `exactOptionalPropertyTypes` reason. |
| `src/artifacts/pointer.ts` | `apps/web/src/artifacts/pointer.ts` (81 lines) | Verbatim logic (`resolveHtmlPointerArtifactTarget`). Uses `TextEncoder` (a WHATWG/ECMA-402 global available in both browser and Node runtimes, not a DOM/browser-only API) — not on the forbidden-globals list (`window`/`document`/`fetch`/`EventSource`/`localStorage`/`sessionStorage`/`XMLHttpRequest`/`WebSocket`) and kept as-is. |
| `src/artifacts/index.ts` | *(new — not a 1:1 origin file)* | Barrel for the `artifacts/*` module group, re-exporting `types`/`parser`/`strip`/`validate`/`manifest`/`recover`/`pointer` but deliberately omitting `markdown-context` (internal only). |
| `src/transcript.ts` | `apps/web/src/providers/daemon.ts` (pure slice, lines ~74-260 of 1521; the file's SSE/fetch transport — `streamViaDaemon`, `DaemonStreamHandlers`, everything importing `@open-design/contracts`/`./anthropic`/`./sse` — was **not** touched or ported) | See "Transcript generalization" below for the full accounting of what changed and why; this file needed the most adaptation of anything in this package. |
| `src/agentic/chat-capabilities.ts` | *(new 2026-07-25 — not ported from OD)* | See "Agent-control vocabulary" below. |
| `src/index.ts` | *(new — barrel)* | Re-exports every module above. |

## Agent-control vocabulary (`src/agentic/`) — mostly moved to `@jini/agentic` on 2026-07-26

Added 2026-07-25 as new work (no OD provenance). On 2026-07-26, everything in this folder except
`chat-capabilities.ts` moved to `@jini/agentic` — `capability.ts` (`CapabilityDef`,
`availableCapabilities`), `page-capabilities.ts` (`PAGE_CAPABILITIES`), `element-handles.ts` (the
`data-agent-*` convention), `guards.ts` (`findFieldFillRefusal`/`normalizeAgentLabel`),
`page-driver.ts`/`page-executor.ts` (the `PageDriver` port and its policy gate), and the three
protocol projections (`ag-ui.ts`, `mcp-ui.ts`, `webmcp.ts`). See
`ADS-memory/reports/proposals/PLAN-jini-agentic-extraction-2026-07-26.md` and
`packages/agentic/source-map.md` for the extraction and the full file map.

**What stayed, and why.** `chat-capabilities.ts` — the seven `chat.*` capabilities
(`chat.send_message`, `chat.set_draft`, `chat.select_agent`, `chat.cancel_run`,
`chat.reset_conversation`, `chat.set_working_directory`, `chat.get_state`) — is a genuine chat
product surface, not vocabulary, and this package now depends on `@jini/agentic` for the
`CapabilityDef` type rather than the other way around. This is deliberate: if everything had
moved, the vocabulary/product boundary the extraction exists to create would have been fake. The
original reasons this folder existed at all (below) now describe `@jini/agentic`, not this
package:

1. A server-side host (an HTTP route table, an MCP stdio server) must be able to read the same
   manifest without pulling a browser component graph into its process. `chat-react` has a
   single `.` export that reaches `@jini/ui` → `@excalidraw/excalidraw`, `lexical`, `micromark`.
2. `chat-react` is one framework binding. A Vue or Svelte sibling must read identical
   definitions, or the surfaces drift.

**Vocabulary settled here (pre-2026-07-26, still true):** `tool` stays reserved for the engine's
own `ToolRegistry`/`ToolExecutor` nouns; anything an outside caller asks a *frontend* to do is a
**capability**. The first draft had forked this across four files (`ChatPaneAgentToolDef` next
to `capabilityId`), which is why `chat-react`'s older names still carry `@deprecated`.

**Entry points, updated.** This package's `.` export no longer carries a `./agentic` subpath —
removed in the 2026-07-26 extraction, since the folder now only holds one chat-specific data
module rather than a slice worth publishing separately. An external consumer that wants only the
vocabulary now depends on `@jini/agentic` directly.

**Not here:** how an action reaches a page. That is a transport concern — same-document in a
real site, `postMessage` when a host embeds an untrusted preview in a sandboxed frame. The
verbs are identical either way, which is the point of keeping them transport-free.

## Transcript generalization (`src/transcript.ts`)

The task named `providers/daemon.ts`'s transcript helpers as "pure helpers
only." On closer read, three things in that section were not, in fact,
generic — the recon's "pure helper" framing undersold how much OD product
policy was woven in:

1. **BYOK/OpenCode agent-family scoping was hardcoded.** The origin
   `scopeHistoryToAgent`/`isSameTranscriptAgentFamily` hardcode
   `BYOK_OPENCODE_AGENT_ID = 'byok-opencode'` and a `Set` of OD's specific
   BYOK provider agent ids (`anthropic-api`, `openai-api`, `azure-openai-api`,
   ...). This is OD product routing policy, not generic transcript assembly.
   **Fix:** `buildTranscript()`'s `isSameAgentFamily` is now a caller-supplied
   predicate (`BuildTranscriptOptions.isSameAgentFamily`), defaulting to
   exact-id equality when omitted. A host that wants OD's BYOK-family
   behavior supplies that predicate itself; chat-core ships no opinion on it.
2. **The prior-run context warning scanned for an OD-specific tool's output.**
   `buildPriorRunContextWarning` detected an `agent-browser skills get core`
   dump (a specific OD tool's documentation payload) via `compactInput()`
   and a set of literal substring checks (`'Agent Browser Core'`, `'name:
   core'`). This is OD-tool-specific detection logic, not a generic
   transcript concern. **Fix:** dropped entirely, along with the
   now-unused `compactInput()` helper. The remaining warning (high
   input-token count, large persisted tool results) is generic and was
   kept, with its thresholds made configurable
   (`maxMessageChars`/`largeToolResultChars`/`highInputTokenWarningThreshold`
   options, defaulting to the origin's literal constants: 12,000 / 8,000 /
   200,000).
3. **Product-identity strings in user-visible warning text.** The origin
   literally emits `"Open Design truncated ${n} chars..."` and `"Open Design
   detected ${notes}..."`. Both are hard product-identity strings forbidden
   in `packages/@jini/**`. **Fix:** reworded to `"[truncated ${n} chars from
   this prior message before sending it to the agent. ...]"` and `"Detected
   ${notes}."` — same information, no product name.
4. **`persistedArtifactFilesOf` derived its evidence from OD's
   `ChatMessage.producedFiles: ProjectFile[]`** (`ProjectFile` being an OD
   contract type this package must not depend on, and a field this
   package's `ChatMessage` doesn't carry at all — see `messages.ts`
   deviations above). **Fix:** `buildTranscript()` takes an optional
   `resolvePersistedArtifactFiles?: (message: ChatMessage) =>
   ReadonlyArray<PersistedArtifactFileRef>` callback instead, defaulting to
   "nothing persisted" (no summarization) when omitted. A host derives the
   real list from its own file-write bookkeeping and passes it in — the
   same host-injects-the-product-shaped-bit pattern used throughout r4b §2
   (`ProjectContextValue`, slots, etc.).

`latestUserPromptFromHistory` ported verbatim (no OD coupling found).
`sanitizePriorAssistantTurnForTranscript` → `sanitizePriorAssistantTurn`
(renamed, dropping the redundant "ForTranscript" suffix now that it lives in
a module literally called `transcript.ts`); its own logic (stripping an
answered `<question-form>`/`<ask-question>` block and a fenced JSON schema
echo) was generic already and is unchanged, only its `persistedArtifactFiles`
parameter's provenance changed per point 4 above.
`buildDaemonTranscript` → `buildTranscript` (renamed, matching the target
API name and dropping the transport-specific "Daemon" naming — the function
itself never touched the daemon transport).

## Known ambiguity: `RunStatus` name collision with `@jini/protocol`

Per r4b §1/§2's literal target API list, this package exports `RunStatus` as
a flat string union (`'queued' | 'running' | 'succeeded' | 'failed' |
'canceled'`) — the value a `ChatMessage` stamps on itself. `@jini/protocol`
already exports a *different*, richer `RunStatus` (`{ id, state, startedAt?,
endedAt? }`, per its own `src/run.ts`). These are two different types for two
different layers, in two packages with no dependency edge between them, so
there is no compile-time conflict — but a consumer importing both packages
will need to alias one on import (`import type { RunStatus as
ChatRunStatus } from '@jini/chat-core'`). Not fixed here because the target
API name is explicit in the task brief; flagged for `@jini/chat-react` /
future integration work to resolve with an import alias convention, or for a
future ADR to rename one of the two.

## Not ported / explicitly deferred

- **`ToolRenderer`/`registerToolRenderer`/`getToolRenderer`/`clearToolRenderers`**
  (`apps/web/src/runtime/tool-renderers.ts`) — the React-typed renderer
  registry. Out of scope per the task brief ("NOT the renderer-registry/
  registration mechanism itself"); belongs to a future `@jini/chat-react` or
  `@jini/renderers-react` task.
- **`runtime/chat-events.ts`** (`appendErrorStatusEvent`,
  `removeErrorStatusEvent`, `runFailureFieldsFromError`) — recon listed this
  as a "reusable" event-dedup/derivation file, but on reading it, all three
  functions exist specifically to carry OD's `RunFailureCategory`/
  `RunFailureDetail` daemon failure-classification taxonomy (imported from
  `@open-design/contracts`) onto a `status: 'error'` event. Since r4b §2's
  own target `AgentEvent.status` shape already omits `failureCategory`/
  `failureDetail` (see `events.ts` above), there is nothing generic left in
  this file to port once that OD-specific taxonomy is stripped — porting it
  would mean shipping three functions that manipulate fields this package's
  `AgentEvent` doesn't have. Not ported; a host that wants this behavior can
  build the equivalent one-line "find/replace the last `status:'error'`
  event in an array" helper itself, or it can ride the `ext` event escape
  hatch for its own richer failure-taxonomy event kind.
- **`streamViaDaemon`/`DaemonStreamHandlers`/anything importing
  `@open-design/contracts`, `./anthropic`, or `./sse`** from
  `providers/daemon.ts` — the SSE/fetch transport itself. Explicitly out of
  scope per the task brief; this is `@jini/chat-react`'s (or a dedicated
  transport-port package's) `ChatTransport` territory, not chat-core's.
- **The reserved-workspace-path denylist in `validate.ts` is not made
  configurable in this task** (see that file's row above) — it is a fixed
  three-entry list (`.live-artifacts`, `.workspace`, `.tmp`) with the OD-only
  entry (`.od`) dropped and no replacement mechanism for a host to supply its
  own reserved paths. Flagged as a small follow-up for whichever task next
  touches artifact persistence end-to-end (this package has no persistence
  layer of its own to wire it through yet).

## Dependencies

None beyond the TypeScript standard library, per r4b §1 ("Allowed deps: none
beyond TypeScript stdlib"). No React, no DOM/browser globals, no Node
built-ins, no `@jini/protocol` or any other `@jini/*` package, no OD product
imports. Verified by grep across `packages/chat-core/src/**` for
`window`/`document`/`fetch`/`EventSource`/`localStorage`/`sessionStorage`/
`XMLHttpRequest`/`WebSocket` (bare and `globalThis.`-qualified), `react`
imports, `node:*`/`fs`/`path` imports, `process.*`, and any `@open-design/*`
specifier or `Open Design`/`OD_`/`--od-stamp`/`/tmp/open-design`
product-identity string — all clean (see Programmer handoff report for the
exact commands run).

## Strictness-only edits (Jini's stricter `tsconfig.base.json`, no behavior change)

Jini's root `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`,
which OD's own tsconfig does not set. This surfaces object-literal
assignments of an explicit `T | undefined` value onto a plain `field?: T`
property (legal without the flag, an error with it). Fixed by widening the
declared optional-field types to `field?: T | undefined` at the six sites
this affected — no logic changed, only the declared type of already-optional
fields:

- `src/artifacts/types.ts`: `ArtifactManifest.status`/`primary`/
  `supportingFiles`/`createdAt`/`updatedAt`/`sourceSkillId`/`designSystemId`/
  `metadata`.
- `src/artifacts/recover.ts`: `RecoverHtmlArtifactInput.identifier`/`sourceText`.
- `src/todos.ts`: `TodoItem.activeForm`.
- `src/question-form.ts`: the three option-lookup helpers
  (`formOptionDisplayForValue`/`formOptionLabelForValue`/
  `formOptionValueForLabel`) took `Pick<FormQuestion, 'options'>` in the
  origin; retyped to an inline `{ options?: FormOption[] | undefined }` so a
  locally-computed `FormOption[] | undefined` variable can be passed as
  `{ options }` without a spread workaround.
