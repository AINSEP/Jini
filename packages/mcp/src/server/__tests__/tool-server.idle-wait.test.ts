import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpToolDef } from '../tool-protocol.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createToolServerCapture } from './tool-server-capture.fixture.js';

/** The real idle-exit controller on fake timers: a call waiting on a person must not look idle. */

class CountingTransport implements McpTransportLike {
  onmessage?: ((args: { message: unknown }) => void) | undefined;
  onclose?: (() => void) | undefined;
  closeCalls = 0;
  async close(_required: Record<string, never>): Promise<void> {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

const MINUTE = 60_000;
const slowTool = (): McpToolDef => ({
  name: 'slow', description: 'waits for a person', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: () => new Promise(resolve => { setTimeout(() => resolve('answered'), 20 * MINUTE); }),
});

afterEach(() => { vi.useRealTimers(); });

describe('idle exit while a tools/call waits', () => {
  it('a 20-minute wait with a 5-minute idle window does not close the transport; idle exit resumes after the answer', async () => {
    vi.useFakeTimers();
    const capture = createToolServerCapture();
    const transport = new CountingTransport();
    const running = createMcpToolServer(
      { name: 'idle-wait-server', version: '0.0.0', tools: [slowTool()], resolveBaseUrl: () => 'http://d.example' },
      { createServer: () => capture.server, createTransport: () => transport, stdin: new EventEmitter() as unknown as Readable, idleMs: 5 * MINUTE },
    ).run({});
    const pending = capture.call('slow');
    await vi.advanceTimersByTimeAsync(20 * MINUTE - 1);
    expect(transport.closeCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).content).toEqual([{ type: 'text', text: 'answered' }]);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(transport.closeCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.closeCalls).toBe(1);
    await running;
  });
});
