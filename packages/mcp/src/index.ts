/**
 * @module @jini-ai/mcp
 * Public barrel for the MCP (Model Context Protocol) domain. External code
 * imports MCP capabilities only from here — never from a subdirectory — so the
 * internal split (`core` kernel + `client` / `agent-install` concerns) can move
 * without touching consumers.
 *
 * Re-exports are explicit and named (no `export *`) so the public surface is
 * visible here and name collisions surface at build time.

 * Archived provenance rationale:
 * ## What was dropped (and why)
 *
 * - **`live-artifacts/` (entire subdir)** — the OD per-run "live artifacts" MCP
 *   tool surface. An OD-product feature, out of scope per the port brief.
 * - **The `od mcp` stdio server** in `client/client.ts` — `runMcpStdio`,
 *   `TOOL_DEFS`, `handleMcpToolCall`, and every tool handler (`get_artifact`,
 *   `create_project`, `start_run`, project/active-context resolution, studio deep
 *   links, run polling, …). This is not a generic MCP client: it is an
 *   OD-product MCP **server** hardwired to Open Design's REST API
 *   (`/api/projects`, `/api/skills`, `/api/design-systems`, `/api/runs`, …) and
 *   concepts (design systems, skills, plugins, artifacts, runs, studio, the
 *   `od://` resource scheme). It also imports the OD-only `@open-design/contracts`
 *   package (`buildProjectRawFileUrl`), the OD daemon-internal
 *   `../../artifacts/create.js`, and the `@modelcontextprotocol/sdk` — none of
 *   which exist in this repo. Faithfully porting it would mean importing OD
 *   product surface, so it was dropped and only its generic primitives salvaged.
 * - **`MCP_TEMPLATES` catalog + template types + `templateId`** in `config.ts` —
 *   a large, design-tool-tilted curated catalog of third-party MCP servers with
 *   OD marketing prose. Zero functional coupling; dropped for neutrality (same
 *   rationale `@jini/sqlite` used to drop the OD "templates" table).
 *
 * ### The `list_agents` decision
 *
 * Investigated before building anything, per the task brief. `@jini/agent-runtime`'s
 * barrel (`packages/agent-runtime/src/index.ts` → `export * from './registry.js'`)
 * already exports `AGENT_DEFS: RuntimeAgentDef[]` — the exact static, in-memory
 * list of every registered agent def (`registry.ts`'s `BASE_AGENT_DEFS`, 24
 * entries). `RuntimeAgentDef` has plain `id`/`name` fields (plus a large surface
 * of CLI-spawn internals: `bin`, `buildArgs`, `env`, `listModels`, etc. — no
 * `available`/live-detection field at all). No HTTP projection of this list
 * existed anywhere in `packages/http/src/*.ts` before this pass. Building
 * `GET /api/agents` returning `{agents: [{id, name}]}` needed no design judgment
 * call beyond "project the two safe fields" — no timeout/caching/probing
 * decisions, unlike OD's own `list_agents` (`listAgents`, mcp.ts:1034-1057),
 * which filters on a *live-detected* `available: boolean` field (OD's
 * `/api/agents` route actually probes each agent binary for installation/version
 * at request time — a real design decision this pass deliberately did not need
 * to make, since Jini has no such probing route or field to project). So it was
 * built: `packages/http/src/agents.ts`'s `agentListRoute` (`GET /api/agents`,
 * `AgentsHttpDeps.listAgents: () => readonly {id, name}[]` injected — DI,
 * matching `daemon-status.ts`/`active-context.ts`'s convention, so `@jini/http`
 * does not take on a new `@jini/agent-runtime` package dependency for a
 * two-field projection) plus `@jini/mcp`'s `list_agents` tool
 * (`server/tools/run-tools.ts`) proxying it. OD's `includeUnavailable` flag and
 * per-agent `installUrl`/`modelsCount` enrichment were **not** ported — those
 * exist only because OD's route does live probing, which this pass's route does
 * not attempt.
 *
 * ### What was explicitly excluded (and why)
 *
 * Per the task brief, only the mechanism plus tools mapping to real kernel
 * primitives were ported. The other 13 of OD's 18 `TOOL_DEFS` were **not**
 * ported — all are OD's project/file/artifact/skill/plugin model, none of which
 * exists in the Jini kernel (extraction-plan §2.1's "no Project, Conversation,
 * Brand, DesignSystem, Plugin/marketplace, or Automation noun" holds here
 * exactly as it did for `@jini/cli`'s own `mcp` row):
 * `list_projects`, `get_artifact`, `get_project`, `get_file`, `search_files`,
 * `list_files`, `create_artifact`, `write_file`, `delete_file`, `delete_project`,
 * `create_project`, `list_skills`, `list_plugins`. Also not ported: the
 * `ListResourcesRequestSchema`/`ReadResourceRequestSchema` resource surface
 * (`od://focus/active`, `od://skills/...`, `od://design-systems/...` — resources
 * require a skill/design-system store this kernel doesn't have), the studio
 * deep-link builder (`buildStudioUrl`, `getDefaultConversationId`,
 * `getWebBaseUrl`), the project-name-resolution cache (`resolveProjectId`,
 * `fetchProjectList`, `resolveProjectArg`), and the SSE-transcript reassembly
 * (`fetchRunAgentMessage`) — every one of these exists only in service of a
 * dropped tool.
 *
 * ### Design decision: the hosting-mechanism shape
 *
 * `createMcpToolServer({name, version, tools, resolveBaseUrl, instructions?,
 * idleMs?, fetchImpl?, stdin?, stdout?, createServer?, createTransport?})`
 * returns `{run(): Promise<void>}`. Construction (tool-name-uniqueness
 * validation via `buildToolIndex`) is synchronous and side-effect-free; all I/O
 * — resolving the daemon URL, connecting the transport, serving requests —
 * happens in `run()`. This is genuinely new kernel-adjacent surface (a new
 * package capability, not a file port), justified per extraction-plan §7's
 * two-consumer rule by the user's explicit request plus the stated expectation
 * that Zana/Open-Marketing will each want their own product-specific MCP
 * server built on the same hosting mechanism later — so the mechanism accepts
 * an arbitrary, caller-registered `McpToolDef[]`, not the 3-5 tools this pass
 * ships as its first real, working example.
 *
 * `McpServerLike`/`McpTransportLike` (in `tool-server.ts`) are narrow structural
 * interfaces covering only what this module calls on a `Server` instance
 * (`setRequestHandler`, `connect`) and a transport (`onmessage`, `onclose`,
 * `close`) — not literal re-exports of the SDK's own types, which can't be
 * satisfied by a plain object (the SDK's `Server` class has private fields, so
 * it's nominally, not structurally, typed). The default `createServer`/
 * `createTransport` factories construct the real SDK classes and cast through
 * `unknown` to these narrower interfaces (the same `as unknown as X` pattern
 * `core/oauth.ts` already uses to bridge undici's types); a caller may override
 * either factory to inject a test double. This is what makes `run()`'s full
 * orchestration — activity wrapping, message/close composition, the stdin-close
 * race, idle-triggered shutdown — deterministically unit-testable without a
 * real subprocess or real timers (see `tool-server.test.ts`), while one
 * dedicated test (`'wires the real @modelcontextprotocol/sdk Server +
 * StdioServerTransport when no factories are injected'`) still exercises the
 * true default path end-to-end with real `node:stream` `PassThrough` streams,
 * proving the DI seam isn't hiding a real-SDK integration bug.
 *
 * **Why `daemon-client.ts` is not `@jini/cli`'s `getJsonFromDaemon`/
 * `postJsonToDaemon`.** The architectural brief called for reusing
 * `@jini/cli`'s already-hardened daemon-fetch helpers "the way
 * `packages/cli/src/run-command.ts` already does." Checked directly: those two
 * functions map every failure — network-unreachable, non-2xx, oversized
 * response — onto `process.exit()` (via `exitWithStructuredError`), which is
 * correct for a one-shot CLI invocation but fatal for a long-lived stdio MCP
 * server, where a single failed tool call must return an `{isError:true}` MCP
 * result and the process must keep serving the next call. Routing around this
 * by injecting an `exit` callback that throws instead of exiting was considered
 * and rejected: it would require also capturing/re-parsing whatever
 * `postJsonToDaemon` had already written through its `write` callback to
 * reconstruct an error message, which is more convoluted than porting OD's own
 * already-throw-based `getJson`/`postJson` mechanism with the same bounded-I/O
 * hardening added. What **is** reused directly from `@jini/cli` (both pure,
 * non-`process.exit` functions): `sanitizeUntrustedText` (redacts daemon-
 * supplied error text before it reaches an MCP result) and, per the
 * architecture note about `daemon-url.ts`, `resolveDaemonUrl`/
 * `sanitizeDaemonUrlForDisplay` are available for a caller's `resolveBaseUrl`
 * implementation to use directly (this package does not re-wrap them — a
 * caller passes `() => resolveDaemonUrl({...})` straight into
 * `createMcpToolServer`'s `resolveBaseUrl` option; no `packages/mcp`-local
 * daemon-URL-resolution equivalent was built, since one already exists and nothing
 * about MCP's use case differs from a CLI command's). This cross-import
 * (`@jini/mcp` -> `@jini/cli`) is allowed by `scripts/check-engine-boundaries.ts`'s
 * R7 rule: R7 only restricts a **locked** package (the extraction-plan §3
 * fourteen) importing an **unlocked** one below `"stable"` status; `@jini/mcp`
 * is itself unlocked (`UNLOCKED.md`), so it importing the locked, stable
 * `@jini/cli` package is unrestricted. Confirmed via `pnpm guard` after wiring
 * the dependency (see below) — zero violations.
 *
 * No SSRF hardening (`assertSafePublicUrl`/`createValidatingLookup`, the
 * pattern `core/oauth.ts` uses for its own outbound fetches) was added to
 * `daemon-client.ts` — deliberately: `assertSafePublicUrl` actively *rejects*
 * loopback/private addresses, which is exactly where a real daemon lives. The
 * daemon URL here is a caller-resolved, typically-loopback target the user
 * already trusts enough to run (the same trust boundary `@jini/cli/http.ts`
 * already accepts for the identical "fetch my own daemon" concern), not an
 * attacker- or remote-metadata-controlled URL the way an external MCP server's
 * OAuth endpoints are.
 *
 * ### `daemonCallOptions(ctx)` — why a helper for two fields
 *
 * Nine call sites across `tools/` and `resources/` each wrote `{ fetchImpl: ctx.fetchImpl }` inline. Adding
 * a second field that must travel with the first creates a failure mode that is *not* a compile error: miss
 * one site and that single tool 401s while its neighbours keep working, which reaches a user as "some of
 * these tools just don't do anything". Every site now routes through one mapping, so a newly added tool is
 * authenticated by construction.
 *
 * The guarantee is a test rather than a convention. `server/__tests__/auth-propagation.test.ts` enumerates
 * the **real** registries (`RUN_TOOLS`, `TOOL_CATALOG_TOOLS`, `createExecuteDelegatedToolTool`,
 * `KERNEL_RESOURCES` — 8 tools + 1 resource), drives each handler through a spy `fetch`, and asserts the
 * header on every request each one makes; a matching pass asserts **no** `Authorization` key at all when no
 * credential was issued. It also asserts the surface list itself, so emptying or renaming a registry cannot
 * make the loops vacuously pass.
 *
 * That test was verified to actually catch the bug it exists for: reverting one call site to the inline form
 * fails it, naming the offending tool and URL.
 *
 * No transport change was needed — `daemon-client.ts`'s `DaemonRequestOptions` already carried `headers`.
 *
 * **Verified, personally, this session**: `pnpm --filter @jini-ai/mcp run typecheck` clean; full suite
 * **332/332 passing** (18 files), including 21 new propagation tests and 4 new `serve()` credential tests.
 * The pre-existing tool/resource suites, which assert the exact options object passed to the daemon client,
 * pass **unmodified** — the evidence that the no-credential path is byte-identical.
 */

