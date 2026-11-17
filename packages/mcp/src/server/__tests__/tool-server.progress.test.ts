import { describe, expect, it } from 'vitest';

import type { McpToolDef } from '../tool-protocol.js';
import { createMcpToolServer, type McpTransportLike } from '../tool-server.js';
import { createFakeLogger, createFakeScheduler } from './call-progress.fixture.js';
import { createToolServerCapture, type CapturedExtra } from './tool-server-capture.fixture.js';

const transport: McpTransportLike = { close: async () => {} };
const schema = { type: 'object', properties: {}, additionalProperties: false } as const;
const frame = (progress: number) => ({ method: 'notifications/progress', params: { progressToken: 't1', progress, message: 'waiting' } });

/** A tool whose handler parks until the test calls `release`, standing in for a 120 s wait. */
function gatedTool({ name = 'slow', fail = false }: { name?: string; fail?: boolean } = {}) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tool: McpToolDef = {
    name, description: 'waits', inputSchema: schema,
    handler: async () => { await gate; if (fail) throw new Error('tool exploded'); return 'done'; },
  };
  return { tool, release };
}

async function boot({ tools }: { tools: McpToolDef[] }) {
  const clock = createFakeScheduler();
  const log = createFakeLogger();
  const capture = createToolServerCapture();
  await createMcpToolServer(
    { name: 'test-server', version: '0.0.0', tools, resolveBaseUrl: () => 'http://d.example' },
    { createServer: () => capture.server, progressScheduler: clock.scheduler, logger: log.logger },
  ).run({ transport });
  const sent: unknown[] = [];
  const extraFor = (overrides: Partial<CapturedExtra> = {}): CapturedExtra => ({
    _meta: { progressToken: 't1' },
    sendNotification: async notification => { sent.push(notification); },
    ...overrides,
  });
  return { clock, log, capture, sent, extraFor };
}

const settle = () => new Promise<void>(resolve => { setImmediate(resolve); });

describe('tools/call progress pump', () => {
  it('sends a frame every 25 s for a client that sent a token, and none once the result is back', async () => {
    const { tool, release } = gatedTool();
    const { clock, capture, sent, extraFor } = await boot({ tools: [tool] });
    const pending = capture.callWithExtra('slow', {}, extraFor());
    await settle();
    clock.advance({ ms: 120_000 });
    expect(clock.intervals).toEqual([25_000]);
    expect(sent).toEqual([frame(1), frame(2), frame(3), frame(4)]);
    release();
    expect((await pending).content).toEqual([{ type: 'text', text: 'done' }]);
    expect(clock.active()).toBe(0);
    clock.advance({ ms: 300_000 });
    expect(sent).toHaveLength(4);
  });

  it('sends nothing and schedules nothing when the client sent no token', async () => {
    const { tool, release } = gatedTool();
    const { clock, capture, sent, extraFor } = await boot({ tools: [tool] });
    const pending = capture.callWithExtra('slow', {}, extraFor({ _meta: {} }));
    await settle();
    clock.advance({ ms: 120_000 });
    release();
    await pending;
    expect(sent).toEqual([]);
    expect(clock.intervals).toEqual([]);
  });

  it('an abort at 40 s leaves one frame and clears the timer while the handler is still parked', async () => {
    const { tool, release } = gatedTool();
    const { clock, capture, sent, extraFor } = await boot({ tools: [tool] });
    const controller = new AbortController();
    const pending = capture.callWithExtra('slow', {}, extraFor({ signal: controller.signal }));
    await settle();
    clock.advance({ ms: 40_000 });
    controller.abort();
    expect(clock.active()).toBe(0);
    clock.advance({ ms: 300_000 });
    expect(sent).toEqual([frame(1)]);
    release();
    await pending;
  });

  it('a rejected sendNotification still returns the tool result and logs one line', async () => {
    const { tool, release } = gatedTool();
    const { clock, capture, log, extraFor } = await boot({ tools: [tool] });
    const refusal = new Error('transport closed');
    const pending = capture.callWithExtra('slow', {}, extraFor({ sendNotification: async () => { throw refusal; } }));
    await settle();
    clock.advance({ ms: 75_000 });
    await settle();
    release();
    expect((await pending).content).toEqual([{ type: 'text', text: 'done' }]);
    expect(log.warnings).toEqual([{ message: 'progress notification failed; this call sends no more progress', error: refusal }]);
  });

  it('a tool that throws returns its error result with the pump already stopped', async () => {
    const { tool, release } = gatedTool({ fail: true });
    const { clock, capture, extraFor } = await boot({ tools: [tool] });
    const pending = capture.callWithExtra('slow', {}, extraFor());
    await settle();
    expect(clock.active()).toBe(1);
    release();
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(clock.active()).toBe(0);
  });

  it('a delegated call through a local gateway runs one pump, not one per nested call', async () => {
    const inner: McpToolDef = { name: 'inner', description: 'inner', inputSchema: schema, annotations: { readOnlyHint: true }, handler: () => 'inner-done' };
    const outer: McpToolDef = { name: 'outer', description: 'outer', inputSchema: schema, handler: async ({ ctx }) => ctx.callLocalTool?.({ name: 'inner', input: {}, requireReadOnly: false }) };
    const { clock, capture, extraFor } = await boot({ tools: [outer, inner] });
    await capture.callWithExtra('outer', {}, extraFor());
    expect(clock.intervals).toEqual([25_000]);
  });
});
