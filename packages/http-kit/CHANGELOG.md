# @jini-ai/http

## 0.3.0

### Minor Changes

- 8ff5653: Add the attachment upload capability: `POST`/`DELETE /api/attachments` plus a disk-backed store.

  Composer file and image uploads were something every host had to build for itself. Getting it _working_
  is easy; getting it right is not, and the parts that are easy to skip are the parts that matter — a
  renderer must never learn a filesystem path, a claimed file must be provably the same file that was
  uploaded, and the bytes must be gone when the run ends. This is that whole capability, extracted from a
  working host implementation rather than designed fresh.

  `createDiskAttachmentStore({ uploadDirectory, ... })` satisfies the `AttachmentStore` port with every
  quota defaulted (10 files / 50 MB per message, 100 files / 200 MB per store, one-hour retention).
  `registerAttachmentRoutes(app, { store }, adapter)` mounts the two routes, with a per-registration
  concurrent-upload limit, a streaming byte cap, and the same-origin guard on by default.

  What the store guarantees, all of it re-derived server-side and none of it taken from the client:

  - the wire `path` is an opaque `attachment:<uuid>` capability, never a filesystem path — `claim()` is
    what exchanges one for a real path, and only once per attachment;
  - `kind` is sniffed from the leading bytes (`detectAttachmentKind`), so a renderer cannot decide whether
    its upload reaches the agent as an image;
  - the display name is a sanitized basename; the _stored_ name is a fresh UUID;
  - `claim()` re-verifies `dev`/`ino`/`size` and `realpath` against what registration recorded, so neither
    the file nor a parent directory can be swapped for a symlink in between;
  - quota decisions happen with no `await` between the check and the commit, so concurrent uploads cannot
    both reserve the last slot;
  - the upload directory is emptied on construction — files from an interrupted previous process cannot be
    authenticated, so they are not adopted.

  Run-lifecycle wiring stays host-owned, matching `createRunScopedContextStore`'s precedent: a host calls
  `store.claim(...)` in its own `onRunStarted`, threads the result into `AgentExecutor.run()`'s existing
  `imagePaths`/`extraAllowedDirs`/`uploadRoot`, and calls `store.cleanupRun(runId)` in a `finally`. The
  module doc carries that ~10-line pattern. There is no generic run hook to auto-wire into, and inventing
  one here would be worse than documenting the ten lines.

  Two things found while extracting, both now handled rather than inherited:

  - **A body parser silently eats uploads.** The route streams the raw request, so an app-wide
    `express.json()` — which `compose-jini-kernel` mounts for every daemon — consumes the body of any
    upload whose content type it claims. Dropping a `.json` file was enough to trigger it, and it surfaced
    as the useless "attachment is empty". The route now detects an already-drained stream and reports it as
    the host misconfiguration it is.
  - **Two redundant integrity checks that could never fire.** A `path.relative` containment test sitting
    behind a `dirname(filePath) === batchDirectory` check added nothing (parent-directory equality is
    strictly stronger and implies containment), and an `isSymbolicLink()` check behind `!isFile()` on an
    `lstat` result can never be the deciding one, since `lstat` reports exactly one file type. Both were
    removed with the reasoning recorded inline. The accepted-input set is unchanged; the integrity decision
    itself moved into a pure, exported `isUnchangedAttachment` so each condition — including a device
    change, which no filesystem test can stage — is directly verifiable.

- 4f52784: Publish a route manifest so a reverse proxy stops hand-copying path strings.

  A host proxying a Jini daemon in another process needs that daemon's route list to forward anything,
  and with no published inventory the only way to build one was to copy path strings by hand. A
  hand-copied list falls behind the moment a family gains a route — which has already happened in a real
  consumer, whose proxy shipped without `GET /api/runs` and left the daemon's list endpoint 404-ing at
  the host's own router.

  `JINI_ROUTE_MANIFEST`, `routeFamilyManifest(family)`, and `manifestRoutesForFamilies(families)` expose
  `{method, path}` per feature family as inert data, readable without mounting anything.

  The manifest declares **no method or path literals** — every entry is derived from the same
  `JsonRouteSpec` constant the family's `register*Routes` mounts, so a path change moves the manifest with
  it. A paired test mounts each declared family's real registrar and asserts the manifest matches, so the
  one remaining failure mode (a family gains a route nobody lists) fails a test instead of a consumer.

  That test earned its keep immediately: it found that the `runs` family mounts **two** spec-less
  streaming routes, `/api/runs/:runId/events` and `/api/runs/:runId/agui-stream`, easy to mistake for one
  another and both needed by a proxy. `RUN_EVENTS_ROUTE_PATH` is now exported alongside the existing
  `RUN_STREAM_ROUTE_PATH` so neither has to be restated as a literal.

  Scope is honest: the manifest covers the families a sidecar consumer proxies, not all 19 the package can
  mount. `routeFamilyManifest` returns `undefined` for an undeclared family rather than an empty array, so
  "not described here" is never mistaken for "has no routes".

