import { PassThrough, Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpToolServer, type McpToolServerOptions, type McpTransportLike } from '../tool-server.js';
import { adaptSdkTransport } from '../sdk-transport.js';
import type { McpToolDef } from '../tool-protocol.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function tool(handler: McpToolDef['handler']): McpToolDef {
  return { name: 'work', description: 'Run work', inputSchema: { type: 'object' }, handler };
}

function call(id: number, value = String(id)) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'work', arguments: { value } } };
}

/** Real SDK dispatch/serialization over socket-free, caller-owned streams. */
async function boot({ tools = [tool(({ args }) => args)], ...options }: McpToolServerOptions & { tools?: McpToolDef[] } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const responses: Array<Record<string, any>> = [];
  let wire = '';
  let transport: McpTransportLike | undefined;
  stdout.on('data', chunk => {
    wire += String(chunk);
    let end: number;
    while ((end = wire.indexOf('\n')) !== -1) {
      responses.push(JSON.parse(wire.slice(0, end)));
      wire = wire.slice(end + 1);
    }
  });
  const running = createMcpToolServer({ name: 'hosting-test', version: '1', tools, resolveBaseUrl: () => 'http://daemon.invalid' }, {
    stdin, stdout,
    createTransport: (_required, streams) => {
      transport = adaptSdkTransport({ transport: new StdioServerTransport(streams?.stdin, streams?.stdout) });
      return transport;
    },
    ...options,
  }).run({});
  // Observe rejection immediately so deliberate stream failures cannot become unhandled rejections.
  const outcome = running.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  onTestFinished(async () => { await transport?.close({}); await outcome; stdin.destroy(); stdout.destroy(); });
  await setImmediate();
  return { stdin, stdout, responses, running, outcome };
}

