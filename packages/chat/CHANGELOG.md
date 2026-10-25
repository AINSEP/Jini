## 0.6.12

### Patch Changes

- chat: typing while a choice card waits queues the message instead of cancelling its tool call; answered choice cards keep their question and report option labels, not values; mid-run follow-ups read "Queued" until consumed; one steady thinking clock.
  - @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- Honest turn footers (done / stopped / interrupted), answered question cards keep their question and chosen labels, readable conversation titles and counts; the usage tooltip reads "N output tokens".
- Mid-run message relay for MCP-bridged engines (Codex, ACP, Antigravity): `registerMessageRelayRoutes` on `@jini-ai/daemon/http`; mid-run messages queue instead of interrupting, and recovery waits on an uncertain probe.
- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- f9d9894: Hide recovered tool failures when tool calls are hidden. Keep unrecovered failures in one compact, localized disclosure per reply, preserving their existing details.
- 8ff5653: Make the chat-pane transcript readable from outside the component — a must-have for an AI (or an
  e2e harness) verifying that commands it gave the pane (create a form, add a user, change a
  permission) actually happened.

  Before this, `<ChatPane>` fully encapsulated its conversation state: `useConversation()`'s
  `messages` never left the component, `ChatPaneProps` had no callback that reported the live message
  list, and the rendered transcript (`MessageList`/`MessageRow`/`ToolCard`) carried zero
  `data-agent-element` tags — unlike every other interactive surface in this app's reference pages.

  - `ChatPaneProps.onMessagesChange?: (messages: ChatMessage[]) => void` — fires with the full message
    array on every change, mirroring the existing `onActivityChange` pattern. Each `ChatMessage`
    already carries its `events` array (`tool_use`/`tool_result`), so a subscriber gets complete,
    structured tool-call data for free — no DOM parsing needed.
  - `data-agent-element="chat-transcript"` (role `list`) on the message-list container, and
    `data-agent-element="chat-message-<id>"` (role `region`) on every message row, so `page.*` DOM
    tools can enumerate the transcript the same way they read everything else in this app.
  - `ToolCard` now wraps whatever it renders (any of its dozen built-in card variants, or a host's own
    custom-registered renderer) in one `data-agent-element="tool-call-<use.id>"` (role `region`)
    element — added at the single dispatch point every branch already funnels through, so no
    individual card variant's own markup changed. The collapsed-by-default accordion detail (args/
    result JSON) sits inside this tagged element, not gated behind expanding it: `textContent` (what
    the `page.*` DOM driver actually reads) is layout-agnostic, so the full detail is readable whether
    or not anything has been clicked open.

- 3fe4d14: Add compatibility regression fixtures for legacy inline image results, media-only saved events and delegated echo notes; runtime behavior is unchanged.
- 8ff5653: Add `createDaemonAttachmentUploader`, so composer drag-and-drop is one line instead of 160.

  `ChatPane` has always gated its drop target and file picker on `uploadAttachments` being supplied — but
  supplying it meant writing the client half yourself: a bounded-concurrency worker pool that preserves
  input order, per-turn quota accounting, abort and timeout plumbing, and cleanup of files that already
  landed when a later one fails. Every host would write the same ~160 lines, and the ordering and
  cleanup details are exactly the ones that get skipped.

  ```tsx
  <ChatPane
    transport={transport}
    uploadAttachments={createDaemonAttachmentUploader(daemonUrl)}
  />
  ```

  That talks to `@jini-ai/http-kit`'s `POST`/`DELETE /api/attachments`. Pass `''` when a dev-server proxy
  already forwards `/api` from the page's own origin. `maxAttachmentBytes`, `maxAttachmentCount`,
  `maxBatchBytes`, `timeoutMs`, and `concurrency` are all configurable and all default to the daemon side's
  own limits, so the client's early rejection matches what the daemon would have said anyway.

  Client-side quotas are a courtesy, never the boundary — telling a user their 400 MB video is too large
  before the browser streams it, not after. The daemon re-derives every one of them.

  Two behavioral notes for anyone porting hand-rolled code onto this:

  - **The request always sends `content-type: application/octet-stream`**, not `file.type`. The daemon
    sniffs the real kind from the bytes and ignores the header, so forwarding the browser's guess buys
    nothing — and breaks real uploads: a dropped `.json` file arrives as `application/json`, which an
    app-wide `express.json()` on the daemon then claims, draining the request stream before the upload
    route can read a byte.
  - **Batch accounting is per uploader instance**, not module-global, so two panes pointed at two daemons
    cannot consume each other's per-turn quota. Reservations are rolled back on failure, so a retry of a
    failed turn is not refused for quota it never actually used.

