#!/usr/bin/env node
/**
 * @module @jini-ai/mcp/bin/serve
 *
 * The bootable `jini-mcp` binary (`package.json`'s `"bin": { "jini-mcp": "./dist/bin/serve.js" }`)
 * — the real executable entry point gap 3's MCP-callback continuation-transport spike needed and
 * did not have (see `packages/daemon/source-map.md`'s "run/chat orchestration gap 3, part 1"
 * addition, and this package's own dated section in `source-map.md`). `../server/tool-server.js`'s
 * `createMcpToolServer` was always designed to run as *this process's own* stdio — meant to be a
 * script a client (Claude Code) spawns as its own child subprocess and talks to over that child's
 * stdin/stdout — but until this file, nothing in this package actually was that script.
 *
 * Follows `@jini-ai/cli/main.ts`'s established shape for a bootable, side-effect-guarded, `#!/usr/bin/env
 * node` entry point: a named, fully-dependency-injected `serve()` export (importable for tests, or
 * for a consumer building its own bin wrapper around it) plus a bottom-of-file guard that only
 * calls it for real when this module is the actual process entrypoint — mirrors that file's own
 * `isMainModule` check (Node's ESM equivalent of the CommonJS `require.main === module` idiom).
 * Deliberately **not** re-exported from `../index.ts`: that barrel is a plain library dependency, and
 * this file's whole purpose is a `process.env`-reading, stdio-serving, potentially `process.exit`-
 * calling side effect — bundling it into the library barrel would mean `import '@jini-ai/mcp'` could
 * start behaving like a spawned MCP server.
 *
 * **Scope: what this process is spawned to do.** One `jini-mcp` process serves exactly one run for
 * its entire lifetime — the spawning daemon injects {@link RUN_ID_ENV_VAR} into the child's own
 * environment before Claude Code (which in turn spawns *this* as its own MCP server child, per its
 * `.mcp.json`) ever starts talking to it. That is what lets `execute_delegated_tool`
 * (`../server/tools/delegated-tool.js`) close over a fixed `runId` at construction time instead of
 * trusting a model-supplied one — see that module's own doc for why that boundary matters. Every
 * other tool this server hosts (`RUN_TOOLS`, `../server/tools/run-tools.js`) is run-agnostic and
 * needed no such scoping.
 *
 * **Daemon-URL resolution** mirrors `@jini-ai/cli/main.ts`'s own posture: no baked-in default, just
 * `resolveDaemonUrl` (`@jini-ai/cli`) wired to a `--daemon-url`-shaped precedence chain — except this
 * process has no argv to parse (an MCP client launches it with a fixed `command`/`args`/`env`, not
 * interactive flags), so only the env-var step applies: {@link DAEMON_URL_ENV_VAR}. When unset,
 * `resolveDaemonUrl` throws, and this file's own top-level error boundary turns that into a clean
 * stderr message + non-zero exit rather than an unhandled rejection.
 */
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { resolveDaemonUrl as resolveDaemonUrlDefault, type ResolveDaemonUrlOptions } from '@jini-ai/cli';
import { createMcpToolServer as createMcpToolServerDefault, type McpToolServerOptions } from '../server/tool-server.js';
import type { McpToolDef } from '../server/tool-protocol.js';
import { RUN_TOOLS } from '../server/tools/run-tools.js';
import { TOOL_CATALOG_TOOLS } from '../server/tools/tool-catalog-tools.js';
import { createExecuteDelegatedToolTool } from '../server/tools/delegated-tool.js';
import { KERNEL_RESOURCES } from '../server/resources/active-resource.js';

/** The one run this process is scoped to for its entire lifetime. Set by the spawning daemon, never by the MCP client. */
export const RUN_ID_ENV_VAR = 'JINI_RUN_ID';
/** Checked (only) when resolving the daemon HTTP base URL — see `resolveDaemonUrl`'s own docs; matches `@jini-ai/cli/main.ts`'s identically-named constant. */
export const DAEMON_URL_ENV_VAR = 'JINI_DAEMON_URL';
/**
 * Bearer credential for this process's daemon callbacks, set by the spawning daemon when it issued
 * one (see `@jini-ai/daemon`'s `McpJsonInjectionOptions.credential`).
 *
 * **Optional, unlike {@link RUN_ID_ENV_VAR}.** A daemon whose `/api` surface trusts loopback issues
 * no credential, and this process must keep working against one exactly as before — so an unset
 * value means "send no `Authorization` header", never a startup failure. When a daemon *does*
 * require a credential and none was delivered, that daemon's own gate answers 401; refusing to boot
 * here instead would be guessing at a policy this process cannot observe.
 */
export const DAEMON_TOKEN_ENV_VAR = 'JINI_DAEMON_TOKEN';
/**
 * Overrides the delegated-tool request deadline (see `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS`).
 *
 * **Optional.** This process is spawned as a subprocess by the daemon, so env is the only channel
 * a host has to reach `CreateExecuteDelegatedToolToolOptions.delegatedToolTimeoutMs`; without this
 * var that option would be unreachable in the real deployment path and the default would be the
 * only value the system could ever run with.
 *
 * A host sets it to its own exchange total-lifetime ceiling plus headroom. An unset, non-numeric,
 * or non-positive value means "use the default" rather than a startup failure — same posture as
 * {@link DAEMON_TOKEN_ENV_VAR}, and for the same reason: this process cannot observe the host
 * policy that would make a given number correct, so it must not refuse to boot over one.
 */
