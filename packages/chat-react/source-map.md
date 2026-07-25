# `@jini/chat-react` — provenance

Origin: `leonaburime-ucla/open-design` (fork of `nexu-io/open-design`), two source
branches, both public OPEN draft PRs:

- `refactor/web-chat-pane-slice` (PR #5461), commit `58fe4358747bd08b82c36947f1ff05aa5fa6a02a`
  (2026-07-10) — decomposes `apps/web/src/components/ChatPane.tsx` (4,332 → 1,212
  lines) into `apps/web/src/features/chat-pane/`.
- `refactor/web-chat-composer-slice-pr` (PR #5465), commit
  `99c9134ea1de97cab936d1acf9fc537de06b2351` (2026-07-10) — decomposes
  `apps/web/src/components/ChatComposer.tsx` (5,569 → 1,774 lines) into
  `apps/web/src/features/chat-composer/`.

Plus the near-clean presentational leaves cited by
`foundry/docs/jini-port/recon/r4b-webui-design.md` §1, read from the chat-pane-slice
checkout's `apps/web/src/components/` (unchanged by that branch's own
decomposition, so identical across both source branches):
`ToolCard.tsx` (582 lines), `QuestionForm.tsx` (725 lines — r4b's "890" line
count is stale; the real file is 725), `QuestionsPanel.tsx` (521 lines),
`NextStepActions.tsx` (1,069 lines), plus `runtime/tool-renderers.ts` (124
lines) and `runtime/todos.ts` (162 lines).

Per `foundry/docs/jini-port/extraction-plan.md` §3 and
`foundry/docs/jini-port/recon/r4b-webui-design.md` §1/§2/§4: `@jini/chat-react` is
the headless-hooks + presentational-components + slot-interface layer built
on `@jini/chat-core`'s framework-free vocabulary. See that doc for the full
target API surface this package implements.

## Reference Preflight (recorded before any edit, per this task's brief)

1. **Jini branch/SHA**: worked on `port/chat-react`, branched off Jini
   `origin/main` at `e3110ac6e576208a7f75753020f986b0de1ac7e7`.
   **OD branch/SHA**: both listed above (cloned directly — public, no
   credentials — `refactor/web-chat-pane-slice` @ `58fe4358…`,
   `refactor/web-chat-composer-slice-pr` @ `99c9134e…`).
2. **Canonical vertical-slice reference** — the task brief named
   `apps/web/src/features/memory/`, `apps/web/src/providers/memory/`,
   `apps/web/tests/features/memory/`, `docs/adr/0002-frontend-vertical-slice-decomposition.md`,
   `apps/web/AGENTS.md`, `scripts/check-web-slice-boundaries.ts` as the
   canary to read from the same OD source. **None of these exist in either
   source branch** — verified by `find` across both full checkouts (only
   `docs/adr/0001-centralize-daemon-startup.md` exists; no `features/memory`
   anywhere in either tree; no `apps/web/AGENTS.md`; no
   `check-web-slice-boundaries.ts` anywhere in `scripts/`). Also checked
   Jini's own vendored `foundry/integrations/open-design/reference/` snapshot (a
   *later*, 2026-07-16 cutoff vs. these branches' 2026-07-10) — same result:
   `MemorySection.tsx` exists only as a flat, not-yet-sliced component under
   `components-original/`/`od-web-src.orig/components/`, never as a
   `features/memory/` slice. **This is a real gap** between the task brief's
   assumption and what the two named source branches (or Jini's own
   snapshot) actually contain — flagged rather than silently worked around.
   Proceeded anyway (did not stop) because the port+dependencies+hooks+
   components+barrel discipline the memory slice would have demonstrated is
   independently, directly observable in the two branches actually named as
   THIS task's primary source: both `features/chat-pane/` and
   `features/chat-composer/` already use exactly that layout
   (`ports.ts`/`dependencies.ts`/`hooks/*.hooks.ts`/`components/*.tsx`/
   `index.ts`/`rules.ts`/`types.ts`/`constants.ts` — see file listings
   below), and it is *also* cross-validated against `@jini/ui`'s already-
   shipped features (`connectors`, `i18n`, `settings-dialog`) which apply the
   identical discipline inside this very repo. Using the primary source's
   own structure as the pattern reference is strictly stronger evidence than
   the named secondary exemplar would have been, so this was judged
   sufficient to proceed rather than a blocking gap — see the parent task's
   final report for the explicit call-out of this deviation.
3. **Live callers/importers enumerated**:
   - `ChatPane.tsx` (`apps/web/src/components/ChatPane.tsx`, 1,212 lines
     post-slice) is the sole orchestrator that imports from
     `features/chat-pane/index.ts`; its own public props were not changed by
     the slice (the PR is behavior-preserving per its own ADR-0002-style
     discipline).
   - `ChatComposer.tsx` (`apps/web/src/components/ChatComposer.tsx`, 1,774
     lines post-slice) is the sole orchestrator importing
     `features/chat-composer/index.ts`.
   - Both orchestrators are themselves imported by `AssistantMessage.tsx`/
     `ProjectView`-shaped OD product code, which is out of this task's scope
     (product-specific, stays in `foundry/integrations/open-design/` if/when that
     adapter needs it).
4. **OD-only seam that stays behind** (verified via each slice's
   `dependencies.ts`/`ports.ts`, not inferred): AMR/Vela billing login status
   (`AmrLoginPort`/`VelaLoginStatus`/`VelaUser`/`VelaLiveAccount` —
   chat-pane), the Lexical rich-text editor integration and its
   `LexicalComposerInputHandle` ref plumbing, MCP server + installed-plugin
   catalogue fetches (`ComposerCataloguePort`), the design-toolbox/
   brand-browser/OdCard/SketchPreview/comments-annotation widgets, and every
   PostHog analytics call-site (`trackQuestionsFormClick`,
   `trackNextStepActionClick`, ...). All of this is OD product policy or a
   third-party editor integration, not generic chat UI — it stays behind in
   `foundry/integrations/open-design/` (or a future OD-side wrapper around this
   package's slots) rather than being lifted.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/transport.ts` | `apps/web/src/providers/daemon.ts` (`DaemonStreamHandlers` L261, `DaemonStreamOptions`/`DaemonReattachOptions` L273-334, `streamViaDaemon` L594) | Generalized into the `ChatTransport`/`RunHandlers`/`StartRunInput` port shapes per r4b §2, verbatim field names (`onAgentEvent`→`onEvent`, `onToolInputDelta` kept as-is). Every OD-specific `DaemonStreamOptions` field (`projectId`, `sessionMode`, `byokProvider`, `analyticsHints`, `titleGeneration`, ...) is dropped — they ride through the opaque `RunContext` a host attaches via `StartRunInput.context` instead. |
| `src/artifact-types.ts` | *(new)* | Local `ArtifactFile`/`ArtifactRenderer`/`RendererRegistry` per r4b §2, with a `TODO(renderers-react)` header — see "Deferred" below. |
| `src/slots.ts` | r4b §2 (design doc, not an OD file) | Verbatim TS interfaces: `ProjectContextValue`, `ModelAgentPickerSlot`, `ComposerPlusItem`, `ComposerSlots`, `AttachmentTraySlot`, `AnnotationAdapter`, `FilePreviewSlot`, `AnalyticsAdapter`, `I18nAdapter`. Added `AgentOption`/`AgentSelection`/`MentionSource`/`MentionResult` (r4b names them in prose — "agents: AgentOption[]" / "@-mention providers" — but doesn't give their shapes; defined here to the obvious minimal shape). `ComposerSlots.footerAccessories` is the neutral host seam corresponding to OD `ChatPane`'s `composerFooterAccessory`, used by hosts for controls such as an agent/model picker. |
| `src/tool-renderer-registry.ts` | `apps/web/src/runtime/tool-renderers.ts` (124 lines, the React-typed registry half `@jini/chat-core` deliberately did not port) | Verbatim `registerToolRenderer`/`getToolRenderer`/`clearToolRenderers`/`ToolRenderer` — ships "as-is" per r4b §2. |
| `src/react/hooks/useRunStream.ts` | *(new — headless hook over `ChatTransport`)* | Implements r4b §4's `useRunStream` row from scratch (transport port didn't exist as a hook in OD — OD's `streamViaDaemon` is called directly from `ChatPane`'s god-component state). Generation-counter-guarded against stale reconnect/duplicate-start callbacks (see the hook's own doc-comment). |
| `src/react/hooks/useConversation.ts` | *(new, composes `useRunStream`)* | r4b §4's `useConversation` row: message array + optimistic append + scroll-intent, reconciling `useRunStream` events onto the active assistant message. |
| `src/react/hooks/useComposer.ts` | `apps/web/src/features/chat-composer/hooks/useComposerDraft.hooks.ts` + `useComposerUpload.hooks.ts` + `useMentionPopover.hooks.ts` (state shape only — Lexical-editor-ref plumbing and the localStorage `ComposerDraftPort` are OD/DOM-specific and dropped in favor of an injectable `persistence` port) | Generalized per r4b §4. |
| `src/react/hooks/useToolTimeline.ts` | *(new, pure over `@jini/chat-core`'s `dedupeToolUsesById`/`deriveToolStatus`)* | r4b §4's row. |
| `src/react/hooks/usePinnedTodos.ts` | `apps/web/src/runtime/todos.ts`'s pinned-card logic (`latestTodoWriteInputForPinnedCard`, already lifted into `@jini/chat-core`) + `components/ToolCard.tsx`'s `TodoCard` `onDismiss` convention | r4b §4's row. |
| `src/react/hooks/useQuestionForms.ts` | `apps/web/src/components/QuestionForm.tsx`'s `parseSubmittedAnswers` (verbatim logic, generalized into this package since chat-core ships only the forward `formatFormAnswers` direction) | r4b §4's row. |
| `src/react/hooks/useArtifactStream.ts` | *(new, pure over `@jini/chat-core`'s `parseArtifacts`/`splitStreamingArtifact`)* | r4b §4's row. Found and fixed a real bug during its own test-writing: `parseArtifacts()`'s one-shot flush synthesizes a completed `artifact:end` for whatever is still open, which double-counts a live artifact when run on raw streaming content — fixed by splitting via `splitStreamingArtifact` first. |
| `src/react/hooks/context.ts` | *(new)* | This package's own `I18nContext`/`AnalyticsContext`/`ProjectContext`/`ChatTransportContext`/`ArtifactRegistryContext` + `use*` accessors — cannot reuse `@jini/ui`'s `I18nProvider`/`useT` (not an allowed dependency per r4b §1), so reimplemented the same passthrough-default pattern locally. |
| `src/react/components/Icon.tsx` | `packages/ui/src/components/Icon.tsx` (path data only, for visual consistency; not a dependency — chat-react can't import `@jini/ui`) | A minimal 8-glyph subset covering only what this package's own components use. |
| `src/react/components/Markdown.tsx` | `apps/web/src/runtime/markdown.tsx` (734 lines) | **Deliberate subset**, not a full port — see file header. Covers ATX headings, fenced code, lists, blockquote, hr, paragraphs, inline code/bold/italic/autolinks. GFM tables and the copy-button affordance are TODO follow-ups. |
| `src/react/components/TodoCard.tsx` | `apps/web/src/components/ToolCard.tsx`'s `TodoCard` | Near-verbatim; `op-*` classNames kept, every string wrapped in `useT()`. |
| `src/react/components/ToolCard.tsx` | `apps/web/src/components/ToolCard.tsx` (582 lines) | Near-verbatim family-card ladder (Write/Edit/Read/Bash/Glob/Grep/WebFetch/WebSearch/Generic). The legacy `AskUserQuestion`-history read-only card (~140 lines in the origin, existing only to render OD's *pre-existing persisted chat history* from before the `<question-form>` mechanism existed) is intentionally **not** ported — a fresh `@jini/chat-react` consumer has no such legacy history; an unrecognized tool name (including `AskUserQuestion`) correctly falls through to `GenericCard`. |
| `src/react/components/QuestionForm.tsx` | `apps/web/src/components/QuestionForm.tsx` (725 lines) | Near-verbatim; types repointed at `@jini/chat-core`'s `QuestionForm`/`FormQuestion`/`FormOption`/`DirectionCard`, `formatFormAnswers`/`formOptionValueForLabel` imported from chat-core instead of a local `artifacts/question-form` module. `parseSubmittedAnswers` (the one function this file also exported) moved to `useQuestionForms.ts` since it's hook-consumed logic, not itself a component. |
| `src/react/components/QuestionsPanel.tsx` | `apps/web/src/components/QuestionsPanel.tsx` (521 lines) | Generalized — dropped PostHog analytics tracking, the project-scoped file-upload path (`uploadProjectFiles`), and the 10-minute skip-countdown auto-continue (all OD product policy; see file header). |
| `src/react/components/NextStepActions.tsx` | `apps/web/src/components/NextStepActions.tsx` (1,069 lines) | **Heavily pruned** per r4b §1's explicit "prune OD actions" directive — every hardcoded OD prompt catalog (design-system refine/audit, brand-extraction, plan actions, project-continue, ...) and the design-toolbox action registry are dropped. What's left: a generic `<NextStepActions actions={NextStepAction[]} onSelect={...}>` row a host populates with its own catalog. |
| `src/react/components/MessageRow.tsx`, `MessageList.tsx`, `Composer.tsx`, `AttachmentTray.tsx` | *(new compositions of the above leaves)* | **Not** direct ports — see `MessageRow.tsx`'s own header for why (the two source branches decompose `ChatPane`/`ChatComposer`, not `AssistantMessage.tsx`, which is a separate not-yet-dispatched extraction task). Reasonable v1 compositions; `MessageRow`'s tool-card/text interleaving is a documented TODO simplification (tool cards render as one block after the text, not fully interleaved at their original stream position). |
| `src/react/components/JiniChatProvider.tsx` | r4b §2's `JiniChatProviderProps` interface | Verbatim shape; the composition root wiring every context. |

## `features/chat-pane/` composition root (2026-07-23)

The package now also ships a self-contained, product-neutral `ChatPane`.
This closes the prior integration gap where every consumer had to repeat
`useConversation` + `useComposer` + runtime selection + send/reset/cancel +
activity-state wiring and build a local agent picker. The reference host now
renders one package component and supplies only transport/environment props.

**Reference preflight**: verified against the real Open Design clone at
`/Users/la/Desktop/Programming/OSS-Repos/open-design`, not the frozen
integration snapshot. The primary visual/interaction references were
`apps/web/src/components/ChatPane.tsx` and
`apps/web/src/components/AvatarMenu.tsx`, including the Local CLI / API · BYOK
mode rows, installed code-agent list, model and reasoning selectors,
body-portaled placement, outside-click dismissal, Escape focus restoration,
and PATH rescan affordance. OD-specific billing, account, settings, and
product routing were deliberately omitted.

| Jini file | Origin | Transform |
|---|---|---|
| `features/chat-pane/types.ts` | OD `ChatPane`/`AvatarMenu` public state shapes + daemon agent summaries | Browser-safe neutral `ChatPaneAgent`, selection, activity, run-context, positioning, and component prop contracts. Working-directory integration is exposed as `workingDirectory`/`initialWorkingDirectory` + `onChangeWorkingDirectory`, with a narrow `ChatPaneWorkingDirectoryAccess` I/O capability; it does not leak a host-owned picker state machine. The inventory shape is structurally compatible with the HTTP daemon DTO without adding an `@jini/http` dependency. |
| `features/chat-pane/rules.ts` | OD agent/model defaulting and installed-agent ordering behavior | Pure deterministic selection/default/order rules. Unavailable agents fail closed and never appear in the picker. |
| `features/chat-pane/react/hooks/useChatPane.hooks.ts` | OD `ChatPane` conversation/composer orchestration | Shared controller composing `useConversation`, `useComposer`, and the working-directory controller; owns controlled/uncontrolled runtime selection, send payloads, attachments, run context, reset/cancel, and activity derivation. The selected package-owned working directory is injected into the functional run context. This is the reuse seam for future visual ChatPane variants. |
| `features/chat-pane/react/hooks/useChatPaneWorkingDirectory.hooks.ts` | OD `WorkingDirPicker` orchestration moved out of the product host | Owns controlled/uncontrolled directory state, recent-directory refresh, validity, native-picker cancellation, and capability errors. The host supplies filesystem effects only. |
| `features/chat-pane/react/components/AgentRuntimePicker.tsx` | OD `AvatarMenu.tsx` | Product-neutral package picker with Local CLI / API · BYOK rows, available agents, model/reasoning controls, live status, rescanning, and bounded up/down body-portal geometry. Host-specific API credential configuration remains prop-driven. |
| `features/chat-pane/react/components/ChatPane.tsx` | OD `ChatPane.tsx` composition pattern + generic `@jini/ui/working-dir-picker` | First `workspace` visual variant. Owns messages, suggestions, composer, runtime picker, working-directory picker, failure/stream/cancel UI, and scoped package styling. Hosts can provide effects, context, data, and explicit extension slots without reimplementing its controller. |
| `features/chat-pane/react/styles.ts` | OD chat/picker layout, generalized | Scoped `jini-chat-pane` styling shipped with the component so a host does not need private chat or picker CSS. The reference host supplies the exact OD agent-icon assets and Remix Icon font through public static assets. |

All feature tests live in `features/chat-pane/__tests__/`. They directly cover
the pure rules, working-directory state/effects, hook controller, runtime
picker, full composition, and public barrel. The package coverage gate remains
100% statements, branches, functions, and lines.

## Deferred / follow-up (do NOT block on these)

- **`@jini/renderers-react` integration** (`src/artifact-types.ts`,
  consumed by `useArtifactStream.ts`): per this task's SCOPE NOTE,
  `ArtifactFile`/`ArtifactRenderer`/`RendererRegistry` are defined locally
  to r4b §2's shape rather than imported from `@jini/renderers-react`
  (still a placeholder stub, being built in a separate session). A future
  pass should replace `src/artifact-types.ts`'s contents with a re-export
  from `@jini/renderers-react` once that package ships real
  implementations, and delete the local copy.
- **`Markdown.tsx`** — GFM pipe tables and the per-code-block copy button
  from OD's 734-line original are not ported (see that file's header).
- **`MessageRow.tsx`** — full event-order interleaving of text/tool-cards
  (matching `AssistantMessage.tsx`'s real behavior) is not implemented;
  tool cards currently render as one block after the message text. This
  file is a fresh composition, not a port (see its header) — revisit once
  `AssistantMessage.tsx` gets its own extraction task and a real reference
  exists to port against.
- **Mention popover UI** — `useComposer`'s `mention` state (query/results/
  open) is implemented and tested, but no `<MentionPopover>` presentational
  component is included in this pass; a host renders its own popover UI
  driven by that state today.
- **OD's exact AMR/Vela billing, design-toolbox, brand-browser, comments/
  annotation, MCP-catalogue, and Lexical-editor widgets** all stay behind in
  `foundry/integrations/open-design/` (see Reference Preflight §4) — none of them
  were ported, by design.

## `features/model-picker/` (2026-07-18)

A generic, provider-grouped, credential-status-badged, searchable model/agent
picker — an **independent feature slice** depending only on
`@jini/agent-runtime`'s registry vocabulary (`ModelProvider`, `ModelOption`,
`AgentDefinition`, `CredentialStatus`, ...), never on this package's own
conversation/message state. Lands here rather than `@jini/ui` per the project
owner's explicit boundary call — `@jini/ui`'s README excludes chat/model-picker
UI by design (see `packages/ui/README.md`).

**Reference preflight**: source cloned fresh from
`leonaburime-ucla/open-design` at commit
`0b88ef56144b5a42dc427c1292ae22676d698a34` (2026-07-18, `main`) — not the
frozen `foundry/integrations/open-design/reference/` snapshot. Read in full:
`apps/web/src/components/InlineModelSwitcher.tsx` (1,105 lines) and its
siblings `modelOptions.tsx` (310), `providerModelsCache.ts` (43),
`agentModelSelection.ts` (29), `AgentDiagnosticRow.tsx` (133),
`AgentPicker.tsx` (74); `NewProjectPanel.tsx`'s `MediaModelCards` (3,059-line
file, function at line 2525). Confirmed by direct read (not just citing
`foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.13/§3 and
`r5-components-sweep.md` §4) that both files independently implement the same
"group models by provider, badge each provider's credential/integration
status, search-filter, click to select" shape — `r6`'s cross-cutting pattern
table already named this recurrence; this task verified it firsthand.

**A real gap, flagged and closed rather than worked around**: the task brief
assumed `@jini/agent-runtime` already had the registry/types this feature
should depend on. At the time this task started, that package had zero
TypeScript source beyond a placeholder `index.ts` (only `craft/`+`skills/`
markdown content — see `packages/agent-runtime/README.md`/`source-map.md`).
Rather than either (a) silently inventing a parallel model/agent vocabulary
inside this feature — which the same instruction explicitly forbade — or (b)
blocking the whole task on a Coordinator ruling, this task added the missing
registry module to `@jini/agent-runtime` itself
(`packages/agent-runtime/src/registry.ts`, ported from the same OD read
above), then built this feature on top of it. See that package's
`source-map.md` for the full symbol-by-symbol provenance, including one
deliberate, documented behavior change (`normalizeAgentModelChoice` applies
to every agent, not just OD's hardcoded `amr` carve-out).

| Jini file | Origin | Transform |
|---|---|---|
| `types.ts` | *(new, re-exports `@jini/agent-runtime`)* | `ModelPickerGroup`/`ModelPickerSelection`/`FetchProviderModelsInput`/`FetchProviderModelsResult` — feature-local composites over the agent-runtime vocabulary. |
| `constants.ts` | `modelOptions.tsx`'s `minSearchableOptions = 8` default | `DEFAULT_MIN_SEARCHABLE_OPTIONS`; `CREDENTIAL_STATUS_SORT_PRIORITY` factored out of `MediaModelCards`'s inline `sortPriority` ternary. |
| `rules.ts` | `MediaModelCards`'s `groups`/`filteredGroups` `useMemo` bodies + `modelOptions.tsx`'s `matchesModelSearch`/`isCustomModel` | Same grouping/sort/search/custom-value logic, made pure and React-free (no `useMemo` — callers memoize). `triggerSub`'s prefix-avoidance ternary ported as `modelSubtitle`. |
| `ports.ts` / `dependencies.ts` | *(new, mirrors OD's `fetchProviderModels`/`providerModelsCache` pair)* | `ModelPickerPort.fetchProviderModels` is optional — a static-model-list host needs no port at all. `dependencies.ts` ships only the no-op default, never a concrete transport call (same discipline as `@jini/ui`'s `features/connectors/` canary). |
| `react/hooks/useModelPicker.hooks.ts` | `InlineModelSwitcher.tsx`'s outside-click/Escape `useEffect` pair + `SearchableModelSelect`'s open/query state | Headless controller: open/query state, derived groups/selection via `rules.ts`, the dismissal effect. **Not ported**: the `document.body`-portaled fixed-positioning (`modelOptions.tsx`'s `useLayoutEffect` popover placement) — this feature's popover renders inline; see `ModelPicker.tsx`'s header for why. Adds an `autoSelectFirst` option (default `false`) generalizing `MediaModelCards`'s always-on "no selection → pick the first available model" effect, since forcing a selection isn't universally wanted (e.g. an agent-model picker that should show "no agent" rather than force-picking one). |
| `react/components/ModelPicker.tsx` | `MediaModelCards` (trigger + provider-grouped popover) | De-branded, generic over `ModelOption`/`ModelProvider`/`CredentialStatus`; every string wrapped in `useT()`. |
| `react/components/CredentialStatusBadge.tsx` | `MediaModelCards`'s inline `newproj-provider-badge` span | Extracted as its own small presentational atom (own `configured`/`available`/`unconfigured` labels), reused by `ModelPicker.tsx`. |

**Not ported by the independent model-picker slice** (host-owned or out of
scope for that pass, not silently dropped): OD's AMR/Vela billing
login+balance UI, the daemon-mode/BYOK execution-mode toggle, the
agent-install grid (`AgentIcon`-keyed cards +
rescan/install/docs diagnostic buttons — `AgentDiagnosticRow.tsx`'s fix-intent
ladder), analytics tracking calls, and the `document.body`-portaled popover
positioning. `AgentDiagnostic`/`AgentFixIntent` are ported into
`@jini/agent-runtime`'s registry (a future pass can build an
`AgentDiagnosticRow`-equivalent component on top of them) but this pass ships
only the model-picker half, not an agent-diagnostics UI.

**i18n**: every user-facing string (`label`, search placeholder, empty-state
copy, "Recommended" badge, credential-status labels) is wrapped in `useT()`,
using this package's own `I18nContext` (cross-cutting adapter, not
conversation/message state — consistent with every other component in this
package; see `context.ts`). Verified with a real test per component
(`ModelPicker.test.tsx`, `CredentialStatusBadge.test.tsx`) that mounts under
`I18nContext.Provider` with a real dictionary and asserts translated text
renders, not just the unconfigured-passthrough case.

**Coverage-driven refactor loop note**: one uncovered branch surfaced during
this pass turned out to be `noUncheckedIndexedAccess` type-checker noise, not
reachable code (`agent-runtime/src/registry.ts`'s `normalizeAgentModelChoice`)
— resolved with a one-line-commented non-null assertion per the
classify-then-fix loop, not a test padding it out or a suppression comment.

## Dependencies

`react`, `react-dom` (peer, no direct runtime use beyond JSX), `@jini/chat-core`,
`@jini/agent-runtime` (both workspace — the latter added 2026-07-18 for
`features/model-picker/`, see above). No `@jini/ui`, no `@jini/renderers-react`
(see Deferred above), no `@open-design/*`.

**DOM/transport note (updated 2026-07-23)**: every network/runtime I/O reaches
the host through `ChatTransport`,
`ProjectContextValue`, or an injected persistence port, with zero direct
`fetch`/`EventSource`/`localStorage` calls in production. The model picker and
chat-pane runtime picker use `document` listeners for outside-click/Escape;
the runtime picker additionally reads viewport geometry to place its
body-portaled menu. These are generic, effect-scoped presentation concerns,
not transport calls. Verified by search across
`packages/chat-react/src/**` for `window`/`document`/`fetch`/`EventSource`/
`localStorage`/`sessionStorage`/`XMLHttpRequest`/`WebSocket` (bare and
`globalThis.`-qualified) and any `@open-design/*` specifier or `Open
Design`/`OD_`/`--od-stamp`/`/tmp/open-design` product-identity string. Only
the presentation API sites named above remain; there is no product-identity
or OD-specific transport coupling.
