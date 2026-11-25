import type { AgentRuntimeStrategies } from '../ports/agent-runtime.js';

/** Apply the receipt dialect the runtime bound to this definition once; raw events and tools from other CLIs pass
 * unchanged. The daemon never inspects which CLI it is: an absent slot means "no dialect".
 * Folding stays in chat's existing shared rule. O(1) construction, O(name length) per receipt. */
export function createCliToolCallReceiver({ strategy, onEvent }: {
  strategy: Pick<AgentRuntimeStrategies, 'toolCallReceipt'>; onEvent: (event: Record<string, unknown>) => void;
}, _options = {}): (event: Record<string, unknown>) => void {
  const adapt = strategy.toolCallReceipt;
  return event => onEvent(adapt ? adapt({ event }) : event);
}
