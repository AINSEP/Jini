import type { McpClientDescriptor } from './types.js';

export const MCP_CLIENTS: readonly McpClientDescriptor[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'zed', label: 'Zed' },
  { id: 'windsurf', label: 'Windsurf' },
];

export const DEFAULT_MCP_CLIENT_ID = 'claude';

/** Default MCP server name used when a host doesn't supply its own. Hosts
 *  embedding this tab for a real product should pass their own
 *  `serverName` — this default is intentionally generic. */
export const DEFAULT_MCP_SERVER_NAME = 'mcp-server';
