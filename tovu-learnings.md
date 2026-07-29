# Learnings from integrating `@jini-ai/*` into Tovu

**Context:** Tovu (`/Users/la/Programming/Tovu`) is a headless-CMS product — one binary, one Express
app, one port (ADR-011 topology 1). On 2026-07-28/29 it adopted the published `@jini-ai/*` kernel
(`core`+`daemon`+`http`+`agent-runtime`+`mcp`+`chat-core`+`chat-react`) as its assistant/tool-
execution engine, superseding an earlier plan to hand-roll one with CopilotKit+AG-UI (see Tovu's
`ADS-memory/reports/architecture/ADR-049-assistant-adopts-jini-kit-supersedes-copilotkit-agui.md`
for the full decision record). This doc is the reusable half of what that integration found —
concrete friction, gaps, and things that worked well — written so another agent can turn it into
real Jini changes without re-deriving the investigation. Everything below is evidence-backed
(reproduced against `@jini-ai/core@0.1.2`, `daemon@0.2.1`, `http@0.2.1`, `mcp@0.1.2`,
`agent-runtime@0.2.1`, `chat-react@0.2.0` from npm), not guessed.

Tovu's own consumer code (ambient shims, tool registrations, the standalone agent-daemon process)
lives under `Tovu/src/assistant/` and `Tovu/src/server/modules/assistant.ts` if you want the
concrete before/after — reference, don't import (product-specific). **Update, later the same
session:** the first cut of this integration embedded everything (including `AgentExecutor`, i.e.
the actual CLI-spawning) directly inside Tovu's own process — wrong, see §1a below, corrected to a
genuinely separate OS process (`Tovu/src/assistant/agent-daemon-server.ts`) before this doc's
other findings were written up.

## 1. No embed-into-an-existing-host path is documented (the biggest gap)

`@jini-ai/node-host`'s `createLocalNodeDaemon` — the one "host preset" that exists — boots its
**own** Express app and its **own** TCP listener (`{url, server, stop}`). That's the right shape
for Jini's own desktop-daemon-as-separate-process topology (OD, the Jini playground), but it's the
wrong shape for a single-process product with its own existing Express app, session auth, and
`/api/admin/v1/*` routing convention. Tovu could not use `createLocalNodeDaemon` at all without
running a second HTTP server on a second port, which would fork its own auth/session/origin story
in two.

**What we did instead:** composed the lower-level primitives directly — `createToolRegistry`
(`@jini-ai/core`), `createInMemoryEventLog` + `createRunLifecycle` + `createToolExecutor` +
`createAgentExecutor` (`@jini-ai/daemon`), and `@jini-ai/http`'s individual route registrars
(`registerRunRoutes`/`registerAgentRoutes`/`registerDelegatedToolRoutes`) mounted directly onto
Tovu's own `Express` `app` instance. This worked — every one of those functions turned out to be
genuinely host-composable — but it took real source-reading across 4 packages to discover, and
nothing documents it as a supported path versus an accident of the primitives being exported.

**Suggested fix:** a second, documented host preset — call it `mountLocalKernel(app, config)` or
similar — that does what `createLocalNodeDaemon` does *minus* opening its own listener: takes a
caller-owned `Express` app and mounts the same route set onto it, returning the composed
`{registry, lifecycle, toolExecutor, agentExecutor}` for the caller to extend. This is likely a
common shape (any product that's already "one binary, one process" — which is most non-Electron
web apps) and right now requires reading `create-local-node-daemon.ts`'s source to reverse-engineer.

## 1a. `ToolExecutor` and `RunLifecycle` have an undocumented co-location requirement — NOW OPTIONAL, fixed 2026-07-29

**Update:** the requirement below is no longer absolute. `@jini-ai/daemon` now ships
`createRemoteToolEventRecorder` (`packages/daemon/src/remote-tool-bridge.ts`) and `@jini-ai/http-kit`
ships `registerRemoteRunEventRoutes` (`packages/http-kit/src/remote-run-events.ts`,
`POST /api/runs/:runId/tool-use` + `POST /api/runs/:runId/tool-result`) — a small, tested,
authenticated remote path onto the exact same `lifecycle.emit()` method `DelegatedToolBridge.execute()`
already called in-process only. A tool executed in a *different* process from the one holding the
`RunLifecycle` can now report its `tool_use`/`tool_result` events back into that run's own event log,
and existing `stream()` subscribers (SSE included) see them live, same as a locally-executed
delegated tool call. Gated by a dedicated bearer token (`JINI_REMOTE_TOOL_BRIDGE_TOKEN` by default,
configurable) — deliberately a separate trust boundary from the general API token, with no
"disabled" escape hatch (fails closed with 503 if unconfigured, never silently open). 592 daemon +
959 http-kit tests pass after this change, including 23 new ones covering the recorder, the route
parsing/handling, the auth gate, and an end-to-end mounted-route test.

