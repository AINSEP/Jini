import type { McpClientId, McpClientSnippet, McpInstallInfo, McpInstallPlatform, McpStdioServerConfig } from './types.js';

/** Path hint per OS — a Windows user shouldn't see a `~/...` path their
 *  shell won't expand, and vice versa. */
export function homeConfigPath(platform: McpInstallPlatform, posix: string, windows: string): string {
  return platform === 'win32' ? windows : posix;
}

export function commandPaletteShortcut(platform: McpInstallPlatform): string {
  return platform === 'darwin' ? '⌘⇧P' : 'Ctrl+Shift+P';
}

export function settingsShortcut(platform: McpInstallPlatform): string {
  return platform === 'darwin' ? '⌘,' : 'Ctrl+,';
}

/**
 * `btoa()` requires every input character be representable in Latin-1
 * (codepoints 0-255). A home directory containing non-Latin-1 characters
 * (e.g. an accented username) trips that and throws
 * `InvalidCharacterError`. UTF-8-encode the string into bytes first, then
 * map each byte back to a Latin-1 char before base64'ing.
 */
export function utf8Btoa(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function buildMcpStdioServerConfig(info: McpInstallInfo): McpStdioServerConfig {
  const env = info.env && Object.keys(info.env).length > 0 ? info.env : undefined;
  return {
    command: info.command,
    args: info.args,
    ...(env ? { env } : {}),
  };
}

/** A `[mcp_servers.<serverName>.env]` TOML block, or `''` when there's no env. */
export function buildCodexEnvToml(serverName: string, info: McpInstallInfo): string {
  const entries = Object.entries(info.env ?? {});
  if (entries.length === 0) return '';
  return `\n\n[mcp_servers.${serverName}.env]\n${entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}`;
}

/** The `{"mcpServers": {"<serverName>": {...}}}` shape shared by Cursor,
 *  Antigravity, and Windsurf. */
export function buildSharedMcpJson(serverName: string, info: McpInstallInfo): string {
  const inner = buildMcpStdioServerConfig(info);
  const innerJson = JSON.stringify(inner, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : `    ${line}`))
    .join('\n');
  return `{\n  "mcpServers": {\n    "${serverName}": ${innerJson}\n  }\n}`;
}

export function buildClaudeCliSnippet(serverName: string, info: McpInstallInfo): string {
  const inner = JSON.stringify(buildMcpStdioServerConfig(info));
  return `claude mcp add-json --scope user ${serverName} '${inner}'`;
}

export function buildCodexTomlSnippet(serverName: string, info: McpInstallInfo): string {
  return `[mcp_servers.${serverName}]\ncommand = ${JSON.stringify(info.command)}\nargs = ${JSON.stringify(info.args)}${buildCodexEnvToml(serverName, info)}`;
}

export function buildVsCodeSnippet(serverName: string, info: McpInstallInfo): string {
  const envPart = info.env && Object.keys(info.env).length > 0 ? `,\n      "env": ${JSON.stringify(info.env)}` : '';
  return `{\n  "servers": {\n    "${serverName}": {\n      "type": "stdio",\n      "command": ${JSON.stringify(info.command)},\n      "args": ${JSON.stringify(info.args)}${envPart}\n    }\n  }\n}`;
}

export function buildZedSnippet(serverName: string, info: McpInstallInfo): string {
  const envPart = info.env && Object.keys(info.env).length > 0 ? `,\n      "env": ${JSON.stringify(info.env)}` : '';
  return `{\n  "context_servers": {\n    "${serverName}": {\n      "source": "custom",\n      "command": ${JSON.stringify(info.command)},\n      "args": ${JSON.stringify(info.args)}${envPart}\n    }\n  }\n}`;
}

