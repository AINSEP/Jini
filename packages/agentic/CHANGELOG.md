# @jini-ai/agentic

## 0.4.1 — 2026-10-04

- `createAnnotatedActionsScript` registers a published page's annotated actions with WebMCP.
- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on a newer patch resolves a single copy without an override.

## 0.4.0 — 2026-10-02

### BREAKING

- Primitive ports converge into core; installation modules use concept paths and page-capability descriptions use host-neutral messages.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased — shared clocks and neutral navigation

### BREAKING

- Remove GenUiClockPort and A2uiClockPort; gen-ui/A2UI factories accept core Clock.nowMs(). A2UI sequence IDs and explicit per-event now callbacks retain their contracts.

### Changed

- Export defaultAgenticMessages with a neutral navigation description; hosts replace existing capability descriptor copy before projection.
- Skill validation/live-registration/layout tests now live under the behavior-named install test directory. The process supplement lives outside the published package; layout rationale remains in its JSDoc.


## Unreleased

### Integration of extracted APIs

- Complete `./skills/install` and `./skills/install/node` exports and Node runtime metadata. Reconcile shared layout/filesystem/archive/YAML contracts, expose layout and live-registration helpers, and provide `createSkillFetchAdapter` for explicitly supplied native fetch. This completes the previously pending subpath export work described below.
- Include supplemental validation, explicit layout, live-registration and package-neutrality contracts from the extraction jobs, plus package-surface and native-fetch adapter integration tests. The filesystem factory is available from both Node skill entries; universal root/core exports stay independent of Node modules.
- **BREAKING:** Public agent-control, DOM, MCP-UI, GenUI and A2UI functions, constructors and ports take required and optional argument objects. Encoder/interpreter factories require clock/ID ports; model-context detection requires a host-candidate port. Skill HTTP calls now use `fetch({ url }, requestOptions)`, and `SkillInputError` takes `{ message }` with optional `{ cause }`. Export names and wire formats remain intact. See `API.md` for migration examples; consumer rewiring and verification remain pending.

- Add bounded skill installation/state, GitHub import, streaming archive ports and live registration under `skills/install`, with required host layout and dependencies. Add a separate Node filesystem adapter. Subpath exports pending coordinator edit; verification not run (owner directive).

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
  - @jini-ai/protocol@0.1.2

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
  - @jini-ai/protocol@0.1.1
