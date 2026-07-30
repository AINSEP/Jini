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

  it('re-exports the tool-catalog discovery defs as the same objects the server module defines', async () => {
    // `bin/serve.ts` registers these three alongside RUN_TOOLS, but the package
    // exports only "." and "./bin" — so without a root re-export a consumer building
    // its own createMcpToolServer cannot reach them at all, and the catalog half of
    // the tool surface is private by accident. Identity-compared (not just presence-
    // checked) so a re-export that accidentally shadows the real def with a copy
    // fails here.
    const source = await import('../server/tools/tool-catalog-tools.js');
    expect(mcp.searchToolsTool).toBe(source.searchToolsTool);
    expect(mcp.describeToolTool).toBe(source.describeToolTool);
    expect(mcp.TOOL_CATALOG_TOOLS).toBe(source.TOOL_CATALOG_TOOLS);
  });

  it('exposes the catalog tools as usable McpToolDefs under their wire names', () => {
    expect(mcp.TOOL_CATALOG_TOOLS.map((t) => t.name)).toEqual(['search_tools', 'describe_tool']);
    expect(typeof mcp.searchToolsTool.handler).toBe('function');
    expect(typeof mcp.describeToolTool.handler).toBe('function');
  });
});