/** A `cursor://anysphere.cursor-deeplink/mcp/install?...` one-click install link. */
export function buildCursorDeeplink(serverName: string, info: McpInstallInfo): string {
  const inner = buildMcpStdioServerConfig(info);
  const encoded = utf8Btoa(JSON.stringify(inner));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${serverName}&config=${encoded}`;
}

/**
 * Short install-method label per client ("CLI command" / "TOML config" /
 * "One-click install" / "JSON config") — origin: each `MCP_CLIENTS` entry's
 * `buildMethod` in `IntegrationsSection`. Every original `buildMethod`
 * implementation ignores its `info` argument (the label depends only on the
 * client, not the fetched install info), so this is a pure clientId lookup
 * rather than needing `McpInstallInfo` — callers that want the original's
 * "blank until install info has loaded" presentation gate this themselves.
 */
export function methodLabelForClient(clientId: McpClientId): string {
  switch (clientId) {
    case 'claude':
      return 'CLI command';
    case 'codex':
      return 'TOML config';
    case 'cursor':
      return 'One-click install';
    case 'vscode':
    case 'antigravity':
    case 'zed':
    case 'windsurf':
      return 'JSON config';
    default: {
      const exhaustive: never = clientId;
      throw new Error(`Unknown MCP client id: ${String(exhaustive)}`);
    }
  }
}

/**
 * Resolves the full install snippet + language + method label + (templated)
 * instruction copy + optional deeplink for one client. The instruction is
 * returned as an i18n template (`{path}`/`{shortcut}` placeholders) + its
 * resolved vars, not a final string — the component wraps it with `t()` so a
 * host can localize it, same convention as every other tab's copy.
 */
export function snippetForClient(clientId: McpClientId, serverName: string, info: McpInstallInfo): McpClientSnippet {
  const method = methodLabelForClient(clientId);
  switch (clientId) {
    case 'claude':
      return {
        snippet: buildClaudeCliSnippet(serverName, info),
        language: 'bash',
        method,
        instructionTemplate: 'Run this command in your terminal.',
        instructionVars: {},
      };
    case 'codex':
      return {
        snippet: buildCodexTomlSnippet(serverName, info),
        language: 'toml',
        method,
        instructionTemplate: 'Paste this into {path}.',
        instructionVars: { path: homeConfigPath(info.platform, '~/.codex/config.toml', '%USERPROFILE%\\.codex\\config.toml') },
      };
    case 'cursor':
      return {
        snippet: buildSharedMcpJson(serverName, info),
        language: 'json',
        method,
        instructionTemplate: 'Paste this into {path}, or use one-click install below.',
        instructionVars: { path: homeConfigPath(info.platform, '~/.cursor/mcp.json', '%USERPROFILE%\\.cursor\\mcp.json') },
        deeplink: buildCursorDeeplink(serverName, info),
      };
    case 'vscode':
      return {
        snippet: buildVsCodeSnippet(serverName, info),
        language: 'json',
        method,
        instructionTemplate: 'Open the command palette ({shortcut}), run "MCP: Add Server", and paste this.',
        instructionVars: { shortcut: commandPaletteShortcut(info.platform) },
      };
    case 'antigravity':
      return {
        snippet: buildSharedMcpJson(serverName, info),
        language: 'json',
        method,
        instructionTemplate: 'Add this to your MCP server configuration.',
        instructionVars: {},
      };
    case 'zed':
      return {
        snippet: buildZedSnippet(serverName, info),
        language: 'json',
        method,
        instructionTemplate: 'Open settings ({shortcut}) and paste this into your context servers.',
        instructionVars: { shortcut: settingsShortcut(info.platform) },
      };
    case 'windsurf':
      return {
        snippet: buildSharedMcpJson(serverName, info),
        language: 'json',
        method,
        instructionTemplate: 'Paste this into {path}.',
        instructionVars: {
          path: homeConfigPath(
            info.platform,
            '~/.codeium/windsurf/mcp_config.json',
            '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json',
          ),
        },
      };
  }
  // No `default` arm here (contrast `methodLabelForClient` above, which
  // still needs one): `methodLabelForClient(clientId)` on line 121 already
  // throws for any value outside the `McpClientId` union before this switch
  // is ever reached, which made a second identical throw here dead code —
  // refactored away rather than kept behind a coverage-suppression comment.
  // TypeScript still catches a missing case if `McpClientId` grows a member
  // and only `methodLabelForClient` gets updated: with every current case
  // returning, `tsc` requires this switch to be exhaustive too, or the
  // function's declared `McpClientSnippet` return type is violated on the
  // "falls through" path.
}
