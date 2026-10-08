# @jini-ai/core

## 0.4.2 — pending release

- Own generic settings at `./settings` and its optional Express adapter at `./settings/express`; keep both out of the root runtime closure. Move the existing permission helper into core, preserving the CMS command denial class through re-export.

- Own the shared surface-exchange interfaces and reserved parameter constants, formerly declared in daemon. Add the `SurfaceAskThenReport` port so UI can consume the existing daemon lifecycle without depending on its runtime.

## 0.4.1 — 2026-10-05

- New `readToolLimit({ input, max, fallback }, { key })`: an absent limit is `fallback`, one above `max` is capped at `max`, and a non-integer or one below 1 throws `ToolInputError` ("'limit' must be an integer between 1 and <max>").
- New `optionalOneOf({ input, key, values })`: a value outside `values` throws `ToolInputError` ("'<key>' must be one of: ..."). Both are additive.

## 0.4.0 — 2026-10-02

### BREAKING

- Canonical primitive ports, JSON/time/HTTP types and tool contracts now live in core; use ./composition instead of ./internal and ./text for untrusted-text handling.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Add browser-safe `pathContains` to `./primitives` for absolute lexical paths, with host-selected case sensitivity and complete directory-segment boundaries.

### Shared registration wiring

- Move the domain-independent catalog/input/schema/risk/confirmation registration kit into the root entry, with its behavior contracts. Domain-specific authorization and denial errors remain outside the kernel.
- Use the existing named argument surface directly; primitive, Result and tool catalog types remain canonical in core.


### Shared kernel

- Add `./primitives` with canonical time, ID, JSON, HTTP, logger and result contracts,
  system/crypto/console default adapters, and UTC time helpers. No runtime dependencies.
- Add root agent-tool catalog types, preserving delete as a distinct risk classification.
- Add `./text` with the unchanged bounded terminal sanitizer and its behavior tests.
- Expand telemetry redaction to the union of core, CLI and provider rules, with literal
  exact-secret masking and named extra patterns. Export the eleven diagnostics credential
  regexes unchanged. Broader opaque/short bearer/header/query rules can mask more input;
  union vectors and existing category tests document the behavior.
- Add UTF-8 `timingSafeTokenMatch` with a required injected native comparison port so the
  kernel stays universal. Both original native comparators have identical results.

### BREAKING — shared kernel

- Rename `./internal` to `./composition` without an alias. Authorized tool invocation and
  pack binding derivation keep their implementation and security boundary.
- Gated mutations now require `Clock.nowMs()` and `IdGenerator.newId()` from primitives,
  replacing the local `ClockPort.nowIso({})` and `IdGeneratorPort.newId({})`. Format clock
  samples with `nowIso({ clock })`; approval order, TTL and wire timestamps are unchanged.
- Origin diagnostics use `Pick<Logger, 'warn'>` rather than a duplicate logger interface.
  The alias name `OriginValidationLoggerPort` remains available with the shared shape.


- Add transport-neutral gated mutations with required token generation/TTL and async
  authorization, identity and token-store ports; preserve verified-plan handoff and
  single-use redemption, with atomic explicit expiry and duplicate-issuance rejection.
- Add domain-owned model-facing error allowlists, an instance-owned contribution
  registry, and bounded naming with required collision, suffix and message policies.
- Add generalized approval, disclosure, registry and naming contract tests plus a
  package-wide source-neutrality guard. Verification is deferred by owner directive;
  the four subpath manifest exports are listed in `extraction-w4a.md` for coordination.

### Extraction integration

- Publish `./gated-mutations`, `./model-facing-tool-errors`, `./contribution-registry`
  and `./naming`, with universal runtime metadata and matching root barrel exports.
  These entries implement the earlier manifest follow-ups in `extraction-w4a.md`;
  no runtime dependency or version change is required.
- BREAKING: Existing core APIs now accept a required-args object and a separate
  optional-args object. Tokens, bindings, registry lookups, pack callbacks/lifecycle,
  redaction, auth/origin helpers, ToolInputError and internal authorization changed
  shape with no compatibility adapters. Environment snapshots are explicit, origin
  logging uses a supplied port, and optional handler emitSurface moved to the second
  argument. Update consumers before adopting this release. Version unchanged.
- BREAKING: New extraction APIs follow the same convention: contribution
  `list({})`/`clear({})`, `new InMemoryTokenStore({})`/`count({})`, approval
  `computePlan({})`, `nowIso({})`, `newId({})` and `generateToken({})`, and marker-error
  constructors `new ErrorClass({ message }, { cause? })`. `ForbiddenError` additionally
  requires `reasonCode`; naming exhaustion callbacks receive `{ base, maxAttempts }`.
  `AuthorizeFn` moves optional `entityType`/`entityId` selectors to its second object.
- Add package-entry identity, manifest/runtime, approval-port, error-cause and
  convention contract tests. Extend the source-neutrality guard to the manifest.
  All verification remains not run (owner directive).

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
