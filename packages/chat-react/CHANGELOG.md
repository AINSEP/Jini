# @jini-ai/chat-react

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [28c6d3d]
  - @jini-ai/agentic@0.3.0
  - @jini-ai/chat-core@0.3.0
  - @jini-ai/ui@0.3.0
  - @jini-ai/protocol@0.3.0

## 0.2.1

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (Tovu, whose
  tsconfig uses this legacy resolution mode): adding these two fields, with its tsconfig completely
  unchanged, made the error disappear. Also fixes absolute-path `require()` (distinct from a bare
  specifier, which already worked) for the same reason — `main` was previously absent.

  Purely additive: every modern resolver (Node's own runtime `exports` resolution, TypeScript's
  `bundler`/`node16`/`nodenext`) prefers `exports` over `main`/`types` when both are present, so
  this changes nothing for a consumer already on a modern resolver.

- Updated dependencies
  - @jini-ai/agent-runtime@0.2.1
  - @jini-ai/chat-core@0.1.2
  - @jini-ai/ui@0.1.2
  - @jini-ai/agentic@0.1.2

## 0.2.0

### Minor Changes

- 0d15314: Add a neutral Composer footer slot for host-owned controls, forward an optional host-selected model through every AgentExecutor runtime transport, expose daemon-owned live agent/model discovery with an explicit rescan route, and recognize Claude Code's partial-stream `message_delta` turn boundary so successful stream-json runs close cleanly.

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
- Updated dependencies [0d15314]
  - @jini-ai/chat-core@0.1.1
  - @jini-ai/ui@0.1.1
  - @jini-ai/agentic@0.1.1
  - @jini-ai/agent-runtime@0.2.0
