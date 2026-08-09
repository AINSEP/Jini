/**
 * @module @jini-ai/mcp
 * Public barrel for the MCP (Model Context Protocol) domain. External code
 * imports MCP capabilities only from here — never from a subdirectory — so the
 * internal split (`core` kernel + `client` / `agent-install` concerns) can move
 * without touching consumers.
 *
 * Re-exports are explicit and named (no `export *`) so the public surface is
 * visible here and name collisions surface at build time.
 */

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

// ── core: OAuth 2.1 / PKCE flow ─────────────────────────────────────────────
export {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
  discoverProtectedResource,
  discoverAuthServer,
  registerClient,
  getOrRegisterClient,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  PendingAuthCache,
  beginAuth,
} from './core/index.js';
export type {
  ProtectedResourceMetadata,
  AuthorizationServerMetadata,
  RegisteredClient,
  OAuthTokenResponse,
  PendingAuthState,
  AuthorizeUrlInput,
  ExchangeCodeInput,
  RefreshTokenInput,
  BeginAuthInput,
  BeginAuthResult,
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
export { createExecuteDelegatedToolTool, DEFAULT_DELEGATED_TOOL_TIMEOUT_MS } from './server/index.js';
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
