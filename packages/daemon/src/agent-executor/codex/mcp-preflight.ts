import type { spawn as nodeSpawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { NativeCapabilities, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { createCommandInvocation } from '@jini-ai/platform/command';
import type { FailBeforeSpawn, McpBridgeDelivery, McpJsonServerEntry, PreparedCodexHome } from '../contracts.js';
import { JINI_MCP_SERVER_KEY } from '../mcp-bridge.js';
import { isRecord } from '../values.js';
import { codexInheritance } from './home-staging.js';
import { CodexMcpIsolationError, codexIsolationRefusalMessage } from './isolation.js';

/** Covers a cold cloud-bundle fetch, which `codex mcp list` makes with a 15 s timeout of its own. */
const CODEX_MCP_LIST_TIMEOUT_MS = 20_000;
/** A server list is a few KB; anything far larger is not one. */
const CODEX_MCP_LIST_MAX_BYTES = 1024 * 1024;

/**
 * Exec flags the `mcp list` loader honours too, copied verbatim and in order: `-c` overrides, and the
 * global feature toggles codex-rs `cli/src/main.rs` folds into the root `-c` overrides every
 * subcommand receives.
 */
const LOADER_VALUE_FLAGS = new Set(['-c', '--enable', '--disable']);
/** Exec-only flags that cannot change which MCP servers load: sandbox, model, writable dirs, images. */
const EXEC_ONLY_VALUE_FLAGS = new Set(['--sandbox', '--model', '--add-dir', '-i']);
const EXEC_ONLY_SWITCHES = new Set(['--json', '--skip-git-repo-check']);
/** `codex exec` loads config (project layers, trust) from `-C`; `codex mcp list` from its process cwd. */
const EXEC_CWD_FLAG = '-C';

function uncheckable(detail: string): CodexMcpIsolationError {
  return new CodexMcpIsolationError(`this run ${detail}, so its MCP servers can't be checked.`);
}

function isKnownValueFlag(flag: string): boolean {
  return LOADER_VALUE_FLAGS.has(flag) || EXEC_ONLY_VALUE_FLAGS.has(flag) || flag === EXEC_CWD_FLAG;
}

/** Only the flag name is quoted: an unknown `--x=value` value could be anything. */
function unknownArgument(token: string): CodexMcpIsolationError {
  return uncheckable(token.startsWith('-') ? `passes "${token.split('=')[0]}"` : 'passes an unexpected argument');
}

/** The flags between the exec subcommand and a resume's trailing SESSION_ID positional. */
function execFlags(execArgs: readonly string[]): readonly string[] {
  if (execArgs[0] !== 'exec') throw uncheckable("isn't a plain `codex exec`");
  if (execArgs[1] !== 'resume') return execArgs.slice(1);
  const sessionId = execArgs.at(-1);
  if (execArgs.length < 3 || sessionId === undefined || sessionId.startsWith('-')) throw uncheckable('resumes without a session id');
  return execArgs.slice(2, -1);
}

/**
 * `codex_apps` is a runtime-only server `mcp list` never shows (codex-rs `ext/mcp/src/lib.rs`, gated
 * by `features.apps`, key verified in `features/src/lib.rs` at rust-v0.151.0), so the list can only
 * vouch for a run whose last word on that feature is `-c features.apps=false`.
 */
function assertAppsOff(loaderArgs: readonly string[]): void {
  const appsSetting = loaderArgs.filter(value => /^features(\.apps)?\s*=/.test(value)).at(-1);
  if (appsSetting !== 'features.apps=false') throw new CodexMcpIsolationError("ChatGPT apps aren't turned off for this run, and Codex can't list them.");
}

/**
 * The `codex mcp list --json` argv and cwd that load config exactly as the given `codex exec` argv
 * does. Derived from that argv rather than built alongside it, so the two cannot drift: loader flags
 * are copied, exec-only flags dropped, and any flag this table does not know (a future
 * `--profile`, `--ignore-user-config`, a `--config=` spelling) fails closed.
 * @throws {@link CodexMcpIsolationError} for an argv it cannot mirror, or one that leaves apps on.
 * @complexity O(n) in the argv length.
 */
export function buildCodexMcpListArgs({ execArgs, cwd }: { readonly execArgs: readonly string[]; readonly cwd: string }): { args: string[]; cwd: string } {
  const flags = execFlags(execArgs);
  const loaderArgs: string[] = [];
  let listCwd = cwd;
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]!;
    if (EXEC_ONLY_SWITCHES.has(flag)) continue;
    const value = flags[i + 1];
    if (!isKnownValueFlag(flag) || value === undefined) throw unknownArgument(flag);
    i += 1;
    if (LOADER_VALUE_FLAGS.has(flag)) loaderArgs.push(flag, value);
    else if (flag === EXEC_CWD_FLAG) listCwd = resolve(cwd, value);
  }
  assertAppsOff(loaderArgs);
  return { args: ['mcp', ...loaderArgs, 'list', '--json'], cwd: listCwd };
}