describe('opt-in MCP stdio hosting', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid frame cap synchronously: %s', maxFrameBytes => {
    const resolveBaseUrl = vi.fn(() => 'unused');
    expect(() => createMcpToolServer({ name: 'x', version: '1', tools: [], resolveBaseUrl }, { maxFrameBytes })).toThrow(RangeError);
    expect(resolveBaseUrl).not.toHaveBeenCalled();
  });

  it('keeps omitted options concurrent and closes immediately at EOF', async () => {
    const release = deferred<void>();
    const started: string[] = [];
    const host = await boot({ tools: [tool(async ({ args }) => { started.push(String(args.value)); await release.promise; return 'done'; })] });
    host.stdin.write(JSON.stringify(call(1)) + '\n' + JSON.stringify(call(2)) + '\n');
    await setImmediate();
    expect(started).toEqual(['1', '2']);
    host.stdin.end();
    await host.running;
    expect(host.responses).toEqual([]);
    release.resolve();
  });

  it('runs FIFO through failures, waits for write callbacks, and drains active plus queued work at EOF', async () => {
    const releaseHandler = deferred<void>();
    const releaseWrite = deferred<void>();
    const started: string[] = [];
    const written: string[] = [];
    const stdout = new Writable({ write(chunk, _encoding, callback) {
      written.push(String(chunk));
      void releaseWrite.promise.then(() => callback());
    } });
    const host = await boot({ serial: true, eof: 'drain', stdout, tools: [tool(({ args }) => {
      started.push(String(args.value));
      return 'second';
    })], resources: [{ uri: 'jini://failure', name: 'Failure', read: async () => {
      started.push('1');
      await releaseHandler.promise;
      throw new Error('work failed');
    } }] });
    let settled = false;
    void host.outcome.then(() => { settled = true; });
    const first = { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'jini://failure' } };
    host.stdin.write(JSON.stringify(first) + '\n' + JSON.stringify(call(2)) + '\n');
    await setImmediate();
    expect(started).toEqual(['1']);
    expect(settled).toBe(false);
    releaseHandler.resolve();
    await setImmediate();
    expect(written.map(frame => JSON.parse(frame).id)).toEqual([1]);
    expect(JSON.parse(written[0]!).error).toEqual({ code: -32603, message: 'work failed' });
    expect(started).toEqual(['1']);
    expect(settled).toBe(false);
    host.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }) + '\n');
    await setImmediate();
    // Cancellation after response writing begins cannot release the next handler early.
    expect(started).toEqual(['1']);
    host.stdin.end();
    releaseWrite.resolve();
    await host.running;
    expect(started).toEqual(['1', '2']);
    expect(written.map(frame => JSON.parse(frame).id)).toEqual([1, 2]);
    expect(host.stdin.listenerCount('end')).toBe(0);
    expect(host.stdin.listenerCount('close')).toBe(0);
    expect(host.stdin.listenerCount('error')).toBe(0);
    expect(stdout.listenerCount('error')).toBe(0);
    host.stdin.emit('close');
  });

  it('delivers cancellation while serial work is active and waits for the cancelled handler to settle', async () => {
    const release = deferred<void>();
    const started: string[] = [];
    let signal: AbortSignal | undefined;
    const host = await boot({ serial: true, eof: 'drain', tools: [tool(async ({ args, ctx }) => {
      started.push(String(args.value));
      if (args.value === '1') { signal = ctx.signal; await release.promise; }
      return 'done';
    })] });
    host.stdin.write(JSON.stringify(call(1)) + '\n' + JSON.stringify(call(2)) + '\n');
    await setImmediate();
    host.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }) + '\n');
    await setImmediate();
    expect(signal?.aborted).toBe(true);
    expect(started).toEqual(['1']);
    host.stdin.end();
    release.resolve();
    await host.running;
    expect(started).toEqual(['1', '2']);
    expect(host.responses.map(response => response.id)).toEqual([2]);
  });

  it('skips a queued cancelled handler without blocking subsequent requests', async () => {
    const release = deferred<void>();
    const started: string[] = [];
    const host = await boot({ serial: true, eof: 'drain', tools: [tool(async ({ args }) => {
      started.push(String(args.value));
      if (args.value === '1') await release.promise;
      return 'done';
    })] });
    host.stdin.write([call(1), call(2), call(3)].map(message => JSON.stringify(message) + '\n').join(''));
    await setImmediate();
    host.stdin.end(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }) + '\n');
    await setImmediate();
    release.resolve();
    await host.running;
    expect(started).toEqual(['1', '3']);
    expect(host.responses.map(response => response.id)).toEqual([1, 3]);
  });

  it('drains complete frames before rejecting an unterminated EOF tail', async () => {
    const release = deferred<void>();
    const host = await boot({ eof: 'drain', tools: [tool(async () => { await release.promise; return 'finished'; })] });
    host.stdin.end(JSON.stringify(call(1)) + '\n{"jsonrpc":');
    await setImmediate();
    release.resolve();
    const result = await host.outcome;
    expect(result).toMatchObject({ ok: false, error: new Error('MCP stdin ended with an unterminated frame') });
    expect(host.responses).toEqual([{ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'finished' }] } }]);
  });

  it('counts UTF-8 bytes including LF across fragmented and coalesced input frames', async () => {
    const maxFrameBytes = 256;
    const frame = Buffer.from(JSON.stringify(call(1, '€'.repeat(49))) + '\n');
    // Pad inside JSON, preserving validity, to hit the exact byte ceiling.
    const exact = Buffer.concat([frame.subarray(0, -1), Buffer.alloc(maxFrameBytes - frame.length, 32), Buffer.from('\n')]);
    const seen: unknown[] = [];
    const host = await boot({ maxFrameBytes, eof: 'drain', tools: [tool(({ args }) => { seen.push(args.value); return 'ok'; })] });
    const split = exact.indexOf(Buffer.from('€')) + 1;
    host.stdin.write(exact.subarray(0, split));
    const second = Buffer.from(exact.toString().replace('"id":1', '"id":2'));
    host.stdin.end(Buffer.concat([exact.subarray(split), second]));
    await host.running;
    expect(host.responses.map(response => response.id)).toEqual([1, 2]);
    expect(seen).toEqual(['€'.repeat(49), '€'.repeat(49)]);
    const oversized = await boot({ maxFrameBytes });
    oversized.stdin.end(Buffer.concat([exact.subarray(0, -1), Buffer.from(' \n')]));
    expect(await oversized.outcome).toEqual({ ok: false, error: new RangeError('MCP incoming frame exceeds maxFrameBytes') });
    expect(oversized.responses).toEqual([]);
  });

  it('refuses an oversized unterminated input before EOF', async () => {
    const host = await boot({ maxFrameBytes: 32 });
    host.stdin.write(Buffer.alloc(33, 32));
    expect(await host.outcome).toEqual({ ok: false, error: new RangeError('MCP incoming frame exceeds maxFrameBytes') });
    expect(host.responses).toEqual([]);
  });

  it('replaces oversized responses with bounded errors preserving the ID, and rejects if even that cannot fit', async () => {
    const emptyResponse = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '' }] } };
    const text = 'x'.repeat(256 - Buffer.byteLength(JSON.stringify(emptyResponse) + '\n'));
    const host = await boot({ maxFrameBytes: 256, serial: true, eof: 'drain', tools: [tool(({ args }) => args.value === 'exact' ? text : text + '€')] });
    host.stdin.end(JSON.stringify(call(1, 'exact')) + '\n' + JSON.stringify(call(4, 'over')) + '\n');
    await host.running;
    expect(host.responses[0]).toEqual({ ...emptyResponse, result: { content: [{ type: 'text', text }] } });
    expect(Buffer.byteLength(JSON.stringify(host.responses[0]) + '\n')).toBe(256);
    expect(host.responses[1]).toEqual({ jsonrpc: '2.0', id: 4, error: { code: -32603, message: 'Response exceeds maxFrameBytes' } });
    expect(Buffer.byteLength(JSON.stringify(host.responses[1]) + '\n')).toBeLessThanOrEqual(256);
    // The request fits, but neither the SDK method-not-found response nor its replacement fits.
    const tiny = await boot({ maxFrameBytes: 48, eof: 'drain' });
    tiny.stdin.end('{"jsonrpc":"2.0","id":1,"method":"missing"}\n');
    expect(await tiny.outcome).toEqual({ ok: false, error: new RangeError('MCP error response exceeds maxFrameBytes') });
    expect(tiny.responses).toEqual([]);
  });

  it.each(['input', 'output'] as const)('rejects run for %s stream failures', async side => {
    const host = await boot({ serial: true, eof: 'drain' });
    const error = new Error(`${side} failed`);
    (side === 'input' ? host.stdin : host.stdout).emit('error', error);
    expect(await host.outcome).toEqual({ ok: false, error });
  });

  it('rejects a failing writable callback instead of hanging a serial drain', async () => {
    const error = new Error('write failed');
    const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(error); } });
    const host = await boot({ serial: true, eof: 'drain', stdout });
    host.stdin.end(JSON.stringify(call(1)) + '\n');
    expect(await host.outcome).toEqual({ ok: false, error });
  });
});
