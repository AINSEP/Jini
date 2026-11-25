/** @file The vendor behaviour a runtime hands the daemon for one definition, as `AgentRuntimePort['strategies']`.
 * The daemon asks for it by definition and never names a CLI: a dialect or a delivery strategy the definition already
 * declares (`eventParser`, `externalMcpInjection`) selects the implementation here, in the one package that owns vendors. */
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import { AMR_OPENCODE_BIN_ENV } from './defs/amr/executable-env.js';
import { geminiToolCallReceipt } from './defs/gemini/tool-calls.js';
import { OPENCODE_CONFIG_ENV } from './defs/opencode/constants.js';
import { openCodeToolCallReceipt } from './defs/opencode/tool-calls.js';
import { MIMO_CONFIG_ENV } from './defs/mimo/constants.js';

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

/** Env names the launcher must copy from the host env besides the runtime state's own (`launch.hostEnvNames`). */
export const RUNTIME_STRATEGY_HOST_ENV_NAMES: readonly string[] = [AMR_OPENCODE_BIN_ENV];

/** Strategies for one definition. O(1): two map lookups. A definition that declares nothing gets `{}`. */
export function strategiesForDef({ def }: { def: Pick<RuntimeAgentDef, 'eventParser' | 'externalMcpInjection'> }, _optional: Record<string, never> = {}) {
  const toolCallReceipt = def.eventParser === undefined ? undefined : RECEIPT_BY_DIALECT.get(def.eventParser);
  const envContentVar = def.externalMcpInjection === undefined ? undefined : ENV_CONTENT_VAR_BY_STRATEGY.get(def.externalMcpInjection);
  return {
    ...(toolCallReceipt ? { toolCallReceipt } : {}),
    ...(envContentVar ? { mcpDelivery: { envContentVar } } : {}),
  };
}
