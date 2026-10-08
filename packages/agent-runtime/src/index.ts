/**
 * @module @jini-ai/agent-runtime
 * Public runtime catalog, detection, launch and stream parsers plus ACP/pi-rpc transports.
 * Host-specific prompt, sandbox/environment, telemetry, account-failure and profile behavior
 * enters through the ports documented at each owner, never through a product dependency.
 * Skills/craft are content, not runtime compilation inputs: skill bundles can contain standalone
 * templates with their own TypeScript dependencies.
 * Alias contracts are documented beside their exports below; internal consumers import their
 * local implementations directly, so barrel aliases do not redirect those calls.
 */

// Core contract and diagnostic types.
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
export * from './log-file.js';
export * from './amr-model-cache.js';
export * from './model-catalog-cache.js';

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
// narrower ACP-probe shape re-exported below.
export * from './model-registry.js';

// Stream parsers expose their event unions so consumers cannot guess nonexistent payload fields.
// json-event-stream remains a generic ParserKind-dispatched parser with Record<string, unknown>;
// an accurate union across its many CLI formats requires a separate contract decision.
export { createClaudeStreamHandler, type ClaudeStreamEvent } from './claude-stream.js';
export { createJsonEventStreamHandler } from './json-event-stream.js';
export { createQoderStreamHandler, type QoderEvent } from './qoder-stream.js';
export { createCopilotStreamHandler, type CopilotStreamEvent } from './copilot-stream.js';

// Host-injected seams; each owner documents its contract.
export * from './amr-profile-resolver.js';
// `probeAcpModels` is the replaceable probe used by defs/shared.ts; the native ACP transport
// keeps `detectAcpModels`. See acp-model-probe.ts for defaults and injection behavior.
export {
  type AcpModelProbe,
  type AcpModelProbeRequest,
  noopAcpModelProbe,
  setAcpModelProbe,
  detectAcpModels as probeAcpModels,
} from './acp-model-probe.js';
// Runtime defs use `parsePiModels`; the protocol parser is exported as `parsePiRpcModels`
// below to avoid a public-name collision while preserving both consumers' contracts.
export * from './pi-models.js';
export * from './prompt-augmenter.js';
export * from './artifact-taxonomy.js';
export * from './telemetry-sink.js';

// LLM-provider integrations (BYOK model catalogs, OAuth+PKCE, gateway helpers).
export * from './providers/index.js';

/** ACP + pi-rpc protocol adapters over the shared JSON-line-stream core. See aliases above. */
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

export * from './model-discovery.js';
export { defaultModelDiscoveryDeps, parseClaudeInitializeMetadata, parsePiRpcMetadata } from './model-discovery-adapters.js';
