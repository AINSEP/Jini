/** SDK serialization and response classification stay behind the stdio adapter. */
import { serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { isJSONRPCErrorResponse, isJSONRPCResultResponse, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
export type { JSONRPCMessage as StdioMessage } from '@modelcontextprotocol/sdk/types.js';

/** Measure the SDK's actual serialization; an oversized response becomes a bounded error.
 * @throws RangeError when a request/notification or the minimal replacement exceeds the cap.
 */
export function boundedMessage({ message, maxFrameBytes }: { message: JSONRPCMessage; maxFrameBytes: number }, _options = {}): JSONRPCMessage {
  if (Buffer.byteLength(serializeMessage(message)) <= maxFrameBytes) return message;
  if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) {
    throw new RangeError('MCP outgoing frame exceeds maxFrameBytes');
  }
  const replacement: JSONRPCMessage = { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Response exceeds maxFrameBytes' } };
  if (Buffer.byteLength(serializeMessage(replacement)) > maxFrameBytes) {
    throw new RangeError('MCP error response exceeds maxFrameBytes');
  }
  return replacement;
}