- 72ea04d: Folded `@jini-ai/renderers-react` into `@jini-ai/ui` as an independently-importable, tree-shakeable
  `./renderers` subpath, and retired the package.

  Real (non-comment) imports of `@jini-ai/renderers-react` anywhere in the repo were exactly 3 files,
  2 symbols, all inside `@jini-ai/ui`'s own `features/html-viewer` — `openSandboxedPreviewInNewTab`
  and `useSandboxBridge`. `@jini-ai/ui` was already the package's only real consumer, so a standalone
  package bought nothing, the same reasoning that folded `@jini-ai/ui-core` into `./core` and
  `@jini-ai/composio` into `@jini-ai/admin`. The whole `src/**` tree (registry, renderers, srcDoc
  host, annotation-canvas, preview-modal-shell, i18n) moves to `packages/ui/src/renderers/` as one
  `git mv`, unchanged in shape; `html-viewer`'s two consumers switch from the package-qualified
  import to a relative one, since they're now in the same package.

  **The `@jini-ai/renderers-react → @jini-ai/chat` dependency was dropped first, before the move,
  not after.** `registry.ts` imported `ArtifactManifest`/`inferLegacyManifest` from `@jini-ai/chat`,
  and `types.ts` re-exported five manifest types from there. `@jini-ai/chat` already depends on
  `@jini-ai/ui`, so folding renderers-react into `ui` unchanged would have created a real `ui ↔ chat`
  package cycle. The five manifest types (`ArtifactManifest`, `ArtifactKind`, `ArtifactRendererId`,
  `ArtifactExportKind`, `ArtifactStatus`) are now defined locally in `types.ts`, copied verbatim from
  `@jini-ai/chat`'s `src/core/util/types.ts` — a small duplicated-type cost, accepted because a
  renderer package must not depend on a chat package.

  **`resolveArtifactManifest` no longer infers a legacy manifest from a file's name/extension** — a
  real, disclosed API behavior change. It now returns `file.manifest ?? null`. Manifest inference
  (guessing kind/renderer from `.md`/`.html`/`.svg`/`.tsx`, etc.) is a caller concern that depends on
  a product's own naming conventions, not something a generic renderer registry should do on a
  caller's behalf; a caller that still wants that inference should resolve a manifest for the file
  itself (see `@jini-ai/chat`'s `inferLegacyManifest`) before handing it to this registry. Verified
  zero external callers of `RendererRegistry`/`resolveArtifactManifest`/`createDefaultRendererRegistry`
  anywhere in Jini or Tovu before making this change — `@jini-ai/chat`'s own `RendererRegistry` is an
  unrelated, locally-defined class in `artifact-types.ts`, and `@jini-ai/artifacts`' own
  `resolveArtifactManifest` is an unrelated 3-argument function; both are same-name coincidences, not
  real dependents. The four bundled renderers (`HtmlRenderer`, `MarkdownRenderer`, `SvgRenderer`,
  `ReactComponentRenderer`) gate `canRender` on a resolvable manifest before falling back to any
  `file.kind`/extension heuristic of their own, so this ripples into every test that exercised
  default-registry routing via a bare file name with no explicit `manifest` — all updated to attach
  one, with the extension-inference-specific assertions flipped to assert the removed behavior no
  longer fires. No test was weakened or deleted: every changed assertion now tests the new,
  documented contract, or restores a manifest to keep testing what it always meant to test.

  **`@jini-ai/renderers-react` is retired, not versioned forward.** It was published (0.1.2), and
  `packages/renderers-react` is deleted from this workspace. Deleting the source does not unpublish
  anything, so whoever runs the next release should follow up with:

  ```
  npm deprecate @jini-ai/renderers-react "Merged into @jini-ai/ui; import from '@jini-ai/ui/renderers' instead."
  ```

  `@jini-ai/chat`'s dead `@jini-ai/renderers-react` dependency (declared, never imported — its own
  `react/artifact-types.ts` defines a local placeholder registry instead, per its
  `TODO(renderers-react)` header, left untouched here as out of scope) is removed from its
  `package.json`, hence the accompanying patch bump.

