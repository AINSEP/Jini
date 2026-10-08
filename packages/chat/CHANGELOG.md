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
