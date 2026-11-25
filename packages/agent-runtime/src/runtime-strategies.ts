/** @file The vendor behaviour a runtime hands the daemon for one definition, as `AgentRuntimePort['strategies']`.
 * The daemon asks for it by definition and never names a CLI: a dialect or a delivery strategy the definition already
 * declares (`eventParser`, `externalMcpInjection`) selects the implementation here, in the one package that owns vendors. */
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AtomicFileWriterPort, FileLockPort } from '@jini-ai/core/contracts/runtime';
import { ensureAntigravityMcpPermission, prepareAntigravityBridge } from './defs/antigravity/permissions.js';
import { CLAUDE_CONFIG_DIR_ENV, stageClaudeConfigDir } from './defs/claude/config-dir.js';
import { claudeFilesystemAdapter } from './defs/claude/filesystem.js';
import { prepareClaudeHttpMcpConfig } from './defs/claude/mcp-config.js';
import { buildClaudeMcpDelivery, writeMcpJsonForRun } from './defs/claude/mcp-delivery.js';
import { prepareClaudeSubagentStartSettings } from './defs/claude/subagent-start.js';
import { AMR_OPENCODE_BIN_ENV } from './defs/amr/executable-env.js';
import { geminiToolCallReceipt } from './defs/gemini/tool-calls.js';
import { OPENCODE_CONFIG_ENV } from './defs/opencode/constants.js';
import { openCodeToolCallReceipt } from './defs/opencode/tool-calls.js';
import { MIMO_CONFIG_ENV } from './defs/mimo/constants.js';
import { mergeEnvContentInstructions, mergeEnvContentMcpConfig, withOpenCodeHttpMcp } from './defs/opencode/mcp-config.js';

/** Structurally the daemon port's `AgentRuntimeStrategies['mcpBridge']`; the host checks the binding against that port. */
type McpBridgeSlot = { prepare(required: { delivery: { readonly kind: string } | null; serverName: string; fileLock: FileLockPort; writer: AtomicFileWriterPort }): Promise<void> };

type EnvContentSlot = { mergeMcp: typeof mergeEnvContentMcpConfig };
type InstructionsDocumentSlot = { merge: typeof mergeEnvContentInstructions };

/** Structurally the daemon port's `AgentRuntimeStrategies['filesystem' | 'configDir' | 'mcpConfigFile' | 'subagentStart']`; the host checks each binding against that port. */
type FilesystemSlot = { prepare?: typeof claudeFilesystemAdapter.prepare; unsupported?: typeof claudeFilesystemAdapter.unsupported; supported: typeof claudeFilesystemAdapter.supported };
type ConfigDirSlot = { readonly envKey: string; stage: (required: { runId: string; hostEnv: NodeJS.ProcessEnv }, optional?: { seams?: NonNullable<Parameters<typeof stageClaudeConfigDir>[1]>['seams'] }) => ReturnType<typeof stageClaudeConfigDir> };
type McpConfigFileSlot = { build: typeof buildClaudeMcpDelivery; write: typeof writeMcpJsonForRun; prepareHttp: typeof prepareClaudeHttpMcpConfig };
type SubagentStartSlot = { prepare: typeof prepareClaudeSubagentStartSettings };

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

/** Keyed by the declared MCP delivery strategy, like the variable above: both CLIs read one OpenCode-schema document. */
const ENV_CONTENT_BY_STRATEGY: ReadonlyMap<string, EnvContentSlot> = new Map([
  ['opencode-env-content', { mergeMcp: mergeEnvContentMcpConfig }],
  ['mimo-env-content', { mergeMcp: mergeEnvContentMcpConfig }],
]);

/** Keyed by the declared system-prompt delivery strategy: it is a def's own declaration, independent of how its MCP bridge is delivered. */
const INSTRUCTIONS_DOCUMENT_BY_STRATEGY: ReadonlyMap<string, InstructionsDocumentSlot> = new Map([
  ['config-instructions-file', { merge: mergeEnvContentInstructions }],
]);

/** Keyed by definition id: the HTTP endpoint rides the inline document only for the CLIs that read it from there, so the
 * shared delivery strategy (also declared by the Mimo definition, which does not take it) is not enough to select it. */
const HTTP_MCP_ENV_BY_ID: ReadonlyMap<string, typeof withOpenCodeHttpMcp> = new Map([
  ['opencode', withOpenCodeHttpMcp],
  ['opencode-acp', withOpenCodeHttpMcp],
]);

/** Claude's folder-limit policy applies to every definition whose probe reports support; its temp and degrade steps are Claude's own. */
const FILESYSTEM_BY_ID: ReadonlyMap<string, FilesystemSlot> = new Map([['claude', claudeFilesystemAdapter]]);
const SHARED_FILESYSTEM_SLOT: FilesystemSlot = { supported: claudeFilesystemAdapter.supported };