- 4f52784: Add a `sidecar-strict` security mode and per-run MCP credential propagation.

  For a daemon whose threat model is **another process running as the same OS user** rather than a
  remote attacker, the existing `jini-local` mode is a no-op: `registerApiBearerAuthMiddleware`
  short-circuits for any loopback peer before it reads the `Authorization` header, and a `127.0.0.1`
  bind keeps remote hosts out while doing nothing about a co-resident process. A consumer that spawns a
  Jini daemon holding real authority — starting agent runs, executing tools against a real database —
  previously had to write its own middleware.

  - `@jini-ai/http-kit` gains `requireStrictBearerToken`: fail-closed 503 when the named token env var
    is unset, 401 on mismatch, **no loopback exemption and no disable flag**. Its `tokenEnvVar` is
    required with no default, so this package never names a host's secret.
  - `composeJiniKernel` gains `security: { mode: 'sidecar-strict', host, tokenEnvVar, exemptPaths? }`.
    Purely additive — `host` and `jini-local` are unchanged by construction, since the modes are arms of
    a discriminated union. The strict gate mounts ahead of the JSON body parser, so a caller it rejects
    never has its body parsed.
  - `@jini-ai/daemon`'s `McpJsonInjectionOptions` gains `credential?: (runId) => string | Promise<string>`
    — a **resolver, not a string**, because injection options are built once before any run exists and a
    boot-wide shared secret would defeat the point of scoping a credential to a run. It is delivered to
    the child as `JINI_DAEMON_TOKEN`.
  - `@jini-ai/mcp`'s `jini-mcp` reads that variable and attaches `Authorization` to every daemon call.
    Optional throughout: with no credential, request headers and `.mcp.json` output are byte-identical
    to before.

  Also generalized: both existing bearer gates now compare tokens in constant time (`timingSafeEqual`)
  and share one header-parsing helper, closing a timing side channel and removing a duplicated regex.

- 8ff5653: `GET /api/tools/:id` answers 404 for an unknown tool id, not 400.

  `toolCatalogDescribeRoute` (the route `@jini-ai/mcp`'s `describe_tool` proxies) reported a
  well-formed request naming a nonexistent catalog entry as `VALIDATION_FAILED` / **400**, because its
  `handle` reached for the same `validationError` helper its `parse` step uses — where 400 genuinely is
  correct. The result was that a caller could not tell "you sent a malformed request" apart from "that
  tool does not exist", which are the two things a status code is supposed to separate.

  The three sibling route families in this package with the identical "the referenced resource isn't
  there" case — `memory.ts`'s `memory not found`, `routines.ts`'s `routine not found`, and `media.ts`'s
  `media task not found` — all already answered 404. This was the one family out of step, so this is a
  behavior correction toward an existing in-package convention rather than a new one.

  Now `NOT_FOUND` / **404**, with the message unchanged (`no catalog entry for tool id "<id>"`).
  `parse` failures on this route — a missing `:id` path segment — are still 400.

  **Behavior change for callers**, hence the minor bump: anything that branched on 400 to detect an
  unknown tool id must branch on 404 instead. Client code that only distinguishes success from failure
  is unaffected. A wire-level test now pins the observed status code for the not-found case, the
  malformed case, and the cross-origin case, so the two cannot silently converge again.

### Patch Changes

- Updated dependencies [4f52784]
- Updated dependencies [8ff5653]
- Updated dependencies [4f52784]
- Updated dependencies [4f52784]
  - @jini-ai/daemon@0.3.0
  - @jini-ai/agent-runtime@0.3.0
  - @jini-ai/core@0.3.0
  - @jini-ai/platform@0.3.0
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
  - @jini-ai/protocol@0.1.2
  - @jini-ai/core@0.1.2
  - @jini-ai/daemon@0.2.1
  - @jini-ai/agent-runtime@0.2.1
  - @jini-ai/platform@0.1.2

## 0.2.0

### Minor Changes

- e181b22: Enforce flat-package domain/runtime/admission metadata, invert optional capability dependencies,
  inject failure-contained run-stream encoders, clean up provisional replay subscribers, and add a
  neutral node-host HTTP-extension composition seam.
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
- Updated dependencies [e181b22]
- Updated dependencies [0d15314]
  - @jini-ai/protocol@0.1.1
  - @jini-ai/core@0.1.1
  - @jini-ai/platform@0.1.1
  - @jini-ai/agent-runtime@0.2.0
  - @jini-ai/daemon@0.2.0
