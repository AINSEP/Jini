/**
 * @module @jini-ai/mcp/core/install-info
 * Pure builder for the MCP install-info payload (command/args/env) shared by the
 * daemon route, the settings UI, and its test fixture, so every install surface
 * configures byte-identical bytes. Part of the MCP `core` kernel; intentionally
 * side-effect-free and depends on no sibling subdirectory.
 */
// Pure builder for the MCP install-info payload. Extracted from the HTTP
// handler so the test fixture and the production handler share the exact
// env/argv/buildHint shape; a divergence here is the difference between an
// MCP snippet that works and one that EPERMs out when pasted into an IDE
// (Antigravity / Cursor / VS Code), or silently misses the sidecar
// transport endpoint.
//
// Side effects (fs.existsSync probes, process.execPath, the
// ELECTRON_RUN_AS_NODE env read, data-dir resolution, sidecar IPC
// detection) all stay in the caller. This module is intentionally pure so
// it can be unit-tested without booting a daemon.

/**
 * All runtime facts the caller resolves before calling `buildMcpInstallPayload`.
 * Kept as a plain-data interface so the builder stays side-effect-free and
 * can be unit-tested with fake filesystem/env values.
 */
export interface BuildMcpInstallPayloadInputs {
  cliPath: string;
  cliExists: boolean;
  execPath: string;
  nodeExists: boolean;
  port: number;
  platform: NodeJS.Platform;
  dataDir: string;
  /** Env var name under which to pin the data directory so the spawned MCP
   *  process writes to the same directory the daemon uses even when the IDE
   *  that launched it does not inherit the packaged app's environment (e.g.
   *  `"JINI_DATA_DIR"`). */
  dataDirEnvVar: string;
  electronAsNode: boolean;
  /** True when the daemon was bootstrapped as a sidecar and the spawned MCP
   *  process should discover the live URL via the IPC status socket instead
   *  of a baked `--daemon-url`. */
  isSidecarMode: boolean;
  /** Already-filtered sidecar transport env entries the caller wants
   *  propagated into the snippet. The caller decides what's worth
   *  propagating; this builder just merges. */
  sidecarEnv: Record<string, string>;
  /** Browser-facing base URL (e.g. `http://127.0.0.1:65321`). Used by MCP
   *  clients to build deep links so the outer agent can suggest a URL. Null
   *  when the daemon was launched without a known web port (headless). */
  webBaseUrl?: string | null;
  /** MCP subcommand the spawned CLI runs. Defaults to `"mcp"`. */
  subcommand?: string;
}

/**
 * The install-info response shape: the command/args/env an MCP client must use
 * to spawn the CLI's MCP subcommand, plus diagnostic flags and a human-readable
 * `buildHint` describing any missing prerequisites.
 */
export interface McpInstallPayload {
  command: string;
  args: string[];
  env: Record<string, string>;
  daemonUrl: string;
  /** Browser-facing base URL the daemon is paired with, when known. */
  webBaseUrl: string | null;
  platform: NodeJS.Platform;
  cliExists: boolean;
  nodeExists: boolean;
  buildHint: string | null;
}

/**
 * Build the `McpInstallPayload` from resolved runtime facts.
 * Decides whether to bake `--daemon-url` into args (direct launch) or omit it
 * (sidecar mode, where the spawned process discovers the URL via the IPC socket).
 * Also pins the data-dir env var to prevent EPERM failures in packaged installs
 * and injects `ELECTRON_RUN_AS_NODE=1` when running under Electron.
 * @param inputs Runtime facts collected by the production route or test fixture.
 * @returns The install payload; `buildHint` is non-null when prerequisites are missing.
 */
export function buildMcpInstallPayload(
  inputs: BuildMcpInstallPayloadInputs,
): McpInstallPayload {
  const subcommand = inputs.subcommand ?? 'mcp';
  const hints: string[] = [];
  if (!inputs.cliExists) {
    hints.push(
      `CLI entry is missing at ${inputs.cliPath}. Rebuild the daemon or packaged app and refresh.`,
    );
  }
  if (!inputs.nodeExists) {
    hints.push(
      `Node-compatible runtime at ${inputs.execPath} no longer exists. Reinstall the runtime and restart the daemon.`,
    );
  }
  // Pin the data-dir env var to the daemon's resolved data root so the
  // spawned MCP process writes to the same directory the daemon already
  // uses even when the IDE that launched it does not inherit the packaged
  // app's environment. Without this, the process falls back to a
  // per-cwd data dir which for packaged installs can be a read-only app
  // bundle that trips EPERM.
  const env: Record<string, string> = {
    [inputs.dataDirEnvVar]: inputs.dataDir,
    ...inputs.sidecarEnv,
  };
  if (inputs.electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  // Sidecar mode: omit --daemon-url so the spawned MCP process discovers
  // the live URL via the IPC status socket on every spawn, surviving
  // ephemeral-port restarts. Direct launches have no socket and need the
  // URL baked.
  const args = inputs.isSidecarMode
    ? [inputs.cliPath, subcommand]
    : [
        inputs.cliPath,
        subcommand,
        '--daemon-url',
        `http://127.0.0.1:${inputs.port}`,
      ];
  return {
    command: inputs.execPath,
    args,
    env,
    daemonUrl: `http://127.0.0.1:${inputs.port}`,
    webBaseUrl:
      typeof inputs.webBaseUrl === 'string' && inputs.webBaseUrl.length > 0
        ? inputs.webBaseUrl
        : null,
    // Surface platform so the install panel can localize path hints
    // (~/.cursor vs %USERPROFILE%\.cursor) and keyboard shortcuts
    // (Cmd vs Ctrl).
    platform: inputs.platform,
    cliExists: inputs.cliExists,
    nodeExists: inputs.nodeExists,
    buildHint: hints.length ? hints.join(' ') : null,
  };
}