// The original root-only boundary above describes the initial core/client/server split.
// Stable public subpaths now also host federation, approvals, stdio, testing, and ask-choice;
// internal source paths remain private so consumers can follow their declared runtime entry.

// ── core: config schema + IO ────────────────────────────────────────────────
export {
  inferMcpAuthModeForUrl,
  sanitizeMcpServer,
  sanitizeMcpConfig,
  readMcpConfig,
  writeMcpConfig,
  isManagedProjectCwd,
  buildClaudeMcpJson,
  buildAcpMcpServers,
  buildOpenCodeMcpConfigContent,
} from './core/index.js';
export type {
  McpTransport,
  McpAuthMode,
  McpServerConfig,
  McpConfig,
  AcpMcpServer,
  OpenCodeConfigBuildOptions,
} from './core/index.js';

// ── core: token store ───────────────────────────────────────────────────────
export {
  sanitizeTokensFile,
  readTokensFile,
  getToken,
  setToken,
  clearToken,
  readAllTokens,
  isTokenExpired,
} from './core/index.js';
export type { StoredMcpToken, McpTokensFile } from './core/index.js';

// ── core: install-info payload ──────────────────────────────────────────────
export { buildMcpInstallPayload } from './core/index.js';
export type { BuildMcpInstallPayloadInputs, McpInstallPayload } from './core/index.js';

