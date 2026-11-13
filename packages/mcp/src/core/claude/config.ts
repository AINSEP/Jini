import type { McpServerConfig } from '../config.js';
import { nonEmptyField, remoteHeadersField } from '../config-shared.js';

/**
 * Project-cwd `.mcp.json` shape that Claude Code auto-loads on spawn (the
 * same format Claude Desktop and Cursor use). Returns null when the user
 * has no enabled servers — in that case the caller should NOT write the
 * file (and should clean up any stale one).
 *
 * `tokens` is an optional map of `serverId -> bearer access token`, used
 * for HTTP/SSE servers that completed the daemon's web OAuth flow. When a
 * token is present we inject `Authorization: Bearer <token>` into the
 * server's headers — this is what bypasses the per-spawn `mcp-remote`
 * dance and lets Claude Code talk directly to the upstream MCP using
 * pre-authenticated credentials. User-supplied headers always win on
 * conflict so they can pin a specific token if they really want to.
 */
export function buildClaudeMcpJson(
  { servers }: { servers: McpServerConfig[] },
  { tokens = {} }: { tokens?: Record<string, string> } = {},
): unknown | null {
  const enabled = servers.filter((s) => s.enabled);
  if (enabled.length === 0) return null;
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of enabled) {
    out[s.id] = s.transport === 'stdio'
      ? { command: s.command, ...nonEmptyField({ key: 'args', value: s.args }), ...nonEmptyField({ key: 'env', value: s.env }) }
      // type: 'sse' | 'http'
      : { type: s.transport, url: s.url, ...remoteHeadersField({ server: s, tokens }) };
  }
  return { mcpServers: out };
}

