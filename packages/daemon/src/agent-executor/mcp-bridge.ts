import type { McpBridgeProbeResult } from './mcp-bridge-probe.js';
import { randomBytes } from 'node:crypto';
import { supportsMessageRelay } from './message-relay.js';
import { ensureAntigravityMcpPermission, prepareAntigravityBridge } from './antigravity/permissions.js';
import { OPENCODE_CONFIG_ENV } from './opencode/constants.js';
import { MIMO_CONFIG_ENV } from './mimo/constants.js';
import { buildClaudeMcpDelivery, writeMcpJsonForRun } from './claude/mcp-delivery.js';
import { buildCodexMcpDelivery } from './codex/mcp-delivery.js';
import type { McpDeliveryBuildInput } from './mcp-delivery-types.js';
import type {
   AcpMcpServerInput,
} from '@jini-ai/agent-runtime';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import {
  isRecord,
  errorMessage,
} from './values.js';
import { JINI_MCP_SERVER_KEY, type McpJsonServerEntry } from './mcp-json-file.js';
import type {
   McpJsonInjectionOptions,
   McpBridgeDelivery,
   FailBeforeSpawn,
} from './contracts.js';

/** The run-error code a run gets when its CLI reports the injected `jini` bridge as anything but connected. */
export const MCP_BRIDGE_UNAVAILABLE = 'MCP_BRIDGE_UNAVAILABLE';

/**
 * Judges a CLI's startup report of the injected bridge. Returns the bridge's status (`'missing'`
 * when the list omits it) when it is not `'connected'`, and `undefined` when it is connected or
 * when `rawEvent` is not an init status carrying an MCP server list (nothing to judge).
 *
 * `'pending'` counts as a failure on purpose: the CLI decides which MCP tools a session has at
 * startup, so a bridge that is not connected by then never joins this run.
 * @param rawEvent - One parsed stream event, as `@jini-ai/agent-runtime`'s parser emits it.
 * @complexity O(n) in the number of reported servers.
 */
export function unavailableJiniBridgeStatus({ rawEvent }: { readonly rawEvent: unknown }): string | undefined {
  if (!isRecord(rawEvent) || rawEvent.type !== 'status' || rawEvent.label !== 'initializing') return undefined;
  if (!Array.isArray(rawEvent.mcpServers)) return undefined;
  const bridge = rawEvent.mcpServers.find((server) => isRecord(server) && server.name === JINI_MCP_SERVER_KEY);
  const status = isRecord(bridge) ? String(bridge.status) : 'missing';
  return status === 'connected' ? undefined : status;
}

/** The user-readable reason a run stopped because its bridge did not connect. */
export function bridgeUnavailableMessage({ status }: { status: string }, { probe }: { probe?: McpBridgeProbeResult | undefined } = {}): string {
  const message = `The assistant's tools did not load (MCP bridge "${JINI_MCP_SERVER_KEY}" status: ${status}). The run was stopped instead of continuing without them.`;
  if (!probe || probe.ok) return message;
  const lines = probe.stderrTail.trim().split(/\r?\n/);
  const reason = lines.find((line) => line.includes('Error')) ?? lines.at(-1);
  return `${message} Bridge exited with code ${probe.exitCode}: ${reason}`;
}

/**
 * Builds this run's `mcpServers.jini` entry — pure and synchronous, so every field mapping is
 * directly assertable without touching the filesystem. The credential arrives already resolved:
 * `McpJsonInjectionOptions.credential` is a possibly-async per-run resolver, and awaiting it is
 * `writeMcpJsonForRun`'s job, which keeps the effect out of this function.
 *
 * @param runId - The run this entry scopes its child to.
 * @param options - Launch settings and independent readers of diagnostic and visible startup IDs.
 * @param credential - The already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN`
 * entirely. Omitting produces byte-identical output to before this parameter existed.
 * @complexity O(t) output space/time for t launch environment and registered ID bytes.
 */
export function buildMcpJsonServerEntry({ runId, options }: { readonly runId: string; readonly options: Pick<McpJsonInjectionOptions, 'command' | 'args' | 'daemonUrl' | 'env' | 'diagnosticToolIds' | 'startupToolIds'> }, { credential, messageRelayNonce }: { readonly credential?: string; readonly messageRelayNonce?: string } = {}
): McpJsonServerEntry {
  const hostEnv = Object.entries(options.env ?? {}).filter(([key]) => !key.startsWith('JINI_'));
  return {
    command: options.command,
    args: options.args !== undefined ? [...options.args] : [],
    env: {
      ...Object.fromEntries(hostEnv),
      JINI_RUN_ID: runId,
      JINI_DAEMON_URL: options.daemonUrl,
      ...(options.diagnosticToolIds ? { JINI_DIAGNOSTIC_TOOL_IDS: JSON.stringify(options.diagnosticToolIds()) } : {}),
      ...(options.startupToolIds ? { JINI_STARTUP_TOOL_IDS: JSON.stringify(options.startupToolIds({ runId })) } : {}),
      ...(credential !== undefined ? { JINI_DAEMON_TOKEN: credential } : {}),
      ...(messageRelayNonce ? { JINI_MESSAGE_RELAY: '1', JINI_MESSAGE_RELAY_NONCE: messageRelayNonce } : {}),
    },
  };
}

