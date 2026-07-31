import type { CodexInstallStatus, McpInstallInfo } from './types.js';

/**
 * The daemon-side transport this tab needs — genuinely host-specific (the
 * origin called OD's own `/api/mcp/install-info` and
 * `/api/mcp/install/codex*` endpoints). This feature ships only a fake/test
 * double in `dependencies.ts`; a real host supplies its own implementation
 * pointed at its own daemon.
 */
export interface McpIntegrationsPort {
  /** Resolves the absolute command/args/env needed to run this host's MCP
   *  server as a stdio subprocess, plus whether the CLI/Node prerequisites
   *  are present. */
  fetchInstallInfo(): Promise<McpInstallInfo>;
  /** Codex one-click install is optional — a host without a Codex-specific
   *  install/uninstall endpoint omits this pair and the Codex tab falls
   *  back to snippet-copy-only. */
  fetchCodexInstallStatus?(): Promise<CodexInstallStatus>;
  installCodexMcp?(): Promise<void>;
  uninstallCodexMcp?(): Promise<void>;
}
