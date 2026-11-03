import { setTimeout } from 'node:timers/promises';
import type { McpToolDef } from '../tool-protocol.js';

/** A bounded, cancellable pause shared by all MCP clients; no daemon call or shell process.
 * Long poll intervals use several calls, allowing the agent to check messages between waits. */
export const waitTool: McpToolDef = {
  name: 'wait_for',
  description: 'Wait before polling a pending background job again. Pass seconds from poll_after_seconds, up to 60 per call; repeat for longer intervals. Returns waitedSeconds after the pause. Cancellation stops the timer. Use this instead of Bash or shell sleep. This tool does not check job status.',
  inputSchema: { type: 'object', required: ['seconds'], additionalProperties: false,
    properties: { seconds: { type: 'number', minimum: 0, maximum: 60 } } },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler({ args, ctx }) {
    // handleToolCall validates the duration before this handler is reached.
    const seconds = args['seconds'] as number;
    await setTimeout(seconds * 1000, undefined, { signal: ctx.signal });
    return { waitedSeconds: seconds };
  },
};