// ── client: product-neutral stdio-server runtime primitives ─────────────────
export {
  createMcpIdleExitController,
  extractRelativeRefs,
  isTextualMime,
} from './client/index.js';

// ── server: the generic MCP tool-hosting mechanism + kernel-run tool defs ───
export {
  cancelRunTool,
  createMcpToolServer,
  daemonCallOptions,
  errorResult,
  getActiveContextTool,
  getDaemonJson,
  getRunTool,
  listAgentsTool,
  okResult,
  postDaemonJson,
  requireString,
  RUN_TOOLS,
  startRunTool,
  toolsToList,
  buildToolIndex,
  handleToolCall,
  DaemonResponseTooLargeError,
} from './server/index.js';
export type {
  DaemonRequestOptions,
  McpServerLike,
  McpToolContext,
  McpToolDef,
  McpToolServerHandle,
  McpToolServerOptions,
  McpTransportLike,
} from './server/index.js';

// ── server: the generic MCP resource surface + kernel resource defs ────────
export {
  activeContextResource,
  buildResourceIndex,
  handleResourceRead,
  KERNEL_RESOURCES,
  resourcesToList,
} from './server/index.js';
export type { McpResourceDef, McpResourceReadResult } from './server/index.js';

// ── server: the tool-catalog discovery defs (search_tools / describe_tool) ──
export { searchToolsTool, describeToolTool, TOOL_CATALOG_TOOLS } from './server/index.js';