- 0c247a8: Fix visitor chat streaming announcements, resumed focus, frame batching, persistence and lazy mount/retry handling. Document the additive A2uiSurfaceCard registry prop for host validation and rendering.
- e16a907: Clear floating-point noise in displayed costs, reconcile resumed counter resets and revisited sessions, and expose reported output tokens to assistive technology.
- ea8d883: Release modal semantics when focus leaves chat, announce bounded rendered reply text, and retry opening without reloading mounted assets.
- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.6.7 — 2026-10-22

- 2026-10-22: Memory fixes (durable run store reads its own row, ledger parses events once), shared settings segmented control, Slack token rule restored, coverage.

## 0.6.6 — 2026-10-16

- Staged attachment rows sit 8px apart so the top row's remove target stays 44px (4884cf15).
- The Done line for tokens-only runtimes uses run timestamps and the known total (9fd89d41).
- An unknown tool on the read-only gateway points the model to discovery, never a mutation 409 (75d37c32).
- A run that could not continue says why, and a wait for the owner is never reported as "no progress" (13e90536).
- The model picker shows the default model by name, not its raw id (6b4b613d).

## 0.6.5 — 2026-10-15

- Durable recovery no longer gives up on a finished CLI turn (8c6acfea): a saved successful Claude CLI `result` line carries `modelUsage.contextWindow`, which matched the context-limit pattern case-insensitively, so a dropped stream or restart ended the answer with "The assistant could not continue this answer" instead of continuing it. The pattern now requires a separator, and attempt diagnostics skip successful CLI result lines (`type: "result"`, `is_error: false`).
- `recover()` logs one `[durable-recovery]` info line per decision (9cc967cd) with runId, trigger, probe, decision and failure class only; `logger` is an optional injectable, default console.
- On phones and touch screens the attachment preview's Close and previous/next get 44px tap areas (3b6a5480); desktop is unchanged.

## 0.6.4 — 2026-10-15

- Image preview steps through a message's or the composer's images (2444ac4d): clicking a sent image or a staged chip opens the preview; with more than one image, previous/next buttons (bottom-right) and the arrow keys step through them; Esc or a backdrop click closes it and focus returns to the thumbnail. Staged chips show a thumbnail, labelled "Image" when the name is only a content hash.
- The staged attachment tray shows two chips per row (eef66b2e): chips cap at half the tray (max 290px), so four show before the 88px tray scrolls. Chips in the pinned-context zone keep their full-width cap.
- On phones and touch screens the staged chip's remove button gets a 44px tap area (660cb9fd); chip and button sizes are unchanged.

## 0.6.3 — 2026-10-14

- A failed MCP bridge ends the run once with its own message (e350056c): durable recovery no longer retries `MCP_BRIDGE_UNAVAILABLE` runs until the budget runs out and then shows the generic "could not continue" notice; the run is finalized with the bridge failure's exact text.
- The composer accepts file drops while a run streams (7c3d57a7), matching the attach button and paste; the drop gate (`isChatPaneFileDropEnabled` in `rules.ts`) blocks only on a missing uploader, a disabled/agent-less pane, or an upload in progress.
- Rides along: a regression test for the lone composer send button (3516cc04).

## 0.6.2 — 2026-10-13

- A lone composer send button stays at the footer's end (b1d7a7b7): a host with no attach or accessory controls (a public visitor chat) left the send group as the footer's only child, so `space-between` put it at the bottom-left; `margin-left: auto` on a first-child send group keeps it on the right, as in the admin composer.
- Rides along (094de0bb): the assistant transport declares the minimal per-turn execution input it reads instead of importing `@jini-ai/ui`'s `ExecutionConfig`; `CHAT_BUBBLE_STYLE` moves to `src/contracts` (the lazy loader re-exports it); the React barrel exports `UserTextRedaction`; history-tools types its risk map as a `ReadonlyMap`.
- Comment scrubs and two refreshed tests, no behavior change (8e508fb6, fb28c5a4).

