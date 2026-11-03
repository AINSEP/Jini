import { geminiToolCallReceipt } from './gemini/tool-calls.js';
import { openCodeToolCallReceipt } from './opencode/tool-calls.js';

/** Select the CLI's receipt dialect once; raw events and tools from other CLIs pass unchanged.
 * Folding stays in chat's existing shared rule. O(1) construction, O(name length) per receipt. */
export function createCliToolCallReceiver({ kind, onEvent }: {
  kind: string; onEvent: (event: Record<string, unknown>) => void;
}, _options = {}): (event: Record<string, unknown>) => void {
  const adapt = kind === 'legacy-google-stream-json' ? geminiToolCallReceipt : kind === 'opencode' ? openCodeToolCallReceipt : undefined;
  return event => onEvent(adapt ? adapt({ event }, {}) : event);
}
