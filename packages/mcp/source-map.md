# `@jini/mcp` — provenance

Product-neutral Model Context Protocol (MCP) primitives extracted from Open
Design's daemon MCP "capability barrel"
(`apps/daemon/src/mcp/` on the `od-mcp-barrel` tree). The barrel was organized
as a `core/` kernel plus three concern subdirectories (`client/`,
`agent-install/`, `live-artifacts/`) behind a single root barrel.

This package ports the **generic** MCP concerns — the external-server config
schema/store, the daemon-side OAuth 2.1 / PKCE flow, the token store, the
install-payload builder, and the per-agent registration planner — plus the
handful of genuinely product-neutral runtime primitives that were embedded in
the otherwise OD-coupled `client/` server. All Open-Design identity strings
(`Open Design`, `OD_*`, `open-design`, `.od/…`, `opendesign.app`, `od mcp`,
`od://…`) were stripped. The package originally shipped with **zero runtime
dependencies** — node stdlib only (`node:fs`, `node:fs/promises`,
`node:crypto`, `node:path`, global `fetch`/`URL`/`Buffer`). A 2026-07-21
security-hardening pass (CR-006/CR-007, SEC-RB-001/002/011 —
`ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md`,
`ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`)
added `@jini/platform` (`assertSafePublicUrl` / `createValidatingLookup`,
mirroring `packages/deploy/src/reachability.ts`'s SSRF-safe fetch pattern)
and its `undici` peer as the package's first real dependencies, plus a new
internal `core/secure-write.ts` module (not part of the public barrel) that
every secret-bearing on-disk store (`config.ts`, `oauth.ts`, `tokens.ts`)
now writes through.

## File map

| Jini file | Origin (`apps/daemon/src/mcp/`) | Transform |
|---|---|---|
| `src/core/config.ts` | `core/config.ts` | Faithful lift of the `McpServerConfig`/`McpConfig` schema, sanitizers, atomic on-disk store (`read/writeMcpConfig`), loopback auth-mode inference, and the per-agent config builders (`buildClaudeMcpJson`, `buildAcpMcpServers`, `buildOpenCodeMcpConfigContent`). **Dropped** the `MCP_TEMPLATES` catalog and its `McpTemplate`/`McpTemplateField`/`McpTemplateCategory` types + the `templateId` field (design-tilted OD-product curation with brand-laden prose — analogous to `@jini/sqlite` dropping the OD-product "templates" table). De-branded comments; removed a dead IPv4-mapped-IPv6 loopback branch (unreachable — the WHATWG URL parser compresses `::ffff:127.0.0.1` before it reaches `isLoopbackHost`) and the dead stdio guard in `effectiveMcpAuthMode` (only ever called for http/sse). |
| `src/core/oauth.ts` | `core/oauth.ts` | Faithful lift of discovery (RFC 9728 → RFC 8414), Dynamic Client Registration (RFC 7591) + on-disk cache, PKCE/state helpers, authorize-URL builder, code/refresh token exchanges, `PendingAuthCache`, and `beginAuth`. De-brand: DCR `client_name` `'Open Design'` → `'Jini'`. Simplified the `PendingAuthCache` sweeper's defensive `typeof unref === 'function'` guard to a direct `this.timer.unref()` (dead in a node-only package). |
| `src/core/tokens.ts` | `core/tokens.ts` | Faithful lift, byte-for-byte (already brand-clean): 0600-guarded, atomic, per-`dataDir`-mutexed token store keyed by server id, with expiry checks. |
| `src/core/install-info.ts` | `core/install-info.ts` | Pure install-payload builder, **generalized** to carry no product identity: the data-dir env var name is now a required input (`dataDirEnvVar`, replacing the hardcoded `OD_DATA_DIR`), the MCP subcommand is an optional input (`subcommand`, default `'mcp'`), and the `buildHint` prose was neutralized ("CLI entry", "the daemon" — no "Open Design"). Behavior (sidecar vs direct args, `ELECTRON_RUN_AS_NODE`, web-base-url normalization) is unchanged. |
| `src/agent-install/install.ts` | `agent-install/install.ts` | Faithful lift of the agent-slug registry, the CLI/JSON/manual install-plan planners for 13 coding agents, and the pure JSON apply/remove primitives. Only comments/JSDoc were de-branded (`od mcp install` → `<cli> mcp install`, "Open Design's stdio MCP server" → neutral). Third-party agent product names (claude/codex/cursor/…) are kept as-is — they are not OD identity. |
| `src/client/client.ts` | `client/client.ts` (salvaged) | The bulk of `client/client.ts` — the `od mcp` stdio **server** proxy — was **dropped** (see below). Ported only the product-neutral, dependency-free primitives: `createMcpIdleExitController` (renamed from the `_`-prefixed test seam `_createMcpIdleExitController`), `extractRelativeRefs` (+ its HTML/CSS/JS/srcset patterns and `isHtmlLike`/`isCssLike`/`isJsLike` helpers), and `isTextualMime` (+ `TEXTUAL_MIME_PATTERNS`). Removed a provably-dead `if (disposed) return` guard inside the idle timer callback and the dead `m[1] || ''` regex fallbacks (required capture groups are always present). |
| `src/core/index.ts`, `src/client/index.ts`, `src/agent-install/index.ts` | corresponding `*/index.ts` barrels | Sub-barrels (`export *`). |
| `src/index.ts` | `index.ts` | Root barrel — explicit named re-exports of the ported public surface (the dropped/OD-coupled exports removed). |

## What was dropped (and why)

- **`live-artifacts/` (entire subdir)** — the OD per-run "live artifacts" MCP
  tool surface. An OD-product feature, out of scope per the port brief.
- **The `od mcp` stdio server** in `client/client.ts` — `runMcpStdio`,
  `TOOL_DEFS`, `handleMcpToolCall`, and every tool handler (`get_artifact`,
  `create_project`, `start_run`, project/active-context resolution, studio deep
  links, run polling, …). This is not a generic MCP client: it is an
  OD-product MCP **server** hardwired to Open Design's REST API
  (`/api/projects`, `/api/skills`, `/api/design-systems`, `/api/runs`, …) and
  concepts (design systems, skills, plugins, artifacts, runs, studio, the
  `od://` resource scheme). It also imports the OD-only `@open-design/contracts`
  package (`buildProjectRawFileUrl`), the OD daemon-internal
  `../../artifacts/create.js`, and the `@modelcontextprotocol/sdk` — none of
  which exist in this repo. Faithfully porting it would mean importing OD
  product surface, so it was dropped and only its generic primitives salvaged.
- **`MCP_TEMPLATES` catalog + template types + `templateId`** in `config.ts` —
  a large, design-tool-tilted curated catalog of third-party MCP servers with
  OD marketing prose. Zero functional coupling; dropped for neutrality (same
  rationale `@jini/sqlite` used to drop the OD "templates" table).

## External dependencies

`@modelcontextprotocol/sdk` and `@open-design/contracts` were needed only by
the dropped OD server proxy and were never ported. As of the 2026-07-21
security-hardening pass, the package depends on `@jini/platform` (workspace)
and `undici` — added specifically to close SEC-RB-001/CR-005 (MCP OAuth
discovery/DCR/token-exchange SSRF) by reusing `@jini/platform`'s
`assertSafePublicUrl` + connection-time `createValidatingLookup` guard,
the same pattern `packages/deploy/src/reachability.ts` established first.
Everything else still runs on node stdlib + web globals.

## Tests & coverage

Colocated `*.test.ts` (house style), node environment. `pnpm --filter @jini/mcp
exec vitest run --coverage` reports **100 / 100 / 100 / 100**
(statements / branches / functions / lines) across all `src/**` files with real
statements; the four barrel files re-export only and are covered via
`src/index.test.ts`. Reaching 100% branch coverage required removing several
provably-unreachable defensive branches (noted per-file above); each removal is
a behavioral no-op through the module's public entry points.

## 2026-07-21 addition — `server/` — the generic MCP tool-hosting mechanism + a first real tool set

Ported the **mechanism**, not the tool surface, of Open Design's real stdio MCP
server: `apps/daemon/src/mcp.ts` on
`leonaburime-ucla/open-design@refactor/web-memory-slice` (1858 lines, read in
full — cloned locally as `lucla/refactor-web-memory-slice`). That file is
`od mcp`: a **stateless** stdio server built on the official
`@modelcontextprotocol/sdk` (`Server`, `StdioServerTransport`,
`ListToolsRequestSchema`, `CallToolRequestSchema`, plus
`ListResourcesRequestSchema`/`ReadResourceRequestSchema`, not ported — see
below) that holds no state and touches no filesystem: every tool call resolves
to a `fetch()` against the daemon's own HTTP API. `@modelcontextprotocol/sdk`
(`^1.29.0`, matching the origin's pinned `1.29.0`) is a new dependency of this
package — the origin's `client/client.ts` port (2026-07-19, see the file-map
table above) had explicitly dropped `runMcpStdio` and the whole SDK dependency
because faithfully porting the server would have meant importing OD's project/
file/artifact/skill/plugin product model. This pass builds the same *hosting
mechanism* the origin used, generalized to take a caller-supplied, bounded
tool list instead of hardcoding OD's 18 tools, and wires up the first 5 tools
that map to real, already-built Jini kernel primitives.

### File map

| Jini file | Origin (`apps/daemon/src/mcp.ts`) | Transform |
|---|---|---|
| `src/server/daemon-client.ts` | `getJson` (1468-1475), `postJson` (964-974), `formatDaemonError` (950-962), `formatError` (1843-1851), `safeText` (1835-1841) | **Generalized + hardened, not a faithful lift.** OD's versions are bare `fetch()` calls with no timeout, no response-size cap, and no redaction of daemon-supplied error text. Rebuilt as `getDaemonJson`/`postDaemonJson`, adding the same bounded-timeout / response-size-cap / redaction posture `packages/cli/src/http.ts` established for its own daemon fetch (CR-004/SEC-RB-009) — see "Design decision" below for why this isn't literally `@jini/cli`'s `getJsonFromDaemon`/`postJsonToDaemon`. |
| `src/server/tool-protocol.ts` | `ok` (735-739), `errorResult` (741-743), `requireString` (745-749), the `handleMcpToolCall` switch's dispatch shape (751-879) | **Generalized.** OD's `handleMcpToolCall` is one large `switch (name)` hardcoding all 18 tool names inline. Replaced with a data-driven `McpToolDef[]` + `Map`-based dispatch (`buildToolIndex`, `handleToolCall`) so a caller registers tools instead of this module hardcoding them — the actual mechanism generalization the task called for. `ok`/`errorResult` ported near-verbatim as `okResult`/`errorResult`; `requireString` ported verbatim. |
| `src/server/tool-server.ts` | `runMcpStdio` (499-733), `_createMcpIdleExitController` wiring (`withMcpActivity`, 506-509), `SERVER_NAME`/`SERVER_VERSION`/`MCP_STDIO_IDLE_EXIT_MS` (26-28) | **Generalized.** `createMcpToolServer({name, version, tools, resolveBaseUrl, ...})` reproduces `runMcpStdio`'s exact lifecycle — construct `Server`, register `ListToolsRequestSchema`/`CallToolRequestSchema` handlers wrapped in idle-activity tracking (reusing `../client/client.js`'s already-ported `createMcpIdleExitController`, not a new copy), connect `StdioServerTransport`, wrap `transport.onmessage`/`onclose` to note activity / dedupe close, hold the process open until stdin EOF — with OD's hardcoded server name/version/instructions and 18-tool `TOOL_DEFS` replaced by caller input. Only `capabilities: {tools: {}}` is advertised; OD's `capabilities: {tools: {}, resources: {}}` is not, since no resource in this port's tool set needs one (see "What was excluded" below). |
| `src/server/tools/run-tools.ts` | `TOOL_DEFS` entries for `start_run` (416-453), `get_run` (454-467), `cancel_run` (468-480), `get_active_context` (160-166), `list_agents` (481-496); handler bodies `startRun` (1074-1106), `getRun` (1117-1159), the inline `cancel_run`/`get_active_context` cases (864-872, 756-765), `listAgents` (1034-1057) | **Re-scoped to Jini's actual routes, not a faithful lift** — see per-tool mapping below. |

