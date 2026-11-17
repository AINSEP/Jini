import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpToolDef } from '../tool-protocol.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

/**
 * Characterization (S15): today the call handler never sends `notifications/progress`, so a client
 * that sent a progress token hears nothing while a slow tool runs. The assertion changes in the
 * commit that adds the pump.
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

describe('tools/call progress notifications (today)', () => {
  it('a 120 s call from a client that sent a progress token produces zero notifications', async () => {
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
    expect(sent).toEqual([]);
  });
});
