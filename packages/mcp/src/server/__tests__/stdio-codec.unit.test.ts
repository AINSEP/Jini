import { expect, it } from 'vitest';
import { boundedMessage, type StdioMessage } from '../adapters/stdio-codec.js';

it('reports a bounded error with the original request id instead of leaking an oversized result', () => {
  const message: StdioMessage = { jsonrpc: '2.0', id: 'request-8', result: { content: '東京'.repeat(40) } };
  expect(boundedMessage({ message, maxFrameBytes: 128 })).toStrictEqual({
    jsonrpc: '2.0', id: 'request-8', error: { code: -32603, message: 'Response exceeds maxFrameBytes' },
  });
  expect(() => boundedMessage({ message, maxFrameBytes: 64 }))
    .toThrow(new RangeError('MCP error response exceeds maxFrameBytes'));
});

it('does not fabricate a request id for an oversized notification', () => {
  const notification: StdioMessage = {
    jsonrpc: '2.0', method: 'notifications/message', params: { message: '東京'.repeat(40) },
  };
  expect(() => boundedMessage({ message: notification, maxFrameBytes: 128 }))
    .toThrow(new RangeError('MCP outgoing frame exceeds maxFrameBytes'));
});