### Per-tool mapping (origin -> Jini route)

- **`start_run`**: OD posts `{projectId, message, skillId, pluginId, agentId, model, pluginInputs}` to `/api/runs`. Jini's kernel has none of `project`/`skill`/`plugin` (extraction-plan §2.1: only `Run`/`Agent`/`Tool`/`EventLog`/`Principal`), so the tool takes exactly `RunHttpDeps`'s real `RunCreateRequest` shape instead: `{contextRef (required), agentId?, idempotencyKey?}` → `POST /api/runs` (`packages/http/src/runs.ts`'s `runStartRoute`). OD's studio-URL-building, skill/plugin-inputs handling, and "Open Design spawns its own agent" prose are all dropped — none of it maps to anything in the kernel.
- **`get_run`**: `GET /api/runs/:runId` (`runStatusRoute`), one-to-one — OD's version additionally builds a `previewUrl`/`agentMessage`/`studioUrl` by cross-calling `/api/projects/:id`, `/api/runs/:id/events`, and `/api/mcp/install-info`; none of those routes exist in Jini (no project store, no SSE-transcript reassembly route, no web-base-url install-info route), so this tool is a direct, unenriched proxy of `{run}`.
- **`cancel_run`**: `POST /api/runs/:runId/cancel` (`runCancelRoute`), with an optional `reason` field Jini's route accepts and OD's did not.
- **`get_active_context`**: `GET /api/active` (`packages/http/src/active-context.ts`'s `getActiveRoute`, ported 2026-07-21 the same day, one commit prior). Field names deliberately differ from OD's `{active, projectId, projectName, fileName, ageMs}`: Jini's generic channel is `{active, resourceRef, resourceName, detail, ts, ageMs}` (no "project"/"file" noun — see that file's own module doc). The tool adds an `{active:false, hint}` shape when the daemon reports inactive, mirroring OD's own hint-on-inactive UX but in generic language (no "Open Design", a stated 5-minute TTL matching `ACTIVE_CONTEXT_TTL_MS`).
- **`list_agents`**: see "The `list_agents` decision" below.

### The `list_agents` decision

Investigated before building anything, per the task brief. `@jini/agent-runtime`'s
barrel (`packages/agent-runtime/src/index.ts` → `export * from './registry.js'`)
already exports `AGENT_DEFS: RuntimeAgentDef[]` — the exact static, in-memory
list of every registered agent def (`registry.ts`'s `BASE_AGENT_DEFS`, 24
entries). `RuntimeAgentDef` has plain `id`/`name` fields (plus a large surface
of CLI-spawn internals: `bin`, `buildArgs`, `env`, `listModels`, etc. — no
`available`/live-detection field at all). No HTTP projection of this list
existed anywhere in `packages/http/src/*.ts` before this pass. Building
`GET /api/agents` returning `{agents: [{id, name}]}` needed no design judgment
call beyond "project the two safe fields" — no timeout/caching/probing
decisions, unlike OD's own `list_agents` (`listAgents`, mcp.ts:1034-1057),
which filters on a *live-detected* `available: boolean` field (OD's
`/api/agents` route actually probes each agent binary for installation/version
at request time — a real design decision this pass deliberately did not need
to make, since Jini has no such probing route or field to project). So it was
built: `packages/http/src/agents.ts`'s `agentListRoute` (`GET /api/agents`,
`AgentsHttpDeps.listAgents: () => readonly {id, name}[]` injected — DI,
matching `daemon-status.ts`/`active-context.ts`'s convention, so `@jini/http`
does not take on a new `@jini/agent-runtime` package dependency for a
two-field projection) plus `@jini/mcp`'s `list_agents` tool
(`server/tools/run-tools.ts`) proxying it. OD's `includeUnavailable` flag and
per-agent `installUrl`/`modelsCount` enrichment were **not** ported — those
exist only because OD's route does live probing, which this pass's route does
not attempt.