## 0.6.1 — 2026-10-13

- Owned renderer registries: `createToolRendererRegistry` / `createExtEventRendererRegistry`, optional `JiniChatProvider` props `toolRendererRegistry` / `extEventRendererRegistry`, and `registerMcpUiSurfaceRenderer({ registry })`. The global register/get/clear functions keep working against a compatibility default. A stale unregister handle no longer removes a replacement registered with the same callback.

## 0.6.0 — 2026-10-13

- Remove Recharts peer/dev dependencies. Legacy chart wire components now use the neutral UI host with a styled table fallback; require the extracted UI ^0.5.0 so older built-in Recharts imports cannot leak into a clean consumer.

## 0.5.6 — 2026-10-08

- Desktop 0.1.13 release fixes: see commits a2659d24 (admin), 5695a7c3 (chat, agent-runtime), 8ad4ac5c (devops).

## 0.5.5 — 2026-10-08

- Tovu clean-up release: code Tovu moved into Jini, plus the Jini clean-up (see the commit log).

## 0.5.4 — 2026-10-06

- Prompt history in the composer: ↑ with the caret on the first line recalls earlier sent messages and ↓ on the last line walks forward; the first ↑ stashes the current draft (empty or not) and ↓ past the newest entry (or Escape) restores it exactly. Recalled entries are never mutated; consecutive duplicates collapse. New pure `createComposerHistoryState` / `transitionComposerHistory` / `composerHistoryKeyAction` / `mergeComposerHistory` / `normalizeComposerHistory` (core) and `createBrowserComposerHistoryStorage` (react, a `ComposerHistoryStoragePort` default). `useComposer`/`ChatPane` take `historyScope`, `historyStorage` and `historyMessages`.
- Durable runs: new `recoveredRunEvents` (core) projects a recovered run's saved events so a continued answer completes the same message; a run notice shows only on a real resume.
- Message attachments: the transport sends each message's own attachment refs, and attachment chips keep their kind across reloads.
- Requires `@jini-ai/protocol` ^0.4.1.

## 0.5.3 — 2026-10-06

- New `createLastConversationStore({ scope }, { storage? })` (react): remembers one conversation id per caller identity under a versioned localStorage key (`jini.chat.last-conversation.v1.<scope>`); corrupt or foreign entries read as nothing remembered. Selection stays host-owned.
- Restored staged attachments keep their upload batch: the draft cache records the batch id beside each conversation's attachment references, and `useChatPane` resumes that batch on mount and on a conversation switch, so a second attachment after a remount no longer fails the turn ("Attachments must belong to one batch").
- A display-only A2UI surface (`surfaceProperties.displayOnly`, e.g. a drawn chart) no longer reads as "Waiting for your answer above".
- A run held on an open form reads as waiting, not working: new `isAwaitingAnswer`, passed to ext event renderers as `awaitingAnswer`.
- One row per delegated tool call: `isDelegatedWrapperToolName` covers both delegated gateways (bare or `mcp__<server>__`-prefixed) and `foldDelegatedWrapperCalls` drops a wrapper call once its canonical call exists (`useToolTimeline`, `ToolCard`).
- Markdown: `[label](url)` links render (relative and parenthesized URLs, unsafe schemes kept as text, off-site links open in a new tab); intraword underscores never open or close emphasis.
- A late scroll event no longer unsticks the transcript from the bottom; only a move up does.
- Requires `@jini-ai/agentic` ^0.4.2 (`displayOnlySurfaceIdOf`).

## 0.5.2 — 2026-10-05

