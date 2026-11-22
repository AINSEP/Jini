import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpToolDef } from '../tool-protocol.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

/**
 * Characterization (S15). Before the pump, a call handler never sent `notifications/progress`, so a
 * client that sent a progress token heard nothing while a slow tool ran (zero frames in 120 s). The
 * pump landed in the commit that changed the assertion below; this keeps the end-to-end shape with
 * the default real-timer scheduler, run on fake timers.
 */

const transport: McpTransportLike = { close: async () => {} };

function slowTool({ waitMs }: { waitMs: number }): McpToolDef {
  return {
    name: 'slow',
    description: 'waits',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => new Promise(resolve => { setTimeout(() => resolve('done'), waitMs); }),
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('tools/call progress notifications with the default scheduler', () => {
  it('a 120 s call from a client that sent a progress token produces frames at 25, 50, 75 and 100 s', async () => {
    vi.useFakeTimers();
    const capture = createToolServerCapture();
    await createMcpToolServer(
      { name: 'test-server', version: '0.0.0', tools: [slowTool({ waitMs: 120_000 })], resolveBaseUrl: () => 'http://d.example' },
      { createServer: () => capture.server },
    ).run({ transport });
    const sent: unknown[] = [];
    const pending = capture.callWithExtra('slow', {}, {
      _meta: { progressToken: 't1' },
      sendNotification: async notification => { sent.push(notification); },
    });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(sent).toEqual([1, 2, 3, 4].map(progress => ({ method: 'notifications/progress', params: { progressToken: 't1', progress, message: 'waiting' } })));
  });
});
