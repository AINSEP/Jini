/**
 * Resolves the `jini-mcp` bridge this playground injects into every MCP-capable agent run
 * (`@jini/daemon`'s `createAgentExecutor({ mcpJsonInjection })`, which writes a merged `.mcp.json`
 * into the run's cwd before spawn — see that option's own doc).
 *
 * Without this, an agent run has no agent-native path to `execute_delegated_tool`, so nothing the
 * agent can say reaches `ToolExecutor` and the frontend-control capabilities are unreachable except
 * by a human curling `POST /api/delegated-tool-calls` directly. This module is what closes that gap.
 *
 * **Why `node <abs path>` rather than a PATH lookup or a `node_modules/.bin` shim.** The command is
 * spawned by the *agent CLI* (Claude Code launches its own MCP servers), in the run's cwd, with an
 * environment this host does not control and that clients are free to reduce to just the `.mcp.json`
 * `env` block. An absolute interpreter path plus an absolute script path is the only form that does
 * not depend on `PATH`, on a bin shim's exec bit, or on which package directory the agent happens to
 * be standing in.
 *
 * **Resolution is a check, not an assumption.** `@jini/mcp` ships its bin as build output
 * (`"bin": { "jini-mcp": "./dist/bin/serve.js" }`), so a repo that has not been built yet has no
 * file to point at. Reporting that as a resolved-but-missing path lets the caller print something
 * actionable at startup instead of failing later inside a spawn, where the error surfaces as an
 * unexplained dead MCP server in the agent's own logs.
 */

/** The subset of `@jini/daemon`'s `McpJsonInjectionOptions` this host supplies (the rest default). */
export interface JiniMcpBridgeInjection {
  readonly command: string;
  readonly args: readonly string[];
  readonly daemonUrl: string;
}

export type JiniMcpBridgeResolution =
  | { readonly ok: true; readonly injection: JiniMcpBridgeInjection }
  | { readonly ok: false; readonly missingPath: string };

export interface ResolveJiniMcpBridgeOptions {
  /** Absolute path to the repository root the `@jini/mcp` package sits under. */
  readonly repoRoot: string;
  /** Loopback base URL the spawned `jini-mcp` process calls back into (`JINI_DAEMON_URL`). */
  readonly daemonUrl: string;
  /** Absolute path to the Node interpreter to launch the bin with. Normally `process.execPath`. */
  readonly nodePath: string;
  /** Existence probe for the resolved bin path. Injected so the decision is testable without a build. */
  readonly fileExists: (path: string) => boolean;
  /** Joins path segments. Injected only so tests can assert the composed path platform-independently. @default node:path join semantics via the caller */
  readonly join: (...segments: string[]) => string;
}

/** Build output of `@jini/mcp`, relative to the repo root. */
const JINI_MCP_BIN_SEGMENTS = ['packages', 'mcp', 'dist', 'bin', 'serve.js'] as const;

/**
 * Resolves the injection config, or reports the path that would have to exist. Pure apart from the
 * injected `fileExists`/`join`, so both outcomes are directly assertable.
 * @complexity O(1).
 */
export function resolveJiniMcpBridge(options: ResolveJiniMcpBridgeOptions): JiniMcpBridgeResolution {
  const binPath = options.join(options.repoRoot, ...JINI_MCP_BIN_SEGMENTS);
  if (!options.fileExists(binPath)) {
    return { ok: false, missingPath: binPath };
  }
  return {
    ok: true,
    injection: {
      command: options.nodePath,
      args: [binPath],
      daemonUrl: options.daemonUrl,
    },
  };
}