/** Keyed by definition id, not by the shared `claude-mcp-json` delivery: isolating the operator's own config is the real CLI's concern, not `codebuddy`'s. */
const CONFIG_DIR_BY_ID: ReadonlyMap<string, ConfigDirSlot> = new Map([['claude', { envKey: CLAUDE_CONFIG_DIR_ENV, stage: stageClaudeConfigDir }]]);
/** Keyed by the declared `subagentStartHook`: a definition that says its CLI fires a SubagentStart hook gets the settings that register one. */
const SUBAGENT_START: SubagentStartSlot = { prepare: prepareClaudeSubagentStartSettings };

/** Keyed by the declared `externalMcpInjection` strategy, which `codebuddy` shares with `claude`. */
const MCP_CONFIG_FILE_BY_STRATEGY: ReadonlyMap<string, McpConfigFileSlot> = new Map([
  ['claude-mcp-json', { build: buildClaudeMcpDelivery, write: writeMcpJsonForRun, prepareHttp: prepareClaudeHttpMcpConfig }],
]);

/** Env names the launcher must copy from the host env besides the runtime state's own (`launch.hostEnvNames`).
 * `CLAUDE_CONFIG_DIR` is not in the child baseline env, but the staging step reads the operator's real value from the host env. */
export const RUNTIME_STRATEGY_HOST_ENV_NAMES: readonly string[] = [AMR_OPENCODE_BIN_ENV, CLAUDE_CONFIG_DIR_ENV];

type StrategyDef = Pick<RuntimeAgentDef, 'id' | 'eventParser' | 'externalMcpInjection' | 'systemPromptDelivery' | 'subagentStartHook'>;

/** The slots a definition's own declarations select (dialect, MCP delivery strategy, system-prompt strategy). */
function declaredSlots({ def }: { def: StrategyDef }, _optional: Record<string, never> = {}) {
  const toolCallReceipt = def.eventParser === undefined ? undefined : RECEIPT_BY_DIALECT.get(def.eventParser);
  const envContentVar = def.externalMcpInjection === undefined ? undefined : ENV_CONTENT_VAR_BY_STRATEGY.get(def.externalMcpInjection);
  const envContent = def.externalMcpInjection === undefined ? undefined : ENV_CONTENT_BY_STRATEGY.get(def.externalMcpInjection);
  const instructionsDocument = def.systemPromptDelivery === undefined ? undefined : INSTRUCTIONS_DOCUMENT_BY_STRATEGY.get(def.systemPromptDelivery.strategy);
  return {
    ...(toolCallReceipt ? { toolCallReceipt } : {}),
    ...(envContentVar ? { mcpDelivery: { envContentVar } } : {}),
    ...(envContent ? { envContent } : {}),
    ...(instructionsDocument ? { instructionsDocument } : {}),
  };
}

/** The claude-shaped staging slots a definition is bound to; each key is present only when bound. */
function stagingSlotsForDef({ def }: { def: StrategyDef }, _optional: Record<string, never> = {}) {
  const configDir = CONFIG_DIR_BY_ID.get(def.id);
  const subagentStart = def.subagentStartHook === true ? SUBAGENT_START : undefined;
  const mcpConfigFile = def.externalMcpInjection === undefined ? undefined : MCP_CONFIG_FILE_BY_STRATEGY.get(def.externalMcpInjection);
  return {
    ...(configDir ? { configDir } : {}),
    ...(subagentStart ? { subagentStart } : {}),
    ...(mcpConfigFile ? { mcpConfigFile } : {}),
  };
}

/** The slots bound to one CLI by definition id, where a shared declared strategy is not enough to select them.
 * Except the shared folder-limit policy, which is bound for every definition (see `SHARED_FILESYSTEM_SLOT`). */
function idSlots({ def }: { def: Pick<RuntimeAgentDef, 'id'> }, _optional: Record<string, never> = {}) {
  const mcpBridge = MCP_BRIDGE_BY_ID.get(def.id);
  const httpMcpEnv = HTTP_MCP_ENV_BY_ID.get(def.id);
  return { filesystem: FILESYSTEM_BY_ID.get(def.id) ?? SHARED_FILESYSTEM_SLOT, ...(mcpBridge ? { mcpBridge } : {}), ...(httpMcpEnv ? { httpMcpEnv } : {}) };
}

/** Strategies for one definition. O(1): a handful of map lookups. A definition that declares nothing gets `{}`
 * (plus the shared folder-limit policy, see `idSlots`). */
export function strategiesForDef({ def }: { def: StrategyDef }, _optional: Record<string, never> = {}) {
  return { ...declaredSlots({ def }), ...stagingSlotsForDef({ def }), ...idSlots({ def }) };
}
