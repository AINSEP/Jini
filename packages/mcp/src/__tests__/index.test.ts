import { describe, expect, it } from 'vitest';
import * as mcp from '../index.js';

// Exercises the public root barrel (and, transitively, the core / client /
// agent-install sub-barrels it re-exports through).
describe('@jini-ai/mcp public barrel', () => {
  it('re-exports the core, client, and agent-install surface', () => {
    const names = [
      // core: config
      'inferMcpAuthModeForUrl', 'sanitizeMcpServer', 'sanitizeMcpConfig', 'readMcpConfig',
      'writeMcpConfig', 'isManagedProjectCwd', 'buildClaudeMcpJson', 'buildAcpMcpServers',
      'buildOpenCodeMcpConfigContent',
      // core: oauth
      'generateCodeVerifier', 'deriveCodeChallenge', 'generateState', 'discoverProtectedResource',
      'discoverAuthServer', 'registerClient', 'getOrRegisterClient', 'buildAuthorizeUrl',
      'exchangeCodeForToken', 'refreshAccessToken', 'PendingAuthCache', 'beginAuth',
      // core: tokens + install-info
      'sanitizeTokensFile', 'readTokensFile', 'getToken', 'setToken', 'clearToken',
      'readAllTokens', 'isTokenExpired', 'buildMcpInstallPayload',
      // client
      'createMcpIdleExitController', 'extractRelativeRefs', 'isTextualMime',
      // agent-install
      'AGENT_SLUGS', 'isAgentSlug', 'planAgentInstall', 'applyJsonInstall', 'removeJsonInstall',
      // server: tool-hosting mechanism + kernel-run tool defs
      'createMcpToolServer', 'okResult', 'errorResult', 'requireString', 'toolsToList',
      'buildToolIndex', 'handleToolCall', 'getDaemonJson', 'postDaemonJson',
      'DaemonResponseTooLargeError', 'RUN_TOOLS', 'startRunTool', 'getRunTool', 'cancelRunTool',
      'getActiveContextTool', 'listAgentsTool',
      // server: resource surface + kernel resource defs
      'resourcesToList', 'buildResourceIndex', 'handleResourceRead', 'KERNEL_RESOURCES',
      'activeContextResource',
      // server: gap 3's MCP-callback delegated-tool-execution def
      'createExecuteDelegatedToolTool',
    ] as const;
    for (const n of names) {
      expect(mcp[n as keyof typeof mcp], `missing export: ${n}`).toBeDefined();
    }
  });
});
