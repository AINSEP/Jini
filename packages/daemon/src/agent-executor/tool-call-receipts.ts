import type { AgentRuntimeStrategies } from '../ports/agent-runtime.js';

/** Select the CLI's receipt dialect once; raw events and tools from other CLIs pass unchanged.
 * Folding stays in chat's existing shared rule. O(1) construction, O(name length) per receipt.
 * The dialect is the runtime binding's to choose (`strategy.toolCallReceipt`); an absent slot means "no dialect". */
export function createCliToolCallReceiver({ strategy, onEvent }: {
  strategy: Pick<AgentRuntimeStrategies, 'toolCallReceipt'>; onEvent: (event: Record<string, unknown>) => void;
}, _options = {}): (event: Record<string, unknown>) => void {
  const adapt = strategy.toolCallReceipt;
  return event => onEvent(adapt ? adapt({ event }) : event);
}
