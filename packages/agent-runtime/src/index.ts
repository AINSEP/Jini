/**
 * @module @jini-ai/agent-runtime
 *
 * Public barrel. See `foundry/docs/jini-port/extraction-plan.md` for the target
 * architecture and `source-map.md` for full provenance.
 *
 * This barrel merges two independently-ported trees:
 * - the flat `runtimes/` -> agent-runtime TypeScript source (`src/*.ts` +
 *   `src/defs/*.ts`): the runtime-adapter registry, detection, launch, and
 *   stream-parser modules;
 * - the `agent-protocol/` capability barrel (`src/agent-protocol/**`): the
 *   ACP + pi-rpc subprocess transport the registry's ACP-based defs call
 *   into for live model discovery.
 *
 * Two names are exported by both ported trees under the same identifier
 * and are aliased below to avoid a duplicate-export error; see
 * source-map.md's "Barrel merge (2026-07-18)" section for the full
 * rationale.
 */

// Core contract + vendored diagnostic types.
export * from './types.js';

// Generic supporting modules.
export * from './paths.js';
export * from './models.js';
export * from './capabilities.js';
export * from './invocation.js';
export * from './mmd-routes.js';
export * from './metadata.js';
export * from './mcp.js';
export * from './executables.js';
export * from './role-marker-guard.js';
export * from './auth.js';
export * from './opencode-log.js';
export * from './env.js';
export * from './launch.js';
export * from './resolution.js';
export * from './terminal-launch.js';
export * from './diagnostics.js';
export * from './detection.js';
export * from './prompt-budget.js';
export * from './prompt-file.js';
export * from './amr-model-cache.js';

// Registry + defs.
export * from './registry.js';
export * from './defs/index.js';
// `model-registry.ts`: the provider/model/agent-picker vocabulary
// (`AgentDefinition`, `CredentialStatus`, `ModelProvider`,
// `ModelCatalogOption`, `AgentModelChoice`) + pure helpers a chat/model
// picker UI needs — distinct from `registry.ts`'s `BASE_AGENT_DEFS` CLI
// adapter catalog above (same word, different concept; kept as a separate
// module and file to avoid colliding on the `registry` name). Reuses this
// package's own `AgentDiagnostic`/`AgentDiagnosticSeverity`/`AgentFixIntent`
// from `./types.js` rather than redefining a second, looser copy; its own
// `ModelOption` is exported here as `ModelCatalogOption` since the plain
// `ModelOption` name is already owned by `agent-protocol/acp/models.ts`'s
// narrower ACP-probe shape re-exported below. See source-map.md.
export * from './model-registry.js';

// Stream parsers. Each handler's event union is exported alongside it — previously only
// `Record<string, unknown>` was visible to a consumer outside this package, which is how a real
// external integration guessed a nonexistent field name (`event.text`) and silently lost every
// streamed token instead of getting a compile error. `json-event-stream.ts`'s
// `createJsonEventStreamHandler` is the one parser NOT given this treatment here: it is a
// generic multi-CLI parser (`ParserKind`-dispatched, ~40 emission sites across many wire
// formats), and typing it accurately is a larger, separate task than this pass covers.
export { createClaudeStreamHandler, type ClaudeStreamEvent } from './claude-stream.js';
export { createJsonEventStreamHandler } from './json-event-stream.js';
export { createQoderStreamHandler, type QoderEvent } from './qoder-stream.js';
export { createCopilotStreamHandler, type CopilotStreamEvent } from './copilot-stream.js';

// Ports (injected seams — see each module's doc comment for what OD logic it replaces).
export * from './amr-profile-resolver.js';
// `detectAcpModels` collides by name with the real ACP transport re-exported
// below from `./agent-protocol/index.js`. This module's own `detectAcpModels`
// is a no-op-by-default injectable seam (used internally by
// `defs/shared.ts` for 8 ACP-based def literals so they don't need to
// depend on the full ACP transport) — aliased to `probeAcpModels` here so
// the real transport keeps the plain name. See source-map.md.
export {
  type AcpModelProbe,
  type AcpModelProbeRequest,
  noopAcpModelProbe,
  setAcpModelProbe,
  detectAcpModels as probeAcpModels,
} from './acp-model-probe.js';
// `parsePiModels` is exported under its plain name from this standalone
// module (it has real internal consumers in this package: `defs/shared.ts`
// / the `pi` def). `agent-protocol/pi-rpc`'s own copy of the identical OD
// origin function is aliased to `parsePiRpcModels` below to avoid the
// barrel-level name clash.
export * from './pi-models.js';
export * from './prompt-augmenter.js';
export * from './artifact-taxonomy.js';
export * from './telemetry-sink.js';

// LLM-provider integrations (BYOK model catalogs, OAuth+PKCE, gateway helpers).
export * from './providers/index.js';

/** @jini-ai/agent-runtime — public barrel (agent-protocol/ half).
 * Re-exports the agent-protocol/ capability barrel's public surface (ACP +
 * pi-rpc subprocess protocol adapters over a shared JSON-line-stream core).
 * See src/agent-protocol/README.md and source-map.md for provenance.
 *
 * Two of this barrel's exports collide by name with the `runtimes/`-ported
 * modules above and are aliased here (see source-map.md's "Barrel merge"
 * section for the full reasoning):
 * - `detectAcpModels` — the REAL ACP subprocess transport (spawns the CLI,
 *   performs the `initialize` + `session/new` JSON-RPC handshake). Kept
 *   under its plain name; `acp-model-probe.ts`'s same-named seam function
 *   is aliased to `probeAcpModels` above instead.
 * - `parsePiModels` — aliased to `parsePiRpcModels` below. Both this file's
 *   copy and the standalone `pi-models.ts` copy exported above are
 *   independent, verified-identical ports of the same OD origin function
 *   (`apps/daemon/src/pi-rpc.ts#parsePiModels`); `pi-models.ts`'s copy keeps
 *   the plain name since it has real internal consumers in this package.
 */
export {
  createJsonLineStream,
  type AcpMcpServerInput,
  type AcpPermissionDecision,
  type AcpPermissionHandler,
  type AcpPermissionOption,
  type AcpPermissionRequest,
  type AcpSessionController,
  type ModelOption,
  type AttachAcpSessionOptions,
  type AccountFailure,
  type AccountFailureClassifier,
  buildAcpSessionNewParams,
  normalizeModels,
  detectAcpModels,
  attachAcpSession,
  noopAccountFailureClassifier,
  mapPiRpcEvent,
  attachPiRpcSession,
  parsePiModels as parsePiRpcModels,
  type PiRpcSession,
  type PiRpcSessionOptions,
} from './agent-protocol/index.js';