- `useChatPane` holds a draft typed for a question that has since closed (answered elsewhere, expired, or refused with `'not-pending'`): `send` shows the `'not-pending'` notice instead of queueing it as a new paid run. Only clearing the draft or the new `sendAsNewMessage()` (the notice's "Send as a new message" button in `ChatPane`) lets it out as an ordinary turn. New pure `findAwaitedTypedAnswerId`.
- A delivered typed answer clears the composer only if its text is unchanged, so a correction typed while the host answered survives; a delivery settling after `reset()`, a conversation switch or unmount changes neither the draft nor the notice.

- `ChatPane`/`useChatPane` accept `deliverTypedAnswer`: text typed while the running agent holds a question card open (a surface whose tool call has not returned) goes to the host instead of the queue. `'delivered'` clears the draft; `'not-pending'`/`'failed'` (or a throw) keep the draft, show a notice (`typedAnswerNotice`) and never queue it, so a closed question can no longer turn an answer into a second paid run. New `createTypedAnswerPoster` posts `{toolName, params: {__typedAnswer}}` to the MCP-UI tool-call route (202 delivered, 409 not-pending). Omitting the prop keeps today's queue-while-streaming behavior.

- `McpUiSurfaceCard` counts down a card's answer deadline (`MCP_UI_EXPIRES_AT_META_KEY`) under the live frame ("Expires in {time}", `role="timer"`) and closes it as "This question expired" when the deadline passes; a card answered in time still reads "Answered". New `useSurfaceExpiry` hook with an injectable `SurfaceExpiryClock` (card prop `expiryClock`), and pure `describeSurfaceExpiry`/`formatRemainingTime` in core.

- A user's own send or retry re-sticks the transcript to the bottom even when they had scrolled up to read history (`MessageList`; scroll rules move to `useMessageListAutoScroll`).
- The `@jini-ai/db` peer range is `^0.2.0 || ^0.3.0`; chat uses only db's kernel and store entries, which 0.3.0 leaves unchanged.

## 0.5.1 — 2026-10-04

- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on `@jini-ai/agentic` 0.4.1 or on a newer patch resolves a single copy without an override.

### Also shipped in 0.5.1 (was listed under Unreleased)

- Type store fixtures with the shared storage kernel and chat contracts, including host-owned tables;
  align construction, reopening, paging and message fixtures with current API shapes.
- Declare jsdom and better-sqlite3 development types for package-wide test compilation.

- Update the A2UI chat renderer and its catalog fixture to the agentic/UI object-argument APIs.
  Supply the shared system clock and preserve the existing action-ID sequence and timestamp format;
  adapt interpreter unsubscribe to React cleanup without type assertions.
- Include tests in package typechecking; align capability/barrel calls, run-event fixtures and the
  finalizer's asynchronous daemon mock with their current contracts.

- Remove the unexported MCP-UI proof of concept, its fixtures and tests, and the unused internal
  model picker with its tests. Neither directory was reachable from a public entry point.
- Exclude both directories' stale compiled output from distribution when rebuilding over an old dist.
- Drop chat's direct `@mcp-ui/client` and `@mcp-ui/server` dependencies; the live MCP-UI surface
  continues to use the shared UI implementation. Public exports and runtime behavior are unchanged.

## 0.5.0 — 2026-10-02

### BREAKING

- Browser fetch is injected; run activity/finalization use canonical ports and embed/browser surfaces are isolated. CSS imports remain side effects for bundlers.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

- Browser bridge/uploader fetch ports default to global fetch. Partial-upload cleanup now uses the injected uploader fetch; quick deadlines stay 15 seconds. Remove platform dependency and retain native timeout reasons.

- Adopt shared kernel contracts and preserve the module rationale in neutral documentation.
- Add run-event folding, injected run settlement and the optional AG-UI projection on isolated subpaths.
- Add opt-in embeddable chat composition, injected fetch/SSE transport, bounded browser session storage and host-controlled page actions on isolated subpaths.
- Convert public helper and compatibility factory argument shapes to required and optional objects while preserving transcript storage, ownership checks and renderer priority.
- Correct renderer priority and opt-in stylesheet documentation; retain the layout rationale with neutral provenance.
- BREAKING: replace the local finalizer Clock with core Clock.nowMs(); core/React helpers and ext-event slot-key callbacks take required objects.

- BREAKING: ChatStore methods use required argument objects; paging options move to the second bag. ChatHistoryMaintenance and ChatStoreFactory follow the same convention.
- BREAKING: SQLite/Postgres/PGlite factories use core `Clock` through `{ clock }` rather than `{ now }`; system-time defaults and SQL behavior are preserved.

## 0.4.0 (unpublished release candidate)

- Owner-scoped transcript adapters and paging live on store subpaths; the host supplies the migrated kernel.

## Unreleased

- Add neutral owner-scoped ChatStore, structured errors and bounded keyset pages.
- Add SQLite, embedded/socket PGlite and Postgres adapters over the same borrowed kernel SQL body.
- Preserve the eight-method ChatHistoryStore contract and existing stored schema/projection.

# @jini-ai/chat-core

## @jini-ai/chat 0.3.11

### Patch Changes

- `useChatPaneRuntimeInventory` polls daemon health only while the tab is visible. Hiding the
  tab clears the interval; showing it checks status once and restarts the interval. A tick is
  skipped while the previous status call is still in flight. Hosts no longer need their own
  hidden-tab probe gate for this hook.

## 0.1.2

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (whose
  tsconfig uses this legacy resolution mode): adding these two fields, with its tsconfig completely
  unchanged, made the error disappear. Also fixes absolute-path `require()` (distinct from a bare
  specifier, which already worked) for the same reason — `main` was previously absent.

  Purely additive: every modern resolver (Node's own runtime `exports` resolution, TypeScript's
  `bundler`/`node16`/`nodenext`) prefers `exports` over `main`/`types` when both are present, so
  this changes nothing for a consumer already on a modern resolver.

- Updated dependencies
  - @jini-ai/agentic@0.1.2

## 0.1.1

### Patch Changes

- Add a `"default"` export condition to every published package's `exports` map — every one of
  them lacked it, which meant `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for any
  CommonJS consumer (found via a real external integration attempt; Node needs `require(esm)`
  support, i.e. Node >=22.12, for this to resolve).

  `@jini-ai/agent-runtime`:

  - **New**: `RuntimeBuildOptions.permissionMode` (`'bypass' | 'restricted'`) lets a caller opt a
    run OUT of the auto-approve-every-permission-prompt flag every def with one
    (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) previously pushed
    unconditionally, with no way to turn it off. Omitting it keeps today's default (bypass)
    behavior unchanged.
  - **New**: `ClaudeStreamEvent`, `CopilotStreamEvent`, and `QoderEvent` are now real exported
    discriminated unions instead of `Record<string, unknown>` — a real external consumer guessed a
    nonexistent field name (`event.text` instead of the actual `event.delta`) against the old
    untyped sink and silently lost every streamed token with no compile or runtime error.
  - Fixed a doc/implementation mismatch in `claude-stream.ts`: the module doc claimed `tool_result`
    events carry `{ tool_use_id, content, is_error }`; the actual emitted shape is
    `{ toolUseId, content, isError }`.

  `@jini-ai/daemon`: `AgentExecutorRunInput.permissionMode` forwards the new
  `RuntimeBuildOptions.permissionMode` through to `buildArgs`, so a host can actually reach the new
  opt-out from the daemon's real run-input surface, not just from `@jini-ai/agent-runtime` in
  isolation.

  `@jini-ai/agentic`: `setAtPointer` no longer throws on a malformed (e.g. missing leading `/`)
  `updateDataModel` path — degrades to a no-op like its sibling `getAtPointer`, matching this
  package's own "a bad binding must not crash the renderer" contract. That path is agent-authored
  wire data with no error boundary above it in any host, so the uncaught throw could unmount an
  entire chat UI from ~40 bytes of malformed input.

  `@jini-ai/chat-react`: a local (client-resolved) A2UI button action is no longer a silent no-op —
  `A2uiSurfaceCard` now surfaces the resolved value. New `ExtEventErrorBoundary` confines a
  `kind: 'ext'` event group's renderer to its own card instead of letting a render/effect-phase
  throw from agent-controlled content unmount the whole chat root (there was no error boundary
  anywhere in this package or its hosts before this).

- Updated dependencies
  - @jini-ai/agentic@0.1.1

### C2 storage ownership

- Added `./store/legacy` and `./store/legacy/sqlite`; preserved sync local project chat CRUD and schema.
- Retained the original owner-isolation suite on the concern adapter after draining the old package.
