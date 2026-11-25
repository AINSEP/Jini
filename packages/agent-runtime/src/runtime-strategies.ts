/** @file The vendor behaviour a runtime hands the daemon for one definition, as `AgentRuntimePort['strategies']`.
 * The daemon asks for it by definition and never names a CLI: a dialect or a delivery strategy the definition already
 * declares (`eventParser`, `externalMcpInjection`) selects the implementation here, in the one package that owns vendors. */
import type { NativeCapabilities, RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import { ensureAntigravityMcpPermission, prepareAntigravityBridge } from './defs/antigravity/permissions.js';
import { buildCodexMcpDelivery } from './defs/codex/mcp-delivery.js';
import { CODEX_HOME_ENV, codexTurnsOffPersonalConfig, stageCodexHome, withStagedCodexHome } from './defs/codex/home-staging.js';
import { AMR_OPENCODE_BIN_ENV } from './defs/amr/executable-env.js';
import { geminiToolCallReceipt } from './defs/gemini/tool-calls.js';
import { OPENCODE_CONFIG_ENV } from './defs/opencode/constants.js';
import { openCodeToolCallReceipt } from './defs/opencode/tool-calls.js';
import { MIMO_CONFIG_ENV } from './defs/mimo/constants.js';

/** Structurally the daemon port's `AgentRuntimeStrategies['mcpBridge']`; the host checks the binding against that port. */
type McpBridgeSlot = { prepare(required: { delivery: { readonly kind: string } | null; serverName: string; fileLock: FileLockPort; writer: AtomicFileWriterPort }): Promise<void> };

/** Structurally the daemon port's `AgentRuntimeStrategies['mcpHome']`; the host checks the binding against that port. */
type McpHomeSlot = {
  readonly envVar: string;
  buildDelivery<E>(required: { serverEntry: E }): { readonly kind: 'codex-toml'; readonly serverEntry: E };
  withStagedHome(required: { env: NodeJS.ProcessEnv; homeDir: string }): NodeJS.ProcessEnv;
  turnsOffPersonalConfig(required: { nativeCapabilities?: Partial<NativeCapabilities> }): boolean;
  stage: typeof stageCodexHome;
};

type ToolCallReceipt = (required: { event: Record<string, unknown> }) => Record<string, unknown>;

/** Keyed by the stream dialect (`RuntimeAgentDef.eventParser`) that `json-event-stream.ts` already dispatches on. A
 * dialect is not a CLI: any definition declaring it gets the receipt. */
const RECEIPT_BY_DIALECT: ReadonlyMap<string, ToolCallReceipt> = new Map([
  ['legacy-google-stream-json', geminiToolCallReceipt],
  ['opencode', openCodeToolCallReceipt],
]);

/** Keyed by the declared MCP delivery strategy; the daemon serialises one config document into the named variable. */
const ENV_CONTENT_VAR_BY_STRATEGY: ReadonlyMap<string, string> = new Map([
  ['opencode-env-content', OPENCODE_CONFIG_ENV],
  ['mimo-env-content', MIMO_CONFIG_ENV],
]);

/** Keyed by definition id: the bridge preparation writes the one CLI's own settings file, so a shared
 * declared strategy (`env-passthrough`) is not enough to select it. */
const MCP_BRIDGE_BY_ID: ReadonlyMap<string, McpBridgeSlot> = new Map([
  ['antigravity', { prepare: (required) => prepareAntigravityBridge(required, { ensurePermission: ensureAntigravityMcpPermission }) }],
]);

/** Keyed by the declared `externalMcpInjection` strategy, as the delivery already is: the strategy names the staged-home mechanism. */
const MCP_HOME_BY_STRATEGY: ReadonlyMap<string, McpHomeSlot> = new Map([
  ['codex-toml', {
    envVar: CODEX_HOME_ENV,
    buildDelivery: buildCodexMcpDelivery,
    withStagedHome: ({ env, homeDir }) => withStagedCodexHome({ env, codexHomeDir: homeDir }),
    turnsOffPersonalConfig: codexTurnsOffPersonalConfig,
    stage: stageCodexHome,
  }],
]);

/** Env names the launcher must copy from the host env besides the runtime state's own (`launch.hostEnvNames`). */
export const RUNTIME_STRATEGY_HOST_ENV_NAMES: readonly string[] = [AMR_OPENCODE_BIN_ENV, CODEX_HOME_ENV];

/** Strategies for one definition. O(1): three map lookups. A definition that declares nothing gets `{}`. */
export function strategiesForDef({ def }: { def: Pick<RuntimeAgentDef, 'id' | 'eventParser' | 'externalMcpInjection'> }, _optional: Record<string, never> = {}) {
  const toolCallReceipt = def.eventParser === undefined ? undefined : RECEIPT_BY_DIALECT.get(def.eventParser);
  const envContentVar = def.externalMcpInjection === undefined ? undefined : ENV_CONTENT_VAR_BY_STRATEGY.get(def.externalMcpInjection);
  const mcpBridge = MCP_BRIDGE_BY_ID.get(def.id);
  const mcpHome = def.externalMcpInjection === undefined ? undefined : MCP_HOME_BY_STRATEGY.get(def.externalMcpInjection);
  return {
    ...(toolCallReceipt ? { toolCallReceipt } : {}),
    ...(envContentVar ? { mcpDelivery: { envContentVar } } : {}),
    ...(mcpBridge ? { mcpBridge } : {}),
    ...(mcpHome ? { mcpHome } : {}),
  };
}