// ── server: the component-catalog discovery defs (search_components / describe_component) ──
export { searchComponentsTool, describeComponentTool, COMPONENT_CATALOG_TOOLS } from './server/index.js';

// ── server: gap 3's MCP-callback delegated-tool-execution def ──────────────
export {
  createExecuteDelegatedToolTool,
  createExecuteReadonlyDelegatedToolTool,
  DEFAULT_DELEGATED_TOOL_TIMEOUT_MS,
} from './server/index.js';
export type { CreateExecuteDelegatedToolToolOptions } from './server/index.js';

// ── agent-install: register an MCP server into external agents ──────────────
export {
  AGENT_SLUGS,
  isAgentSlug,
  planAgentInstall,
  applyJsonInstall,
  removeJsonInstall,
} from './agent-install/index.js';
export type {
  AgentSlug,
  McpLaunchSpec,
  PlanContext,
  CliInstallPlan,
  JsonInstallPlan,
  ManualInstallPlan,
  InstallPlan,
} from './agent-install/index.js';

// Object-argument contracts and injected ports.
export type { McpConfigFilesystemPort } from './core/config.js';
export type { McpTokenClockOptions, McpTokenStoreOptions } from './core/tokens.js';
export type { BuildMcpInstallPayloadOptions } from './core/install-info.js';
export type { McpIdleTimerPort } from './client/client.js';
export type { McpToolServerRequiredArgs } from './server/tool-server.js';
export type { CreateExecuteDelegatedToolToolRequiredArgs } from './server/tools/delegated-tool.js';
export { DaemonHttpError } from './server/daemon-client.js';