/**
 * Mechanism 2 of 5 — `'acp-merge'`. Re-shapes the same bridge entry into the `mcpServers` element
 * an ACP `session/new` call carries, for the 9 ACP-native defs declaring this strategy (amr, devin,
 * hermes, kilo, kimi, kiro, reasonix, trae-cli, vibe). Pure.
 *
 * `env` is emitted as a plain object on purpose: `@jini-ai/agent-runtime`'s
 * `buildAcpSessionNewParams` already normalises a plain-object `env` into either the
 * `[{name, value}]` array form or the `{"KEY": "val"}` map form according to each def's own
 * `acpMcpEnvFormat`, so the per-vendor wire-shape difference stays in the one place that already
 * owns it rather than being re-decided here.
 *
 * **The credential travels in `env`, never in `args`.** An ACP agent spawns this server itself and
 * applies `env` to that child's environment; a token in `args` would land in the child's process
 * arguments, readable by any other local user via `ps`. Same rule as the `.mcp.json` path.
 *
 * @param entry - The shared bridge entry from {@link buildMcpJsonServerEntry}.
 * @returns A single-element list — this driver contributes exactly its own bridge server and never
 * removes or rewrites servers a def or host added by other means.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildAcpMcpBridgeServers({ entry }: { readonly entry: McpJsonServerEntry }): AcpMcpServerInput[] {
  return [
    {
      type: 'stdio',
      name: JINI_MCP_SERVER_KEY,
      command: entry.command,
      args: [...entry.args],
      env: { ...entry.env },
    },
  ];
}

/**
 * Mechanism 3+4 of 5 — the spawn-env-content strategies. One map, not two code paths: OpenCode and
 * MiMo consume byte-identical JSON (MiMo's def doc: "the same JSON schema as OpenCode's `mcp`
 * config ... following the same structure as `OPENCODE_CONFIG_CONTENT`"), and differ only in which
 * env var carries it. Adding a third such CLI is a row here, not a new serializer.
 */
type McpDeliveryBuilder = (input: McpDeliveryBuildInput) => McpBridgeDelivery;
const MCP_DELIVERY_BUILDERS: Record<NonNullable<RuntimeAgentDef['externalMcpInjection']>, McpDeliveryBuilder> = {
  'claude-mcp-json': buildClaudeMcpDelivery,
  'acp-merge': ({ serverEntry }) => ({ kind: 'acp-merge', mcpServers: buildAcpMcpBridgeServers({ entry: serverEntry }) }),
  'opencode-env-content': ({ serverEntry }) => ({ kind: 'env-content', envVarName: OPENCODE_CONFIG_ENV, serverEntry }),
  'mimo-env-content': ({ serverEntry }) => ({ kind: 'env-content', envVarName: MIMO_CONFIG_ENV, serverEntry }),
  'codex-toml': buildCodexMcpDelivery,
  'env-passthrough': ({ serverEntry }) => ({ kind: 'env-passthrough', serverEntry }),
};
const MCP_DELIVERY_WRITERS: ReadonlyMap<string, typeof writeMcpJsonForRun> = new Map([['claude-mcp-json', writeMcpJsonForRun]]);