### What was explicitly excluded (and why)

Per the task brief, only the mechanism plus tools mapping to real kernel
primitives were ported. The other 13 of OD's 18 `TOOL_DEFS` were **not**
ported — all are OD's project/file/artifact/skill/plugin model, none of which
exists in the Jini kernel (extraction-plan §2.1's "no Project, Conversation,
Brand, DesignSystem, Plugin/marketplace, or Automation noun" holds here
exactly as it did for `@jini/cli`'s own `mcp` row):
`list_projects`, `get_artifact`, `get_project`, `get_file`, `search_files`,
`list_files`, `create_artifact`, `write_file`, `delete_file`, `delete_project`,
`create_project`, `list_skills`, `list_plugins`. Also not ported: the
`ListResourcesRequestSchema`/`ReadResourceRequestSchema` resource surface
(`od://focus/active`, `od://skills/...`, `od://design-systems/...` — resources
require a skill/design-system store this kernel doesn't have), the studio
deep-link builder (`buildStudioUrl`, `getDefaultConversationId`,
`getWebBaseUrl`), the project-name-resolution cache (`resolveProjectId`,
`fetchProjectList`, `resolveProjectArg`), and the SSE-transcript reassembly
(`fetchRunAgentMessage`) — every one of these exists only in service of a
dropped tool.

### Design decision: the hosting-mechanism shape

`createMcpToolServer({name, version, tools, resolveBaseUrl, instructions?,
idleMs?, fetchImpl?, stdin?, stdout?, createServer?, createTransport?})`
returns `{run(): Promise<void>}`. Construction (tool-name-uniqueness
validation via `buildToolIndex`) is synchronous and side-effect-free; all I/O
— resolving the daemon URL, connecting the transport, serving requests —
happens in `run()`. This is genuinely new kernel-adjacent surface (a new
package capability, not a file port), justified per extraction-plan §7's
two-consumer rule by the user's explicit request plus the stated expectation
that Tovu/Zana/Open-Marketing will each want their own product-specific MCP
server built on the same hosting mechanism later — so the mechanism accepts
an arbitrary, caller-registered `McpToolDef[]`, not the 3-5 tools this pass
ships as its first real, working example.

`McpServerLike`/`McpTransportLike` (in `tool-server.ts`) are narrow structural
interfaces covering only what this module calls on a `Server` instance
(`setRequestHandler`, `connect`) and a transport (`onmessage`, `onclose`,
`close`) — not literal re-exports of the SDK's own types, which can't be
satisfied by a plain object (the SDK's `Server` class has private fields, so
it's nominally, not structurally, typed). The default `createServer`/
`createTransport` factories construct the real SDK classes and cast through
`unknown` to these narrower interfaces (the same `as unknown as X` pattern
`core/oauth.ts` already uses to bridge undici's types); a caller may override
either factory to inject a test double. This is what makes `run()`'s full
orchestration — activity wrapping, message/close composition, the stdin-close
race, idle-triggered shutdown — deterministically unit-testable without a
real subprocess or real timers (see `tool-server.test.ts`), while one
dedicated test (`'wires the real @modelcontextprotocol/sdk Server +
StdioServerTransport when no factories are injected'`) still exercises the
true default path end-to-end with real `node:stream` `PassThrough` streams,
proving the DI seam isn't hiding a real-SDK integration bug.

**Why `daemon-client.ts` is not `@jini/cli`'s `getJsonFromDaemon`/
`postJsonToDaemon`.** The architectural brief called for reusing
`@jini/cli`'s already-hardened daemon-fetch helpers "the way
`packages/cli/src/run-command.ts` already does." Checked directly: those two
functions map every failure — network-unreachable, non-2xx, oversized
response — onto `process.exit()` (via `exitWithStructuredError`), which is
correct for a one-shot CLI invocation but fatal for a long-lived stdio MCP
server, where a single failed tool call must return an `{isError:true}` MCP
result and the process must keep serving the next call. Routing around this
by injecting an `exit` callback that throws instead of exiting was considered
and rejected: it would require also capturing/re-parsing whatever
`postJsonToDaemon` had already written through its `write` callback to
reconstruct an error message, which is more convoluted than porting OD's own
already-throw-based `getJson`/`postJson` mechanism with the same bounded-I/O
hardening added. What **is** reused directly from `@jini/cli` (both pure,
non-`process.exit` functions): `sanitizeUntrustedText` (redacts daemon-
supplied error text before it reaches an MCP result) and, per the
architecture note about `daemon-url.ts`, `resolveDaemonUrl`/
`sanitizeDaemonUrlForDisplay` are available for a caller's `resolveBaseUrl`
implementation to use directly (this package does not re-wrap them — a
caller passes `() => resolveDaemonUrl({...})` straight into
`createMcpToolServer`'s `resolveBaseUrl` option; no `packages/mcp`-local
daemon-URL-resolution equivalent was built, since one already exists and nothing
about MCP's use case differs from a CLI command's). This cross-import
(`@jini/mcp` -> `@jini/cli`) is allowed by `scripts/check-engine-boundaries.ts`'s
R7 rule: R7 only restricts a **locked** package (the extraction-plan §3
fourteen) importing an **unlocked** one below `"stable"` status; `@jini/mcp`
is itself unlocked (`UNLOCKED.md`), so it importing the locked, stable
`@jini/cli` package is unrestricted. Confirmed via `pnpm guard` after wiring
the dependency (see below) — zero violations.

No SSRF hardening (`assertSafePublicUrl`/`createValidatingLookup`, the
pattern `core/oauth.ts` uses for its own outbound fetches) was added to
`daemon-client.ts` — deliberately: `assertSafePublicUrl` actively *rejects*
loopback/private addresses, which is exactly where a real daemon lives. The
daemon URL here is a caller-resolved, typically-loopback target the user
already trusts enough to run (the same trust boundary `@jini/cli/http.ts`
already accepts for the identical "fetch my own daemon" concern), not an
attacker- or remote-metadata-controlled URL the way an external MCP server's
OAuth endpoints are.

### New dependency

`@modelcontextprotocol/sdk` (`^1.29.0`) — needed by `tool-server.ts` for the
real `Server`/`StdioServerTransport`/schema constants; `@jini/cli`
(`workspace:*`) — needed for `sanitizeUntrustedText` (redaction) and to make
`resolveDaemonUrl`/`sanitizeDaemonUrlForDisplay` available to a caller's
`resolveBaseUrl`, per the design decision above. `@jini/platform` and
`undici` (from the 2026-07-21 SSRF-hardening pass) are unchanged.

### Tests & coverage

Colocated `*.test.ts`. `pnpm --dir packages/mcp exec vitest run --coverage`:
every file under `src/server/**` (`daemon-client.ts`, `tool-protocol.ts`,
`tool-server.ts`, `tools/run-tools.ts`) is genuinely **100 / 100 / 100 / 100**
(statements / branches / functions / lines) — enforced as its own glob-scoped
threshold set in the new `packages/mcp/vitest.config.ts` (this package had no
committed coverage gate before this pass). The package-wide aggregate the same
config reports is 99.73/99.07/100/99.73, not a literal 100 — the one
remaining gap is `core/oauth.ts` (95.59% branches), which predates this pass
and was not touched by it; the global threshold is set with a small safety
margin below the measured aggregate (matching `packages/http/vitest.config.ts`'s
identical convention) rather than either lowering the bar for the files this
pass is responsible for or silently re-verifying a file outside its scope.
`tool-server.test.ts` mocks `../client/client.js`'s `createMcpIdleExitController`
(itself already exhaustively tested in `client/__tests__/client.test.ts`) so
every test triggers "went idle" deterministically instead of racing real
timers; `McpServerLike`/`McpTransportLike` fakes plus the DI seams above cover
the full `run()` orchestration (activity wrapping, message/close composition,
duplicate-close dedup, a rejecting `transport.close()` on both the idle and
stdin-close paths, the `process.stdin` default via a `vi.spyOn(process,
'stdin', 'get')` stub) without a real subprocess.

## 2026-07-21 (second pass) — the 13 excluded tools + the resource surface, re-audited; `jini://active` resource shipped

The 2026-07-21 addition above (`server/`) ported the hosting mechanism plus 5
tools and stated, without a per-tool breakdown, that OD's other 13 `TOOL_DEFS`
plus its `ListResourcesRequestSchema`/`ReadResourceRequestSchema` resource
surface were excluded because they are OD's project/file/artifact/skill/
plugin model. This pass re-investigated that conclusion tool-by-tool instead
of re-asserting it, per an explicit task brief to not trust a prior
exclusion without checking it — same standard the run/chat-orchestration
work's own gap-2 finding was held to.

### Methodology

Re-read `apps/daemon/src/mcp.ts` in full (1858 lines, matches the line count
the prior pass recorded) on a local `leonaburime-ucla/open-design` checkout
(`main`, which carries the identical file — confirmed byte-identical in
substance to the `refactor/web-memory-slice` branch the prior pass cited for
this same file). For each of the 13 excluded tools, checked whether a real,
already-built, already-wired kernel or `@jini/http` primitive exists to
proxy — not whether one *could* be built. Concretely checked and ruled out
as false leads:

- **Every current `@jini/http` route** (`active-context.ts`, `agents.ts`,
  `daemon-status.ts`, `host-tools.ts`, `runs.ts` — every `defineJsonRoute`
  export in the package, confirmed by grep): no file/project/skill/plugin
  route of any kind exists to proxy.
- **`@jini/core`'s `ToolRegistry`** (`tool-registry.ts`): a genuinely empty,
  append-only registry with zero built-in tool defs. There is no
  pre-registered "read a file" / "list a workspace" tool anywhere in the
  kernel for an MCP tool to proxy — `ToolRegistry` is pure registration
  machinery a *product* populates at composition time, and no product does
  so in this repo today.
- **`@jini/platform`'s `blob-storage.ts`** (`BlobStorage` /
  `LocalBlobStorage` / `S3BlobStorage`): a genuinely product-neutral
  `readFile`/`writeFile`/`listFiles`/`deleteFile`/`statFile` port keyed by an
  opaque `namespace` (its own module doc: "a tenant id, a workspace id, a
  project id, whatever the host application scopes storage by... this module
  carries no domain meaning for what a namespace *is*"). This is the closest
  thing in the repo to a generic file-tool primitive — but it has exactly one
  consumer today, `packages/capability-providers/src/storage.ts`, which is
  itself greenfield/speculative with "no current consumer" per its own
  source-map. No `@jini/http` route, no `ToolRegistry` entry, and no
  daemon-level "workspace root" concept wires `BlobStorage` to anything an
  MCP client could call. Real primitive, zero live wiring — see the proposal
  doc below.
- **`@jini/registry`** (pluggable content-registry backends) and
  **`@jini/memory`** (frontmatter note-store): checked as possible stand-ins
  for `list_skills`/`list_plugins`. Neither is wired to any HTTP route or
  `ToolRegistry` entry, and neither's data model actually matches "a curated
  recipe/workflow a caller passes to `start_run`" — registry entries are
  versioned publishable content, memory notes are extracted facts. Treating
  either as a skills/plugins stand-in would be inventing product semantics
  under the guise of a port, exactly what the task brief's hard boundary
  prohibits.

### Verdict, all 13 tools

| OD tool | Verdict | Why |
|---|---|---|
| `list_projects` | **Excluded** (confirmed, unchanged) | `Project` noun; `GET /api/projects` has no Jini analog. |
| `get_project` | **Excluded** (confirmed, unchanged) | `Project` noun plus OD-specific `previewUrl`/`studioUrl`/`resolvedDir` derivation. |
| `delete_project` | **Excluded** (confirmed, unchanged) | `Project` noun; irreversible-delete is product policy layered on a noun the kernel doesn't have. |
| `create_project` | **Excluded** (confirmed, unchanged) | `Project` + `DesignSystem` + `Skill` nouns (`designSystemId`/`skillId` body fields). |
| `list_skills` | **Excluded** (confirmed, unchanged) | `Skill` noun (`GET /api/skills`); no real stand-in found (see `@jini/registry`/`@jini/memory` above). |
| `list_plugins` | **Excluded** (confirmed, unchanged) | `Plugin` noun (`GET /api/plugins`, manifest/marketplace fields, `od.taskKind`). |
| `create_artifact` | **Excluded** (confirmed, unchanged) | `Artifact`/`ArtifactManifest` noun — HTML/Markdown/SVG manifest inference is OD rendering-pipeline product policy, not plain file I/O. |
| `get_file` | **Excluded — structurally significant open question, see proposal doc** | Needs a project-scoped (or, generalized, workspace-scoped) file store; `@jini/platform`'s `BlobStorage` is the closest kernel-adjacent primitive but is unwired to anything callable today. |
| `list_files` | **Excluded — same open question, see proposal doc** | Same file-store gap as `get_file`. |
| `search_files` | **Excluded — same open question, see proposal doc** | Same file-store gap, plus its own substring-search-across-files semantics have no kernel equivalent either way. |
| `write_file` | **Excluded — same open question, see proposal doc** | The closest of the six to "plain file write" (no manifest, tolerates existing targets) — still resolves against a project's on-disk root, which doesn't exist as a kernel concept. |
| `delete_file` | **Excluded — same open question, see proposal doc** | Same file-store gap as `write_file`. |
| `get_artifact` | **Excluded — same open question, see proposal doc** | Its BFS reference-following algorithm was already ported as pure, dependency-free primitives on 2026-07-19 (`extractRelativeRefs`/`isTextualMime` in `client/client.ts`); what's missing is the per-file fetch loop underneath it, which needs the same file-store primitive as the rest of this cluster. |

Twelve of the 13 are unambiguous — they name a product noun
(`Project`/`DesignSystem`/`Skill`/`Plugin`/`Artifact`) the kernel
deliberately does not have, matching extraction-plan.md §2.1 exactly. The
remaining six (`get_file`/`list_files`/`search_files`/`write_file`/
`delete_file`/`get_artifact`) are different in kind: none of them *name* a
product noun on their face — "read a file at a path," "list files," "write a
file" are generic operations a great many future Jini consumers will want —
but every one of them needs to resolve "which files" against *something*,
and the only "something" available today (a `Project`'s daemon-managed
on-disk directory) is exactly the product noun the kernel excludes. Building
a generic replacement (a host-injected "workspace root" file-store primitive)
is plausible and even foreseeable, but it is a real design decision — path-
traversal/sandboxing model, single-root vs. multi-tenant addressing, how a
host injects the root, whether `@jini/platform`'s `BlobStorage` is the right
foundation — not a mechanical port of something that already exists and
works. Per the task brief's explicit instruction ("do NOT invent a `Project`
or `DesignSystem` noun in the kernel to force a port" / "if it would require
a new kernel noun... write a proposal doc"), this was left excluded and
written up rather than improvised: see
`ADS-memory/reports/proposals/PROP-mcp-tool-surface-file-tools-2026-07-21.md`.

### Resource surface, re-audited

- **`od://focus/active`** — **Ported** this pass, as `jini://active`. See
  below.
- **`od://skills/<id>/SKILL.md`** — **Excluded** (confirmed, unchanged):
  `Skill` noun.
- **`od://design-systems/<id>/DESIGN.md`** — **Excluded** (confirmed,
  unchanged): `DesignSystem` noun.

The active-context resource is a genuine finding, not a re-confirmation: OD's
origin exposes the *identical* `/api/active` payload two different ways —
as the `get_active_context` **tool** (already ported in the prior pass) and
as the `od://focus/active` **resource** — because MCP tools and resources
serve different client affordances (a tool is invoked by the model
mid-conversation; a resource can be listed and attached to context by the
user/client without any tool call). Since `/api/active`
(`packages/http/src/active-context.ts`'s `getActiveRoute`) is already a real,
ported, product-neutral kernel primitive, exposing its *second* OD-native
affordance costs nothing product-shaped — it needed the tool-hosting
mechanism to grow resource support (which OD's single `mcp.ts` file always
had, just not yet ported), not a new kernel noun.

### What shipped: generic MCP resource support + `jini://active`

| Jini file | What it is | Origin equivalent |
|---|---|---|
| `src/server/resource-protocol.ts` | New. The resource-side mirror of `tool-protocol.ts`: `McpResourceDef` (`uri`/`name`/`description?`/`mimeType?`/`read`), `resourcesToList` (`resources/list` projection), `buildResourceIndex` (uri-uniqueness, throws at construction time like `buildToolIndex`), `handleResourceRead` (`resources/read` dispatch). | `ListResourcesRequestSchema`/`ReadResourceRequestSchema` handler bodies (mcp.ts:613-685), generalized from OD's hardcoded 3-branch `if`/regex dispatch to the same data-driven `Map`-based shape `tool-protocol.ts` already established for tools. |
| `src/server/resources/active-resource.ts` | New. The one concrete resource this package ships: `activeContextResource` (`uri: 'jini://active'`) proxying `GET /api/active` via `../daemon-client.js`, plus the `KERNEL_RESOURCES` array `createMcpToolServer`'s `resources` option expects. | The `od://focus/active` branch of `ReadResourceRequestSchema` (mcp.ts:647-658) and its `ListResourcesRequestSchema` entry (mcp.ts:618-625) — both collapsed into one resource def, matching how `run-tools.ts` collapsed each `TOOL_DEFS` entry + its `handleMcpToolCall` case into one `McpToolDef`. |
| `src/server/tool-server.ts` | Extended, not rewritten. `McpToolServerOptions` gained an optional `resources?: readonly McpResourceDef[]`. `capabilities` now advertises `resources: {}` (alongside the unconditional `tools: {}`) only when at least one resource is supplied, and `ListResourcesRequestSchema`/`ReadResourceRequestSchema` handlers are registered (wrapped in the same `withActivity` idle-tracking wrapper tools already use) only in that case — a caller passing no `resources` gets byte-identical behavior to before this pass (`capabilities: {tools: {}}`, no resource handlers registered at all, proven by a dedicated test). `McpServerLike`'s structural interface gained the two matching `setRequestHandler` overloads. | `runMcpStdio`'s `capabilities: {tools: {}, resources: {}}` (mcp.ts:514, unconditional in the origin since it always has both), generalized to be conditional since this port's tool-only callers shouldn't falsely advertise a resources capability they don't use. |

Two behavioral differences from the OD origin, both deliberate:

- **Naming.** OD's `od://` URI scheme is product-identity-tainted (this
  repo's own `scripts/check-engine-boundaries.ts` R5 rule bans the literal
  string `od://` anywhere in `packages/@jini/**`, including test fixtures —
  confirmed by running `pnpm guard` against an early draft of this pass's
  tests that used it verbatim and getting `R5-neutrality` violations). The
  new resource uses `jini://active` instead — this package's own name, no
  product tilt.
- **No inactive-state hint.** `getActiveContextTool` (the tool) adds a
  conversational `{active:false, hint:"..."}` shape when the daemon reports
  no active resource, because a tool result is meant to guide a model's next
  action. `activeContextResource` (the resource) does not — it returns the
  raw `/api/active` payload unchanged either way, matching OD's own
  `od://focus/active` handler, which likewise never special-cased
  `active:false` (mcp.ts:645-658) — a resource is attachable context data,
  not a conversational nudge.

Authorization posture is unchanged from every existing tool in this package:
no new gate was added. Whatever `@jini/http`'s same-origin guard /
bearer-auth middleware already enforces on `GET /api/active` is the only
check a resource read passes through — identical to `getActiveContextTool`'s
own posture.

### Tests & coverage

New/extended test files: `src/server/__tests__/resource-protocol.test.ts`
(14 tests — `resourcesToList`, `buildResourceIndex` including its duplicate-
uri throw, `handleResourceRead`'s success/unknown-uri/error/sanitization/
mimeType-precedence paths), `src/server/resources/__tests__/
active-resource.test.ts` (6 tests — the resource's own success/inactive/
daemon-unreachable-propagation paths plus one full `handleResourceRead`
end-to-end wiring test), and additions to `src/server/__tests__/
tool-server.test.ts` (6 new tests: duplicate-resource-uri throws at
construction, capabilities/handler-registration is unchanged when
`resources` is omitted *and* when it's an explicit empty array, capabilities
gain `resources: {}` and both handlers wire through `resources/list` and
`resources/read` when at least one resource is supplied, and an explicit
adversarial-input case — `resources/read` on an unregistered uri rejects the
handler's promise rather than resolving with any content, since unlike
`tools/call` there is no `{isError:true}` content shape for a resource
failure). `src/__tests__/index.test.ts`'s public-barrel completeness check
was also extended to assert every `server/` export (both the tool-hosting
surface added in the prior pass and this pass's resource surface) is
actually reachable from `@jini/mcp`'s root barrel — the prior pass's version
of this test checked only `core`/`client`/`agent-install` and would not have
caught a broken `server/` re-export.

`pnpm --dir packages/mcp exec vitest run --coverage`: **280 tests pass, 0
failures.** Every file this pass touched or added
(`resource-protocol.ts`, `resources/active-resource.ts`, and
`tool-server.ts`'s extended surface) is genuine **100/100/100/100**
(statements/branches/functions/lines), covered by the package's existing
`'src/server/**'` glob-scoped 100% threshold in `vitest.config.ts` (no
threshold change needed for that glob — the new files simply fall under a
pattern that already applied). Package-wide aggregate is
**100/99.74/100/100** — the only remaining gap is the pre-existing,
untouched `core/oauth.ts` (98.77% branches as of the same-day `cf20726dc`
coverage pass, itself already past this pass's start). Root-level thresholds
in `vitest.config.ts` were tightened from the prior pass's
99.5/98.8/100/99.5 to **100/99.4/100/100** to reflect the now-literal-100
statements/functions/lines aggregate, with branches kept at a small safety
margin (99.4) below the measured 99.74 — same "safety margin below measured,
not lowering the bar" convention `packages/http/vitest.config.ts` and the
prior pass both already used.

`pnpm --dir packages/mcp exec tsc --noEmit`: clean. `pnpm guard`: clean (one
intermediate failure during this pass — draft tests using the literal string
`od://...` to assert an *unsupported* scheme tripped the R5-neutrality
check; fixed by using a synthetic `legacy-scheme://...` placeholder instead,
which exercises the identical "unregistered uri rejects" code path without
any product-identity string).

## 2026-07-22 — verifying (not re-doing) the spike commit's open items: `serve.ts`'s `isMainModule` coverage, plus the gap-3-part-2 spawn wiring it depends on

The `2a081c5` "MCP-callback spike items 1-3" commit shipped `src/bin/serve.ts`,
`src/server/tools/delegated-tool.ts`, and the module top-level entrypoint-guard test block for
`serve.ts`'s `isMainModule` check, but its own commit message flagged that block as **added but
never run**: *"local test/coverage/guard runs were halted mid-task ... NOT been run."* This pass
personally re-ran it rather than trusting that note either way (it could have been wrong in either
direction — the fix might not have actually worked, or might have). `pnpm --dir packages/mcp exec
vitest run --coverage`: **300/300 tests pass**, `bin/serve.ts` **100/100/100/100**
(statements/branches/functions/lines) — the module-reimport guard block (mirroring
`packages/cli/src/__tests__/main.test.ts`'s identical pattern for `main.ts`'s own guard) does
close the gap the spike commit left open. Package-wide aggregate: **100/99.75/100/100** — the only
remaining sub-100% file is `core/oauth.ts` (98.77% branches, lines 190/240), pre-existing and
untouched by this task or the spike before it (already noted in this file's prior dated section).
`pnpm --dir packages/mcp exec tsc --noEmit`: clean.

**Item 4 of that same spike** (the actual spawn-time `.mcp.json` injection that makes `serve.ts`
and `delegated-tool.ts` reachable from a real `claude` run at all) landed this pass in
`packages/daemon/src/agent-executor.ts` — see that package's own 2026-07-22 dated entry for the
full design. This package's own files needed no code change for that: `serve.ts` already read
`JINI_RUN_ID`/`JINI_DAEMON_URL` from its environment exactly as the daemon-side injection now sets
them, and `createExecuteDelegatedToolTool` already posted to `packages/http/src/delegated-tools.ts`
exactly as designed — the wiring gap was entirely on the daemon's spawn side, not here.

## 2026-07-22 addition — genuine 100% coverage: oauth.ts:190,240 closed for real (audit fix)

**`oauth.ts:240`** (`SafeOAuthFetchInit.headers?`'s ternary spread in `safeOAuthFetch`): `headers`
was optional but this is a private, file-internal type (never exported) with exactly three real
call sites, all of which always supply headers (at minimum an `accept`). Real refactor: `headers`
is now a required field, removing the dead branch instead of padding a test to reach it — the same
pattern this task's earlier `packages/http/src/runs.ts` fix used for `RunInternalErrorContext.runId`.

**`oauth.ts:190`** (`readCappedText`'s `controller?.abort()`): `controller` is real, working,
intentional API surface — passing one lets a caller stop pulling bytes from an oversized upstream
response the moment the cap is exceeded, not just reject after the fact — but no real call site in
this file currently has a controller in scope to pass (each of the four call sites receives a
`Response` after its own `safeOAuthFetch` call already returned and that call's own controller went
out of scope). Unlike `headers` above, this wasn't narrowed away: it's a genuine, useful capability
with no current caller, the same category as `@jini/memory`'s `NoteStoreConfigError` `cause`
parameter (this task's own earlier fix) — narrowing it to chase a coverage number would be a real
capability reduction. `readCappedText` is now exported (previously module-private) so this real
behavior is directly unit-testable, matching this repo's established "extract into a directly-
testable pure function" convention (`createDeferredEndGate`, `actionResultToApiResult`,
`buildDaemonDbOperations`, `classifyProcessExitFailure` — all from this same task's earlier fixes).

**Verified, personally, this session**: `pnpm --dir packages/mcp exec tsc --noEmit`: clean.
`pnpm --dir packages/mcp run test:coverage` — **302/302 tests pass** (2 new), **genuine
100/100/100/100 across every file in this package**. `vitest.config.ts`'s committed threshold
raised from 100/99.4/100/100 (package-wide) + a separate `src/server/**` 100% override to a single
flat 100/100/100/100 — the two-tier config existed only because `oauth.ts` couldn't clear 100
before; no longer needed.

## 2026-07-29 addition — a stable `./bin` export subpath for the `jini-mcp` executable

**Nothing was ported.** This is a package-manifest fix for a real consumer defect.

`package.json` declared `bin: { "jini-mcp": "./dist/bin/serve.js" }` but an `exports` map containing
only `"."`. A `bin` entry is not part of the exports map, so under Node's strict subpath resolution a
consumer that needed the executable's path — to spawn it as a CLI-injected MCP server, which is the
entire reason `serve.ts` exists — could not ask for it:
`require.resolve('@jini-ai/mcp/dist/bin/serve.js')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` even
though the file is really on disk. Consumers were therefore resolving the one exported entry point
and walking to a sibling path by hand (`join(dirname(require.resolve('@jini-ai/mcp')), 'bin',
'serve.js')`), which hardcodes this package's private build layout into every consumer and breaks
silently if `dist/`'s shape ever changes.

Added:

```json
"./bin": { "default": "./dist/bin/serve.js" }
```

**Why `default` only, with no `types` or `import` condition** — deliberate, not an oversight, and the
one place this subpath departs from the `types`/`import`/`default` shape every other export in the
workspace uses. This subpath exists to be *resolved to a path string and handed to `spawn`*, never to
be imported:

- `serve.ts` ends in a top-level `await serve()` behind its `isMainModule` guard. A module with
  top-level await cannot be `require()`d at all (`ERR_REQUIRE_ASYNC_MODULE`) even on a Node new
  enough to `require()` ESM, so advertising it as importable to a CommonJS consumer would be a lie.
- `serve.ts`'s own module doc already records why it is deliberately **not** re-exported from
  `../index.ts`: it is a `process.env`-reading, stdio-serving, potentially `process.exit`-calling
  side effect. The same reasoning applies to advertising `types`/`import` here.
- `require.resolve` matches against the CommonJS condition set (`require`, `node`, `default`), so
  `default` is the condition that actually makes a consumer's resolution succeed. An `import`-only
  entry would have left CommonJS consumers exactly as stuck as before.

No `jini.entries` map was added: `entries` is opt-in, and `./bin` shares the package's single
`runtime: "node"` — adding it would have obliged every subpath to be listed for no gain.

**Verified, personally, this session**: `require.resolve('@jini-ai/mcp/bin')` from a real CommonJS
consumer (Tovu, which links this package via `file:`) now resolves to
`.../packages/mcp/dist/bin/serve.js`, while `@jini-ai/mcp/dist/bin/serve.js` still correctly returns
`ERR_PACKAGE_PATH_NOT_EXPORTED` — the escape hatch closed, the front door opened. 4 new tests in
`src/__tests__/package-exports.test.ts` assert the subpath's declared target, that it never drifts
from the `bin` entry, that it is backed by a real source file, and that the root export is unchanged.
