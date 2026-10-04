# @jini-ai/mcp

## 0.4.0 — 2026-10-02

### BREAKING

- OAuth implementations and the CLI sanitizer dependency were retired; core text and platform filesystem/network entries are canonical. Approval fingerprint domains, wire codes and messages are host-supplied; approval tenancy is optional scope.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Enforce fresh consent for destructive federated calls across both remembered scopes. Destructive
  cards offer no remember buttons, matching chat grants cannot bypass them, and forged remember
  choices are not saved. Keep ordinary, non-destructive remembered approvals and fingerprint bytes.

- Repair package compilation against strict optional properties and current object-call contracts,
  including the test fixtures. Omit absent HTTP signals and approval/revocation scopes; unscoped
  memory approval records omit `scope`. Preserve supplied values, assertions and security guards.

- Use core/primitives path containment after host path resolution. Legal managed directory names beginning with `..` are now accepted; traversal and sibling-prefix escapes remain refused.

- **BREAKING:** Federation prose uses required host messages (`defaultFederationMessages` is
  neutral English); fingerprint domains and error namespaces are required wire arguments.
  Missing confirmation channels derive `${errorCode}_NO_CONFIRMATION_CHANNEL`. Opaque optional
  scope replaces workspace-shaped repository/roster/webhook inputs; approval-duration fields stay.
- **BREAKING:** Bootstrap/reload use core Logger and approval/token clocks use core Clock.nowMs().
  The private secret writer is removed; stores use platform's async atomic writer at 0600 with
  owner-only verification, file/directory fsync and parent creation. Directory-sync errors can
  follow successful replacement. Default info logs use console.info with `agent-daemon` prefix.
- Remove the CLI runtime dependency, including executable URL resolution. Sanitization imports
  core/text; loopback checks use platform/net. Fingerprint and key byte compatibility are pinned
  in tests. The stdio stderr scrubber retains its lowercase marker/minimum length contract.

- Align trust comments with protected-action-only confirmation and preserve the distinct HTTP 401
  and 403 outcomes. Count UTF-8 result/response bytes, cap aggregate serialized images, bound shutdown
  DELETE and all stdio connection phases, pin install data roots, redact diagnostic URLs and use
  declared run statuses. Regression tests are written, not run (owner directive).

- Isolate HTTP 401 challenge-hook failures through the injected logger and bound observer waits by
  the existing request timeout and caller cancellation. Preserve typed authentication failures for
  auth-revocation handlers; hooks may consume the request signal through optional second arguments.
  Regression tests are written and not run (owner directive).

- Finish pass: reconcile `./federation`, `./federation/approvals`, `./federation/stdio`,
  `./federation/testing`, and `./tools/ask-choice` with their entry metadata, source barrels,
  injected ports, and generalized characterization suites. Add declarations/import conditions
  to the existing `./bin` executable entry. The core dependency is declared; lockfile refresh
  remains with the coordinator. Tests, typechecks, build, and packing are not run (owner directive).
- BREAKING: effectful lifecycle methods (`run`, `close`, `reload`, `noteActivity`, `dispose`),
  preset reset, and empty memory-store construction take an empty required object. SDK callbacks
  and zero-argument getters retain their ABI. Question-shape errors take `{ message }, { cause? }`;
  their messages and error classification are preserved. No exports are renamed in this pass.
  Correlation-id generators and idle/request-work callbacks receive an empty object; clocks,
  URL/connection resolvers, list getters, and native scheduler/SDK callbacks keep their ABI.
- Security defaults: reject explicitly invalid transport/auth modes instead of inferring a policy.
  Incomplete configured stdio toolchains now refuse launch; hosts can explicitly opt into
  `allowIdentityFallback: true` with a warning. Unconfigured ordinary launches remain identity
  launches. Protocol bytes, approval fingerprints, timeouts, environment inheritance, and version
  remain unchanged. New regression tests describe these changes and await execution.

- Add `./tools/ask-choice`: a product-neutral human-question tool factory with injected
  policy, presentation, result copy, exchange storage, and pending-question storage.
  Includes an optional clock/ID-injected single-use answer-ticket adapter, generalized
  characterization tests, and a package source neutrality guard. Existing exports and
  the package version are unchanged. Verification deferred by owner directive.

- Add `./federation`, `./federation/stdio`, `./federation/testing`, and
  `./federation/approvals`, completing the new subpaths alongside `./tools/ask-choice`.
  Federation injects client identity, permission, session, credential, resolver, human
  confirmation, approval storage, and current-roster ports. Preserve the approval fingerprint
  format and pinned vector. Declare the core dependency and per-entry runtimes.
- BREAKING: public helpers and factories take required objects and optional settings objects.
  Tool handlers take `{ args, ctx }`, resource readers take `{ ctx }`, and ask-choice handlers
  take `{ ctx }`. Daemon GET/POST helpers and error constructors use named objects.
  Server/transport, federation callback, channel, and resolver ports use named objects;
  cancellation and HTTP body options are second objects. Config/token stores inject filesystem
  and clock ports. `requireString({ value, name })` returns the string; `isAgentSlug(args)`
  narrows `args.value`; `serve({}, deps)` uses `{ text }`/`{ code }` error/exit ports.
  Persisted data and MCP wire formats remain unchanged.
- BREAKING: retire the duplicated MCP OAuth implementation and its root exports. Use the
  independent OAuth package through host credential ports; MCP does not import that engine.
  The root API test now asserts the retired exports remain absent.
- Complete root type exports and reconcile core registry calls, delegated gateway construction,
  daemon proxy callers, test fixtures, and package-wide source neutrality checks. No version bump.
  Verification is not run (owner directive).

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
  - @jini-ai/cli@0.1.2
  - @jini-ai/platform@0.1.2

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
  - @jini-ai/platform@0.1.1
  - @jini-ai/cli@0.1.1