**What this means for topology decisions:** co-location is now a *choice* a host can make, not a
constraint forced on it. A host that wants `ToolExecutor` and `RunLifecycle` in separate processes
can, by wiring the executor side to call the new remote routes instead of relying on in-process
`DelegatedToolBridge`. The original finding (still true as *documented default behavior*, and as the
reason this gap existed for as long as it did) follows below unedited.



Found while correcting the mistake above. `@jini-ai/daemon`'s `DelegatedToolBridge.execute()`
calls `lifecycle.emit()` directly (`delegated-tool-bridge.ts:91,108,119`) to record `tool_use`/
`tool_result` events into the run's own event log — the same log a client's SSE subscription
watches for that run. There is **no HTTP endpoint for remote event injection** (by design —
`registerRunRoutes` exposes `get`/`start`/`cancel`/stream, nothing that lets a caller push an
arbitrary event into someone else's run), so `ToolExecutor`/`ToolRegistry`/
`registerDelegatedToolRoutes` **must** live in the same process as the real `RunLifecycle`/
`EventLog` instance a run is using. There is no way to split "the process that spawns the CLI and
owns the run" from "the process that executes a tool call for that run" — they are one process,
full stop, even though nothing in either package's types or docs says so.

This one constraint drove the actual Tovu shape: the agent-daemon process ended up owning
`RunLifecycle`+`EventLog`+`AgentExecutor`+`ToolRegistry`+`ToolExecutor`+all three HTTP route
families together, not split across "the part that needs a database" vs. "the part that spawns
processes" the way a first design pass reasonably assumes. A tool handler that needs a host's
real database (which is most of them, for any real product) has to reach it some other way — Tovu
had the daemon open its own second connection to the host's SQLite file (`content.db`) rather than
duplicating the host's entire composition root; see §1b for the sequencing hazard that created.

**Suggested fix:** document this constraint explicitly wherever `DelegatedToolBridge`/
`ToolExecutor`/`RunLifecycle` are introduced together (`@jini-ai/daemon`'s own README/module docs,
and `@jini-ai/http`'s `registerDelegatedToolRoutes` doc) — "these three must be constructed in the
same process as each other" is a one-sentence note that would have saved a full rearchitecture
pass here.

## 1b. First-boot seeding races across two processes sharing one SQLite file

A direct consequence of §1a: once tool execution needs a host's real database, and the run/tool
process is separate from the host's own main process, *both* processes end up calling the host's
own DB-composition entrypoint independently (in Tovu's case, `createSqliteRouteDeps()`). If that
entrypoint does any first-boot seeding as a fire-and-forget side effect (Tovu's does — identity/
settings/SEO seed promises that are deliberately *not* awaited before the host's own HTTP listener
opens, so the host can't gate the daemon's startup on "seeding is done" via a simple sequencing
trick), two processes can race the same `INSERT` and one loses with a `UNIQUE constraint failed`.
Reproduced directly, twice, before finding the fix (await the host's own readiness promises
explicitly before spawning the second process, rather than trusting "my HTTP listener is up" as a
readiness signal for anything else).

This isn't really a Jini bug — it's what "compose Jini into a host with a real database, in two
processes" runs into on the host side. Worth a callout in whatever doc ends up covering §1a's fix,
since anyone following that pattern will hit it on their very first attempt at a fresh database.

## 1c. The one preset that exists is all-or-nothing — no selective route activation — RESOLVED 2026-07-29

**Update:** resolved, and at the primitive rather than in the preset. The root cause turned out to be
that `@jini-ai/core`'s `Pack` — the kernel's one composition unit — had `services`/`http`/`cli` but
**no slot for `ToolRegistration`s** (`packages/core/src/pack.ts`). That is why the preset registered
the terminal and `daemon.db.*` tools in one step and mounted their routes in another, and it is why a
route-level switch could never have been safe: turning off `registerTerminalRoutes` would have left
`terminal.create` registered and still reachable through the always-mounted
`POST /api/delegated-tool-calls`.

What shipped:

- **`Pack` gained `tools?` and `dispose?`** (`packages/core/src/pack.ts`), plus `registerPackTools`
  and `disposePacks` (`packages/core/src/pack-lifecycle.ts`). A capability's tools and its routes are
  now one contribution, so "not composed" is the only off state that exists — and third-party packs
  inherit the guarantee, not just this repo's own families.
- **Every built-in route family is now an atomic `JiniFeature` → `Pack`**
  (`packages/server/src/builtin-features.ts`), including the four the preset never wired
  (`memory`/`routines`/`media`/`frontendSessions`) and the new `remoteRunEvents`.
- **Capability-based activation** (`packages/server/src/feature.ts`,
  `feature-activation.ts`): each feature declares `provides: CapabilityId[]` and optional `requires`.
  Capabilities are an **upper bound, not a trigger** — granting `net:egress` permits the model-proxy/
  research/connectors/xAI families but mounts none of them; the caller still names what it wants.
  Explicitly enabling a feature whose capability is denied is a boot error naming both halves, so a
  coarse switch cannot be re-opened one feature at a time.
- **Versioned, immutable profiles** naming a capability grant set (never a hand-listed feature array):
  `agent-core-v1` (run transport only) and `local-daemon-v1` (exactly today's daemon surface). A future
  capability never silently joins a pinned profile.
- **`createLocalNodeDaemon` is now a thin wrapper** over `composeJiniKernel`
  (`packages/server/src/compose-jini-kernel.ts`) pinned to `local-daemon-v1` — public API, route order,
  tool-registration order and shutdown sequence unchanged. It also gained optional
  `profile`/`capabilities`/`features`, and reports `activeFeatures`.
- **`composeJiniKernel` is the embed-into-an-existing-host path §1 asked for**: it takes a
  caller-owned Express app and never opens a listener.

Verified: core 97, daemon 592, http-kit 971, server 182 tests pass; server + core at 100% coverage;
the `examples/minimal-host` end-to-end consumer still reports `MINIMAL_HOST_BOOT_OK`.

The original finding follows below unedited.

`createLocalNodeDaemon` mounts all ~16 of its route families unconditionally on every call —
health, bearer-auth, origin-guard, runs, agents, host-tools, model-proxy, active-context, terminal
(real shell spawn via node-pty), daemon-db (raw sqlite inspect/verify/vacuum), tool-catalog,
delegated-tool-calls, connectors (5 provider slots), research, xai-oauth, plus daemon-status — with
no config flag to turn any single one off. Confirmed by reading `CreateLocalNodeDaemonConfig`'s
full option list (`packages/node-host/src/create-local-node-daemon.ts:242-356` at the point this was
written): every option customizes a feature that is already being mounted (which agent detector,
which workspace-root resolver, which token env var name, ...); none of them gates *whether* a
feature is mounted at all. A host that wants only a subset — Tovu's own daemon needs exactly 3 of
the 16 (`runs`/`agents`/`delegated-tool-calls`) — has no supported way to get that from the preset
itself. The only path today is what Tovu's `agent-daemon-server.ts` already does: skip the preset
entirely and call the individual `@jini-ai/http` registrars by hand on a bare `express()` app,
re-deriving from scratch everything the preset would otherwise have given for free (bindings
plumbing, tool-catalog persistence, health/status routes, etc.).

**Suggested fix, requested explicitly by a host building on this (Tovu):** make route activation a
buffet, not a fixed menu. An explicit opt-in/opt-out config (e.g. `config.routes: { runs: true,
agents: true, terminal: false, daemonDb: false, connectors: false, xai: false, ... }`), defaulting
the low-blast-radius "core" pieces (`runs`/`agents`/`delegated-tool-calls`) to **on** and the
higher-blast-radius ones (`terminal`, `daemon-db`, `xai`, `connectors`, `research`) to **off** unless
a host explicitly opts in — paired with the same sensible defaults the preset already ships today
(deny-by-default tool policies, `denyAllWorkspaceRoots`, 503-until-configured connectors), so a host
gets an easy on-ramp without either hand-rolling every registrar call (today's cost) or silently
inheriting 13 route families it never asked for (the alternative cost). This directly generalizes
this file's own §1 suggested fix (`mountLocalKernel(app, config)`, mounting onto a caller-owned
`Express` app instead of opening a second listener) — whichever function ends up solving that
problem should carry this opt-in route menu too, not just the "don't open a second listener" half of
the problem.

## 2. `@jini-ai/http`'s route registrars use fixed, non-prefixable, unauthenticated paths

`registerRunRoutes`/`registerAgentRoutes`/`registerDelegatedToolRoutes` hardcode `/api/runs`,
`/api/agents`, `/api/delegated-tool-calls` — verified via `grep` on the compiled JS, no way to
pass a prefix. A host with its own path convention (Tovu's is `/api/admin/v1/*`) either accepts
these routes landing outside that convention, or wraps the whole `app` in a sub-router first (which
may not type-check cleanly against the `Express` parameter type).

None of the three deps shapes (`RunHttpDeps`, `AgentsHttpDeps`, `DelegatedToolsHttpDeps`) carry an
auth hook or middleware slot. A host with its own session-cookie auth has to apply
`app.use(exact-fixed-path, hostAuthMiddleware)` *before* calling the registrar — coupling the
host's auth wiring to Jini's internal path constants rather than a supported extension point.

**Suggested fix:** accept an optional `{ prefix?: string }` (or a pre-built `Router` instead of a
raw `Express`) so a host can namespace the mount point, and/or an optional
`{ requireAuth?: (req, res, next) => void }` deps field each registrar applies before its handler.

## 3. No way to learn who started a run inside `onStarted`/`RunStartHandler`

`RunStartContext` is `{request: RunCreateRequest, run: RunStatus, lifecycle: RunLifecycle}` — no
principal, no arbitrary host context. A host that authenticates via session middleware (not a
bearer token inside the request body) has no way to know *who* is starting this run from inside
the callback that's supposed to attach the driver.

**What we did instead:** an `AsyncLocalStorage<Principal>` bridge — a middleware mounted just
before `registerRunRoutes` captures the session-resolved principal into async-local context, and
`onStarted` (invoked later in the same request's async chain) reads it back out. It works, but it's
exactly the kind of thing a framework primitive should not force a consumer to build.

Same root cause shows up again in `DelegatedToolsHttpDeps.resolvePrincipal(request)` — it only
receives `{runId, toolUseId, toolId, input}`, so a host has to independently track `runId ->
principal` itself (we did this with a plain `Map`, populated in `onStarted`, cleaned up on
`lifecycle.waitForTerminal`).

**Suggested fix:** thread an opaque, host-supplied `context`/`principal` value through
`RunCreateRequest` -> `RunStartContext` -> (stored on the run) -> available to
`resolvePrincipal`/`onStarted` without the host having to invent its own out-of-band tracking. This
doesn't have to be `Principal` itself (keep the kernel identity-neutral) — even a passthrough
`unknown` field a host stamps and reads back would remove the AsyncLocalStorage requirement.

## 4. `RunCreateRequest` has no prompt/history field — every consumer reinvents the encoding

`{contextRef, agentId?, idempotencyKey?}` is the whole shape. `ai-control-plane.md` (Jini's own doc)
acknowledges this is provisional ("does not yet define a real prompt/history/runtime-profile
request"), and the reference playground (`examples/reference-web/src/daemon.ts`'s
`encodeRunContext`) base64-encodes an ad-hoc JSON blob into `contextRef` as a workaround. Tovu did
the same thing independently (`JSON.stringify({prompt})`, no base64 — simpler since it controls both
ends). Two independent consumers solving the identical problem two different ways is a signal this
belongs in the kernel, not each host.

**Suggested fix:** either a documented, shared `contextRef` encoding helper in `@jini-ai/protocol`
(so hosts don't reinvent it) or — better — an optional typed `prompt`/`history` field on
`RunCreateRequest` itself now that there are at least two real consumers (Jini's own playground,
Tovu) independently needing it.

## 5. `@jini-ai/mcp`'s bin script isn't reachable via `require.resolve()`

`createAgentExecutor`'s `mcpJsonInjection` option needs the absolute path to `jini-mcp`'s bin
script to hand to a spawned CLI. The obvious approach —
`require.resolve("@jini-ai/mcp/dist/bin/serve.js")` — throws `ERR_PACKAGE_PATH_NOT_EXPORTED`: the
package's `exports` map only declares `"."` (`./dist/index.js`); `bin` entries live outside that
map, so Node's strict subpath resolution rejects the direct path even though the file is really on
disk (reproduced against `@jini-ai/mcp@0.1.2`).

**Workaround that worked:** `require.resolve("@jini-ai/mcp")` (resolves the exported `.` entry),
then `path.join(path.dirname(entryPoint), "bin", "serve.js")` — a plain filesystem path, never
passed back through `require`/`import`, so the exports map never gets consulted a second time.

**Suggested fix:** add `"./dist/bin/serve.js"` (or a stable named subpath like `"./bin"`) to the
package's `exports` map, so `require.resolve("@jini-ai/mcp/bin")` (or similar) works directly
without a consumer needing to know this workaround exists.

## 6. Same-package ambient-type friction as before (node10 `moduleResolution`)

Not new — Tovu's `agent-runtime` integration already worked around this — but it now applies to
four more packages: `@jini-ai/core`, `@jini-ai/daemon`, `@jini-ai/http`, `@jini-ai/protocol` all
ship types only reachable through their `exports` map's `types` condition, which
`moduleResolution: "Node"` (node10 — still the default TS gives you and still common outside
bundler-based projects) ignores entirely. Every one of these needed a hand-written ambient `.d.ts`
re-declaring the exact surface used (~400 lines across the four packages combined for Tovu's
actual usage footprint). This is a real, recurring tax on any consumer not using `bundler`/`NodeNext`
resolution — CommonJS-targeting Node backends are not a niche case.

**Suggested fix:** ship a `main`/`types` fallback (even a thin one) alongside the `exports` map, so
consumers on node10 resolution get real types instead of `TS2307` — this is a one-line
`package.json` addition per package (`"types": "./dist/index.d.ts"`) that costs nothing for
`bundler`/`NodeNext` consumers and unblocks everyone else.

## 7. `chat-react` ships zero CSS and zero documented DOM structure

Confirmed again (Tovu's `Assistant.tsx` build from six months ago already found this — still true
at `chat-react@0.2.0`): every `jini-*` BEM class name has to be discovered by grepping compiled JS,
then styled from scratch. There's no reference stylesheet, no Storybook, no "here's the DOM tree"
doc. Two concrete traps we hit and had to reverse-engineer via `getComputedStyle`/DOM-walk, not
docs:

- `.jini-chat-pane__controls` wraps **both** the suggestions row and the composer as flex children
  in `flex-direction: row` by default (browser default, since the component sets `display:flex`
  with no direction) — a consumer styling it as a header-icon row (a very natural first guess) ends
  up placing suggestions and the composer side by side instead of stacked, squeezing the composer
  into a sliver.
- `.jini-chat-pane__drop-target` (`data-testid="chat-pane-file-drop-target"`, undocumented —
  it's the file-drag-drop wrapper the composer renders inside) is a flex child of `__controls` with
  no explicit width; without an explicit `flex: 1` a consumer has to discover and add themselves,
  it shrink-wraps to its content's intrinsic width instead of filling the row. In a full-width page
  layout this is invisible (there's enough slack that shrink-to-content and fill-available look the
  same); it only surfaces once the pane is docked into a narrower container (e.g. a 380px sidebar
  panel) — a genuinely mainstream use case for a chat pane, not an edge case.

**Suggested fix:** ship a minimal reference stylesheet (even an unopinionated one, meant to be
overridden) covering the structural flex/grid rules — direction, wrap, min-width:0 on shrinkable
children — separately from color/spacing theming. Structural CSS is not a theming decision a host
should have to reverse-engineer; visual theming is. At minimum, document the full class-name tree
and which elements are flex containers vs. flex items with which direction.

## 8. What worked well (don't lose these in a rewrite)

- **`@jini-ai/agent-runtime`'s registry + `resolveAgentLaunch` probing** was flawless out of the
  box — swapping Tovu's old hardcoded-Claude-only `listAgents()` for a loop over the full 24-def
  `AGENT_DEFS` array took ~15 lines and immediately reported real, accurate availability
  (`claude`/`codex`/`opencode` available, everything else correctly `available:false` with a
  diagnostic) on the dev machine it ran on, with zero per-CLI-vendor code from the consumer.
- **`createAgentExecutor` as a whole** — one function call replaced ~150 lines of hand-rolled
  `child_process.spawn` + stream-parsing Tovu had before (from an earlier, incomplete attempt at
  this same integration). Multi-agent dispatch, stream translation, cancellation, and failure
  classification all came for free.
- **`mcpJsonInjection` actually works end-to-end** — verified live: starting a run with `agentId:
  "claude"` produced a real spawned Claude Code CLI subprocess whose own reported `mcp_servers`
  list included the injected `"jini"` entry, confirming `.mcp.json` was written and auto-loaded
  correctly. (We could not verify a live tool *call* through that bridge — the sandboxed dev
  environment this integration ran in has no credentials for a *second*, independently-spawned
  Claude Code CLI process to authenticate with, an environment limitation, not a Jini defect. The
  execution boundary itself — `POST /api/delegated-tool-calls` -> `ToolExecutor` -> a real
  registered handler -> a real domain write -> a real returned record — was independently verified
  by calling it directly over HTTP, bypassing the CLI, and it worked correctly on the first
  attempt, including correctly *denying* a call made with an unrecognized `runId`.)
- **The `ToolRegistry`/`ToolExecutor` split (handlers never publicly retrievable) is exactly the
  right invariant** — it let Tovu keep its own `authorize()` call as the single evaluator inside
  each tool handler (no second policy layer to keep in sync) while still getting a real
  execution/audit boundary from the kernel. No friction here at all — this is the piece that most
  directly justified the "adopt the kernel" decision over hand-rolling one.
- **The chat-pane's runtime picker UI** (`ChatPaneRuntimeAccess` — `listAgents`/`rescanAgents`/
  `daemonOnline`) needed only three small async functions from the host and produced a genuinely
  polished agent picker (Local CLI vs. BYOK toggle, per-agent installed/diagnostic state, rescan
  button) with zero custom UI code.

## 9. Unresolved: `claude` CLI reports "Not logged in" when spawned via `AgentExecutor`'s default env

Not confirmed as a Jini bug — flagged here so whoever hits it next doesn't re-derive the repro
from scratch. `AgentExecutor`'s default env (`buildAgentEnv`'s `BASELINE_AGENT_ENV_KEYS`: `PATH`,
`HOME`, `USERPROFILE`, `TMPDIR`/`TEMP`/`TMP`, `SHELL`, `LANG`, `LC_ALL`, `LC_CTYPE`, plus Windows
keys) is **not sufficient** for a spawned `claude` CLI to find its own login state, even though
`HOME` (where `claude login`'s credentials would normally live) is in the allowlist. Reproduced
directly, twice, isolating the variable:

- A bare `claude -p "..."` and the *exact* stream-json invocation `claudeAgentDef.buildArgs`
  constructs, run via a plain shell pipe (full ambient env) — both succeed.
- The identical stream-json invocation, run via `node:child_process.spawn` with only
  `BASELINE_AGENT_ENV_KEYS` passed through (replicating `buildAgentEnv`'s exact filtering) —
  fails every time with `"Not logged in · Please run /login"`, `exit code 1`, in ~200-350ms (fails
  fast, before any real API attempt).
- The same restricted env plus every `CLAUDE_CODE_*`/`CLAUDECODE` variable added back — still
  fails. Ruled out: this is not about detecting a parent Claude Code session.
- The full, unfiltered `process.env` — succeeds.

A proper bisection (binary-search removing keys from the full set until the minimal necessary
addition is found) was started but not finished — an early attempt using `spawnSync` with the
`input` option gave a *different* (also-failing) result than the working `spawn` + manual
`stdin.write()`/`stdin.end()` pattern used everywhere else in this investigation, which needs
explaining before the bisection result can be trusted. Whoever picks this up: use `spawn` (not
`spawnSync`) for the harness, keep `PATH`/`HOME` fixed as a base, and binary-search the remainder
of a real `process.env` (candidates worth trying first, in this order: `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `SSH_AUTH_SOCK`, `USER`/`LOGNAME`).

Confirmed orthogonal to the process-topology fix in §1a/§1b above: the identical failure mode
reproduces before and after moving `AgentExecutor` into its own OS process, with an unrelated
change (adding `--session-id`/matching Tovu's real spawn args) making no difference either. This
is specifically about what `BASELINE_AGENT_ENV_KEYS` omits, not about which process does the
spawning.

## Open question for whoever picks this up

Item 1 (no embed-into-existing-host path) and item 1c (no selective route activation —
all-or-nothing) are the remaining highest-leverage fixes — genuinely missing supported integration
shapes, not small API gaps, and very likely not unique to Tovu (any non-Electron, non-desktop,
single-process product adopting Jini hits the same wall). Item 1a (the `ToolExecutor`/`RunLifecycle`
co-location requirement) shipped a fix this session — see its own section above — so it's now a
choice, not a blocker; worth re-evaluating whether that changes the urgency or shape of 1/1c's own
fixes (a remote-executor topology may want a different composition primitive than a
same-process one). Item 9 (the env-allowlist auth failure) is worth a fast follow if anyone can
spare 20 minutes with a real `claude login`'d machine to finish the bisection — it may be a one-line
fix to `BASELINE_AGENT_ENV_KEYS`.