type ListOutcome = { readonly kind: 'exit'; readonly code: number | null; readonly stdout: string } | { readonly kind: 'timeout' } | { readonly kind: 'error' };

/**
 * Spawns the list and collects stdout. stderr is drained, never read: Codex quotes config there, and
 * config holds MCP server tokens. A timeout or an oversized answer kills the child.
 * @complexity O(b) in the bytes read, capped at {@link CODEX_MCP_LIST_MAX_BYTES}.
 */
function runCodexMcpList({ invocation, cwd, env }: { invocation: ReturnType<typeof createCommandInvocation>; cwd: string; env: NodeJS.ProcessEnv },
  { spawn, timeoutMs }: { spawn: typeof nodeSpawn; timeoutMs: number }): Promise<ListOutcome> {
  return new Promise(settle => {
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawn(invocation.command, invocation.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: invocation.windowsVerbatimArguments });
    } catch {
      settle({ kind: 'error' });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const finish = (outcome: ListOutcome) => { clearTimeout(timer); settle(outcome); };
    const abort = (kind: 'timeout' | 'error') => { child.kill('SIGKILL'); finish({ kind }); };
    const timer = setTimeout(() => abort('timeout'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > CODEX_MCP_LIST_MAX_BYTES) abort('error');
      else chunks.push(chunk);
    });
    child.stderr?.resume();
    child.once('error', () => finish({ kind: 'error' }));
    child.once('close', (code: number | null) => finish({ kind: 'exit', code, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}

function listStdout(outcome: ListOutcome, timeoutMs: number): string {
  if (outcome.kind === 'timeout') throw new CodexMcpIsolationError(`Codex didn't list its MCP servers within ${timeoutMs / 1000} s.`);
  if (outcome.kind === 'error') throw new CodexMcpIsolationError("Codex couldn't list its MCP servers.");
  if (outcome.code !== 0) throw new CodexMcpIsolationError(`Codex couldn't list its MCP servers (exit code ${outcome.code ?? 'none'}).`);
  return outcome.stdout;
}

interface ListedServer { readonly name: string; readonly enabled: boolean; readonly transport?: unknown }

function isListedServer(value: unknown): value is ListedServer {
  return isRecord(value) && typeof value.name === 'string' && typeof value.enabled === 'boolean';
}

/** The `mcp list --json` entries (codex-rs `cli/src/mcp_cmd.rs` `run_list`); any other shape is refused. */
function parseCodexMcpList(stdout: string): readonly ListedServer[] {
  // No parser message: JSON.parse quotes its input, and the list prints server env unredacted.
  const unreadable = new CodexMcpIsolationError("Codex listed its MCP servers in a shape that can't be read.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw unreadable;
  }
  if (!Array.isArray(parsed) || !parsed.every(isListedServer)) throw unreadable;
  return parsed;
}

function sameArgs(listed: unknown, entry: McpJsonServerEntry): boolean {
  return Array.isArray(listed) && listed.length === entry.args.length && listed.every((arg, i) => arg === entry.args[i]);
}

/** `env_vars` forwards host variables by name; the staged bridge forwards none. */
function isEmptyList(listed: unknown): boolean {
  return listed == null || (Array.isArray(listed) && listed.length === 0);
}

function sameEnv(listed: unknown, entry: McpJsonServerEntry): boolean {
  const expected = Object.entries(entry.env).filter(([, value]) => typeof value === 'string');
  return isRecord(listed) && Object.keys(listed).length === expected.length && expected.every(([key, value]) => listed[key] === value);
}

/**
 * Whether the listed bridge is the one staged: a higher layer (a trusted project) out-ranks the
 * staged home key by key, so it could swap the command or inject env (`NODE_OPTIONS`) under the name.
 */
function isStagedBridge(transport: unknown, entry: McpJsonServerEntry): boolean {
  if (!isRecord(transport) || transport.type !== 'stdio' || transport.command !== entry.command) return false;
  return sameArgs(transport.args, entry) && sameEnv(transport.env, entry) && isEmptyList(transport.env_vars) && transport.cwd == null;
}

/** Refuses unless the only enabled server is the staged bridge. Reasons name servers, never their transport. */
function assertOnlyBridgeEnabled({ servers, entry }: { servers: readonly ListedServer[]; entry: McpJsonServerEntry }): void {
  const extra = servers.filter(server => server.enabled && server.name !== JINI_MCP_SERVER_KEY).map(server => JSON.stringify(server.name));
  if (extra.length > 0) throw new CodexMcpIsolationError(`another Codex config turns on the MCP server${extra.length > 1 ? 's' : ''} ${extra.join(', ')}.`);
  const bridge = servers.find(server => server.enabled && server.name === JINI_MCP_SERVER_KEY);
  if (!bridge || !isStagedBridge(bridge.transport, entry)) throw new CodexMcpIsolationError(`another Codex config changes Jini's own "${JINI_MCP_SERVER_KEY}" MCP server.`);
}

/**
 * Codex with personal MCP off: before the run, asks the Codex binary which MCP servers this exact run
 * would load, through `codex mcp list --json` spawned with the run's own launch path, invocation
 * builder, staged `CODEX_HOME` env, config cwd and loader flags. The binary resolves every layer
 * (system, MDM, cloud bundle, trusted project, plugin), so Jini mirrors none of them. Anything but
 * the staged bridge enabled, a failed or slow list, or an argv it can't mirror refuses the run.
 * A no-op for every other run. The staged home's own checks stay as the first line.
 * @throws Through `failBeforeSpawn` (`NATIVE_TOOL_POLICY_UNSUPPORTED`) after releasing staged resources.
 * @complexity O(n + s) in the argv length and listed servers, plus one child process (≤ 20 s).
 */
export async function preflightCodexMcpIsolationIfNeeded({ input, deps }: {
  readonly input: {
    readonly runId: string; readonly def: RuntimeAgentDef; readonly nativeToolAccess?: boolean | undefined;
    readonly nativeCapabilities?: Partial<NativeCapabilities>; readonly mcpBridge: McpBridgeDelivery | null;
    readonly stagedHome: PreparedCodexHome | null; readonly launchPath: string; readonly args: readonly string[];
    readonly env: NodeJS.ProcessEnv; readonly cwd: string;
  };
  readonly deps: {
    readonly createCommandInvocation: typeof createCommandInvocation; readonly spawn: typeof nodeSpawn;
    readonly releaseStagedResources: () => Promise<void>; readonly failBeforeSpawn: FailBeforeSpawn;
  };
}, optional: { readonly timeoutMs?: number } = {}): Promise<void> {
  const bridge = input.mcpBridge;
  if (input.def.id !== 'codex' || bridge?.kind !== 'codex-toml' || input.stagedHome === null || codexInheritance(input).mcp) return;
  const timeoutMs = optional.timeoutMs ?? CODEX_MCP_LIST_TIMEOUT_MS;
  try {
    const list = buildCodexMcpListArgs({ execArgs: input.args, cwd: input.cwd });
    const invocation = deps.createCommandInvocation({ command: input.launchPath, args: list.args, env: input.env });
    const outcome = await runCodexMcpList({ invocation, cwd: list.cwd, env: input.env }, { spawn: deps.spawn, timeoutMs });
    assertOnlyBridgeEnabled({ servers: parseCodexMcpList(listStdout(outcome, timeoutMs)), entry: bridge.serverEntry });
  } catch (err) {
    await deps.releaseStagedResources();
    const reason = err instanceof CodexMcpIsolationError ? err.message : "Codex couldn't list its MCP servers.";
    return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED', message: codexIsolationRefusalMessage(reason) });
  }
}
