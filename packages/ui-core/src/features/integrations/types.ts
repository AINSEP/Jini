/**
 * Origin: `IntegrationsSection` in `SettingsDialog.tsx` — a multi-client
 * "install me as an MCP server" snippet generator (Claude Code / Codex /
 * Cursor / VS Code / Antigravity / Zed / Windsurf). Per
 * `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.3: "Generic
 * mechanism, 100% branded content" — every snippet hardcoded the origin
 * product's own MCP server name as a literal. Parameterized here as
 * `serverName` (a `McpIntegrationsPort`-agnostic caller argument, not a
 * config value) —
 * see `packages/ui/source-map.md` for the full provenance note and the
 * purity-grep result confirming zero hardcoded product-identity strings
 * remain.
 */

export type McpClientId = 'claude' | 'codex' | 'cursor' | 'vscode' | 'zed' | 'windsurf' | 'antigravity';

export type McpInstallPlatform = 'darwin' | 'linux' | 'win32' | (string & {});

/** How to reach the daemon's MCP endpoint — resolved by the host via
 *  `McpIntegrationsPort.fetchInstallInfo`, not fetched by this feature
 *  directly (no hardcoded transport). */
export interface McpInstallInfo {
  command: string;
  args: string[];
  env?: Record<string, string>;
  daemonUrl: string;
  platform: McpInstallPlatform;
  cliExists: boolean;
  nodeExists: boolean;
  buildHint: string | null;
}

export interface McpStdioServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type McpSnippetLanguage = 'bash' | 'json' | 'toml';

export interface McpClientDescriptor {
  id: McpClientId;
  label: string;
}

export interface McpClientSnippet {
  snippet: string;
  language: McpSnippetLanguage;
  /** Short install-method label ("CLI command" / "TOML config" / "One-click
   *  install" / "JSON config") — shown as the picker trigger's subtitle and
   *  next to every client in the dropdown list, origin `buildMethod` per
   *  entry in `IntegrationsSection`'s `MCP_CLIENTS`. A plain i18n key (no
   *  vars): pass to `t(method)`. */
  method: string;
  /** i18n template with `{path}`/`{shortcut}` placeholders — pass to
   *  `t(instructionTemplate, instructionVars)`. */
  instructionTemplate: string;
  instructionVars: Record<string, string>;
  deeplink?: string;
}

export interface CodexInstallStatus {
  available: boolean;
  installed: boolean;
}