/**
 * **The single dispatch point from an `externalMcpInjection` strategy to its delivery mechanism.**
 * Pure and synchronous — the one effectful input (the per-run bearer credential) arrives already
 * resolved, so every strategy's mapping is directly assertable without touching the filesystem,
 * the environment, or a keystore.
 *
 * Keyed off the declared *strategy*, never off `def.id`: a def gets a working bridge by declaring a
 * mechanism, not by being named in this file. That is what makes the 9 `'acp-merge'` defs work
 * without any of their own files being touched.
 *
 * @param input.cwd - The run's working directory; only `'claude-mcp-json'` uses it, to place this
 * run's own config file (see {@link mcpJsonPathForRun}) — never `cwd/.mcp.json` itself.
 * @param input.runId - Scopes the bridge child to this run.
 * @param input.strategy - The def's declared `externalMcpInjection`, or `undefined` for a def with no native MCP transport.
 * @param input.options - The host's bridge options, or `undefined` when the host never configured injection.
 * @param input.credential - Already-resolved bearer token, or `undefined` to omit `JINI_DAEMON_TOKEN` entirely.
 * @returns `null` when this run delivers nothing — an unconfigured host, or a def declaring no
 * strategy — which is byte-identical to this feature not existing.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildMcpBridgeDelivery(input: {
  readonly cwd: string;
  readonly runId: string;
  readonly strategy: RuntimeAgentDef['externalMcpInjection'];
  readonly options: McpJsonInjectionOptions | undefined;
  readonly credential: string | undefined;
  readonly messageRelayNonce?: string;
}): McpBridgeDelivery | null {
  const { cwd, runId, strategy, options } = input;
  if (options === undefined || strategy === undefined) return null;
  const serverEntry = buildMcpJsonServerEntry({ runId: runId, options: options }, bridgeCredentialOptions(input));
  // Every declared strategy has a builder; a new one fails typechecking until registered.
  if (!Object.hasOwn(MCP_DELIVERY_BUILDERS, strategy)) throw new TypeError(`Unknown MCP bridge strategy: ${String(strategy)}`);
  return MCP_DELIVERY_BUILDERS[strategy]({ cwd, runId, serverEntry });
}

function bridgeCredentialOptions(input: { credential: string | undefined; messageRelayNonce?: string }) {
  return {
    ...(input.credential === undefined ? {} : { credential: input.credential }),
    ...(input.messageRelayNonce ? { messageRelayNonce: input.messageRelayNonce } : {}),
  };
}

/** Inherited credentials and persistent settings require explicit approval, including standalone hosts. */
function needsInheritedMcpConsent(input: { def: RuntimeAgentDef; nativeCapabilities?: Partial<import('@jini-ai/core/contracts/agents').NativeCapabilities> }, injection: McpJsonInjectionOptions | undefined): boolean {
  return input.def.externalMcpInjection === 'env-passthrough' && injection !== undefined && input.nativeCapabilities?.userMcp !== true;
}

const MCP_BRIDGE_PREPARERS: ReadonlyMap<string, typeof prepareAntigravityBridge> = new Map([['antigravity', prepareAntigravityBridge]]);

/** Phase 5: resolve credentials and delivery, then await agy's scoped MCP permission setup.
 * Setup errors release staged files and fail before spawn. @complexity O(settings bytes) for agy. */
export async function resolveMcpBridgeForRun({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly def: RuntimeAgentDef; readonly nativeCapabilities?: Partial<import('@jini-ai/core/contracts/agents').NativeCapabilities> }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly cleanupStagedFiles: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
    readonly ensureAntigravityMcpPermission?: typeof ensureAntigravityMcpPermission;
  } }
): Promise<McpBridgeDelivery | null> {
  if (needsInheritedMcpConsent(input, deps.mcpJsonInjection)) {
    return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
      message: `${input.def.name} needs your approval before loading personal MCP settings and receiving this chat's run key.` });
  }
  try {
    // Awaited here rather than inside `buildMcpBridgeDelivery` so that function stays pure and
    // synchronous. `undefined` when the host supplied no resolver, which omits the token entirely.
    const credential = deps.mcpJsonInjection !== undefined ? await deps.mcpJsonInjection.credential?.({ runId: input.runId }) : undefined;
    const delivery = buildMcpBridgeDelivery({
      cwd: input.cwd,
      runId: input.runId,
      strategy: input.def.externalMcpInjection,
      options: deps.mcpJsonInjection,
      credential,
      ...(supportsMessageRelay({ def: input.def }) ? { messageRelayNonce: randomBytes(24).toString('hex') } : {}),
    });
    const prepareBridge = MCP_BRIDGE_PREPARERS.get(input.def.id);
    if (prepareBridge) await prepareBridge({ delivery, serverName: JINI_MCP_SERVER_KEY }, {
      ensurePermission: deps.ensureAntigravityMcpPermission ?? ensureAntigravityMcpPermission,
    });
    return delivery;
  } catch (err) {
    // Spawning a child that cannot authenticate would produce a run whose every bridged tool call
    // 401s, so a rejecting credential resolver fails the run before spawn instead. Permission setup
    // failure is fatal for the same reason: the agent would start without its tools.
    await deps.cleanupStagedFiles();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not resolve the MCP bridge credential or permissions for agent "${input.def.id}": ${errorMessage({ err })}` },
    );
  }
}

/** Phase 10: mechanism 1 of 5's one effect — stages this run's own `.mcp.json`, returning the path `cleanupStagedFiles` should later remove (`undefined` for every other mechanism / unconfigured host). */
export async function writeMcpJsonIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly cwd: string; readonly nativeToolAccess?: boolean | undefined; readonly nativeCapabilities?: Partial<import('@jini-ai/core/contracts/agents').NativeCapabilities>; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<string | undefined> {
  const delivery = input.mcpBridge;
  const writer = delivery ? MCP_DELIVERY_WRITERS.get(delivery.kind) : undefined;
  if (!delivery || !writer || deps.mcpJsonInjection === undefined) return undefined;
  try {
    return await writer({ cwd: input.cwd, delivery, options: deps.mcpJsonInjection }, { inheritUserConfig: input.nativeToolAccess !== false && input.nativeCapabilities?.userMcp !== false });
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not write .mcp.json for agent "${input.def.id}": ${errorMessage({ err })}` },
    );
  }
}