export const DELEGATED_TOOL_TIMEOUT_ENV_VAR = 'JINI_DELEGATED_TOOL_TIMEOUT_MS';

const SERVER_NAME = 'jini-mcp';
const SERVER_VERSION = '0.0.0';
const INSTRUCTIONS =
  'Tools proxying this host\'s Jini daemon over loopback HTTP, scoped to the run that spawned this MCP server process. ' +
  'Use execute_delegated_tool to invoke a Jini-registered tool (never an agent-vendor-specific tool name) against that run — ' +
  'every call is routed through the daemon\'s deny-by-default ToolExecutor gate.';

export interface ServeDeps {
  /** @default process.env */
  readonly env?: NodeJS.ProcessEnv;
  /** @default process.stderr.write */
  readonly writeErr?: (text: string) => void;
  /** @default process.exit; inject for tests (must not return) */
  readonly exit?: (code: number) => never;
  /** @default the real @jini-ai/cli resolveDaemonUrl */
  readonly resolveDaemonUrl?: typeof resolveDaemonUrlDefault;
  /** @default the real createMcpToolServer */
  readonly createMcpToolServer?: typeof createMcpToolServerDefault;
  /** Threaded into `execute_delegated_tool`'s per-call correlation id. @default node:crypto randomUUID */
  readonly generateToolUseId?: () => string;
  /** Threaded into every tool's daemon call. @default the global fetch */
  readonly fetchImpl?: typeof fetch;
  /** @default process.stdin */
  readonly stdin?: Readable;
  /** @default process.stdout */
  readonly stdout?: Writable;
}

function defaultWriteErr(text: string): void {
  process.stderr.write(text);
}

/**
 * Assembles and runs the `jini-mcp` stdio MCP server: `RUN_ID_ENV_VAR` (required — this process
 * has no meaningful default run to serve) plus `DAEMON_URL_ENV_VAR` resolution, then hosts
 * `RUN_TOOLS` (run-agnostic) alongside a fresh `execute_delegated_tool` def scoped to the resolved
 * `runId`, and `KERNEL_RESOURCES`. Resolves once the client disconnects (stdin EOF) or the
 * idle-exit window elapses (`createMcpToolServer`'s own default) — never bare-throws: every error
 * path below writes a message to `writeErr` and calls `exit(1)` instead.
 */
export async function serve(deps: ServeDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const writeErr = deps.writeErr ?? defaultWriteErr;
  const exit = deps.exit ?? ((code: number): never => process.exit(code));
  const resolveDaemonUrlFn = deps.resolveDaemonUrl ?? resolveDaemonUrlDefault;
  const createMcpToolServerFn = deps.createMcpToolServer ?? createMcpToolServerDefault;

  const runId = env[RUN_ID_ENV_VAR];
  if (typeof runId !== 'string' || runId.length === 0) {
    writeErr(`${SERVER_NAME}: missing required ${RUN_ID_ENV_VAR} environment variable (this process must be spawned by a Jini daemon, which sets it)\n`);
    return exit(1);
  }

  const resolveBaseUrl = (): Promise<string> => {
    const options: ResolveDaemonUrlOptions = { flagUrl: null, env, envVarName: DAEMON_URL_ENV_VAR, warn: writeErr };
    return resolveDaemonUrlFn(options);
  };

  const tools: readonly McpToolDef[] = [
    ...RUN_TOOLS,
    ...TOOL_CATALOG_TOOLS,
    createExecuteDelegatedToolTool({
      runId,
      ...(deps.generateToolUseId !== undefined ? { generateToolUseId: deps.generateToolUseId } : {}),
      // Parsed, not validated: `createExecuteDelegatedToolTool` already rejects a non-finite or
      // non-positive value back to the default, so `NaN` from a malformed env var lands there too.
      ...(env[DELEGATED_TOOL_TIMEOUT_ENV_VAR] !== undefined
        ? { delegatedToolTimeoutMs: Number(env[DELEGATED_TOOL_TIMEOUT_ENV_VAR]) }
        : {}),
    }),
  ];

  // Absent credential => no `authHeaders` at all => byte-identical request headers to before this
  // env var existed. See DAEMON_TOKEN_ENV_VAR's doc for why an unset value is not a startup failure.
  const credential = env[DAEMON_TOKEN_ENV_VAR];
  const authHeaders =
    typeof credential === 'string' && credential.length > 0
      ? { Authorization: `Bearer ${credential}` }
      : undefined;

  const serverOptions: McpToolServerOptions = {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools,
    resources: KERNEL_RESOURCES,
    resolveBaseUrl,
    instructions: INSTRUCTIONS,
    ...(authHeaders !== undefined ? { authHeaders } : {}),
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.stdin !== undefined ? { stdin: deps.stdin } : {}),
    ...(deps.stdout !== undefined ? { stdout: deps.stdout } : {}),
  };

  try {
    await createMcpToolServerFn(serverOptions).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErr(`${SERVER_NAME}: ${message}\n`);
    return exit(1);
  }
}

// Only run for real when this module is the actual process entrypoint (`node dist/bin/serve.js`,
// or the `jini-mcp` bin shim pnpm/npm links to it) — not merely imported, e.g. by this file's own
// tests importing the named `serve` export above. Mirrors `@jini-ai/cli/main.ts`'s identical guard.
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await serve();
}
