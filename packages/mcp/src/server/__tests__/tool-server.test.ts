import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// The idle-exit controller itself is exhaustively unit-tested in
// `../../client/__tests__/client.test.ts` (schedule/reschedule/dispose
// semantics). Mocking it here lets every test in this file trigger "went
// idle" deterministically (`hoisted.onIdleRef.current()`) instead of racing
// real timers, while `trackRequest`/`noteActivity` stay observable spies so
// `run()`'s own wiring — not the controller's internal timing — is what's
// under test.
const hoisted = vi.hoisted(() => ({
  onIdleRef: { current: null as (() => void) | null },
  idleMsSeen: { current: null as number | null },
  noteActivity: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../../client/client.js', () => ({
  createMcpIdleExitController: vi.fn(({ idleMs, onIdle }: { idleMs: number; onIdle: () => void }) => {
    hoisted.onIdleRef.current = onIdle;
    hoisted.idleMsSeen.current = idleMs;
    return {
      noteActivity: hoisted.noteActivity,
      trackRequest: async (fn: () => unknown) => fn(),
      dispose: hoisted.dispose,
    };
  }),
}));

import { createMcpToolServer, type McpServerLike, type McpToolServerOptions, type McpTransportLike } from '../tool-server.js';
import type { McpToolDef } from '../tool-protocol.js';
import type { McpResourceDef } from '../resource-protocol.js';

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeTransport implements McpTransportLike {
  onmessage?: ((message: unknown) => void) | undefined;
  onclose?: (() => void) | undefined;
  closeCalls = 0;
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

interface FakeServer extends McpServerLike {
  handlers: Map<unknown, (...args: any[]) => any>;
  listTools: () => Promise<unknown>;
  callTool: (request: { params: { name: string; arguments?: Record<string, unknown> } }) => Promise<unknown>;
  listResources: () => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
}

/** A fake `McpServerLike` that mimics the real SDK's `connect()` (sets `onmessage`/`onclose` on the transport before `run()` wraps them) and captures every registered handler for direct invocation in tests. */
function makeFakeServer(sdkOnMessage: (message: unknown) => void = vi.fn(), sdkOnClose: () => void = vi.fn()): FakeServer {
  const handlers = new Map<unknown, (...args: any[]) => any>();
  const server: FakeServer = {
    handlers,
    setRequestHandler: ((schema: unknown, handler: (...args: any[]) => any) => {
      handlers.set(schema, handler);
    }) as McpServerLike['setRequestHandler'],
    connect: async (t: McpTransportLike) => {
      t.onmessage = sdkOnMessage;
      t.onclose = sdkOnClose;
    },
    listTools: () => handlers.get(ListToolsRequestSchema)!(),
    callTool: (request) => handlers.get(CallToolRequestSchema)!(request),
    listResources: () => handlers.get(ListResourcesRequestSchema)!(),
    readResource: (uri) => handlers.get(ReadResourceRequestSchema)!({ params: { uri } }),
  };
  return server;
}

function noopTool(overrides: Partial<McpToolDef> = {}): McpToolDef {
  return {
    name: 'noop',
    description: 'no-op',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => 'ok',
    ...overrides,
  };
}

function noopResource(overrides: Partial<McpResourceDef> = {}): McpResourceDef {
  return {
    uri: 'jini://noop',
    name: 'Noop',
    read: () => ({ text: 'ok' }),
    ...overrides,
  };
}

function baseOptions(overrides: Partial<McpToolServerOptions> = {}): McpToolServerOptions {
  return {
    name: 'test-server',
    version: '0.0.0',
    tools: [noopTool()],
    resolveBaseUrl: () => 'http://d.example',
    stdin: new EventEmitter() as unknown as Readable,
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.onIdleRef.current = null;
  hoisted.idleMsSeen.current = null;
  hoisted.noteActivity.mockClear();
  hoisted.dispose.mockClear();
});

describe('createMcpToolServer', () => {
  it('throws synchronously on a duplicate tool name, before run() is ever called', () => {
    expect(() =>
      createMcpToolServer(baseOptions({ tools: [noopTool(), noopTool()] })),
    ).toThrow('duplicate tool name "noop"');
  });

  it('throws synchronously on a duplicate resource uri, before run() is ever called', () => {
    expect(() =>
      createMcpToolServer(baseOptions({ resources: [noopResource(), noopResource()] })),
    ).toThrow('duplicate resource uri "jini://noop"');
  });

  it('passes idleMs through to the idle-exit controller, defaulting to 30 minutes when omitted', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(hoisted.idleMsSeen.current).toBe(30 * 60 * 1000);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('honors a caller-supplied idleMs', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ idleMs: 12_345, createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(hoisted.idleMsSeen.current).toBe(12_345);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });
});

describe('run()', () => {
  it('passes instructions through to createServer when set, and omits the key entirely when unset', async () => {
    const transportA = new FakeTransport();
    const serverA = makeFakeServer();
    const createServerA = vi.fn(() => serverA);
    const handleA = createMcpToolServer(baseOptions({
      instructions: 'use these tools wisely',
      createServer: createServerA,
      createTransport: () => transportA,
    }));
    const runA = handleA.run();
    await flushAsync();
    expect(createServerA).toHaveBeenCalledWith(
      { name: 'test-server', version: '0.0.0' },
      { capabilities: { tools: {} }, instructions: 'use these tools wisely' },
    );
    hoisted.onIdleRef.current?.();
    await runA;

    const transportB = new FakeTransport();
    const serverB = makeFakeServer();
    const createServerB = vi.fn(() => serverB);
    const handleB = createMcpToolServer(baseOptions({ createServer: createServerB, createTransport: () => transportB }));
    const runB = handleB.run();
    await flushAsync();
    expect(createServerB).toHaveBeenCalledWith({ name: 'test-server', version: '0.0.0' }, { capabilities: { tools: {} } });
    hoisted.onIdleRef.current?.();
    await runB;
  });

  it('resolves a sync resolveBaseUrl and strips a trailing slash before building tool context', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    let seenBaseUrl: string | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenBaseUrl = ctx.baseUrl; return 'ok'; } })],
      resolveBaseUrl: () => 'http://d.example/',
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenBaseUrl).toBe('http://d.example');
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('awaits an async resolveBaseUrl', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    let seenBaseUrl: string | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenBaseUrl = ctx.baseUrl; return 'ok'; } })],
      resolveBaseUrl: async () => 'http://async.example',
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenBaseUrl).toBe('http://async.example');
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('defaults fetchImpl to the global fetch when omitted', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    let seenFetch: typeof fetch | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenFetch = ctx.fetchImpl; return 'ok'; } })],
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenFetch).toBe(fetch);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('threads a caller-supplied fetchImpl into every tool context', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const customFetch = vi.fn() as unknown as typeof fetch;
    let seenFetch: typeof fetch | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenFetch = ctx.fetchImpl; return 'ok'; } })],
      fetchImpl: customFetch,
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenFetch).toBe(customFetch);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('omits authHeaders from every tool context when the caller supplies none', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    let seenCtx: { authHeaders?: Readonly<Record<string, string>> } | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenCtx = ctx; return 'ok'; } })],
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenCtx?.authHeaders).toBeUndefined();
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('threads a caller-supplied authHeaders into every tool context', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    let seenAuthHeaders: Readonly<Record<string, string>> | undefined;
    const handle = createMcpToolServer(baseOptions({
      tools: [noopTool({ handler: (_args, ctx) => { seenAuthHeaders = ctx.authHeaders; return 'ok'; } })],
      authHeaders: { Authorization: 'Bearer test-token' },
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.callTool({ params: { name: 'noop', arguments: {} } });
    expect(seenAuthHeaders).toEqual({ Authorization: 'Bearer test-token' });
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('lists tools via the ListToolsRequestSchema handler', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const tool = noopTool({ description: 'a tool', annotations: { readOnlyHint: true } });
    const handle = createMcpToolServer(baseOptions({ tools: [tool], createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    const result = await server.listTools();
    expect(result).toEqual({
      tools: [{ name: 'noop', description: 'a tool', inputSchema: tool.inputSchema, annotations: { readOnlyHint: true } }],
    });
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('dispatches tools/call through handleToolCall, including the unknown-tool path', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    await expect(server.callTool({ params: { name: 'noop', arguments: {} } })).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    });
    await expect(server.callTool({ params: { name: 'missing' } })).resolves.toEqual({
      isError: true,
      content: [{ type: 'text', text: 'unknown tool: missing' }],
    });
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('advertises no resources capability and registers no resource handlers when resources is omitted', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const createServerSpy = vi.fn(() => server);
    const handle = createMcpToolServer(baseOptions({ createServer: createServerSpy, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(createServerSpy).toHaveBeenCalledWith({ name: 'test-server', version: '0.0.0' }, { capabilities: { tools: {} } });
    expect(server.handlers.has(ListResourcesRequestSchema)).toBe(false);
    expect(server.handlers.has(ReadResourceRequestSchema)).toBe(false);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('advertises no resources capability and registers no resource handlers when resources is an empty array', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const createServerSpy = vi.fn(() => server);
    const handle = createMcpToolServer(baseOptions({ resources: [], createServer: createServerSpy, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(createServerSpy).toHaveBeenCalledWith({ name: 'test-server', version: '0.0.0' }, { capabilities: { tools: {} } });
    expect(server.handlers.has(ListResourcesRequestSchema)).toBe(false);
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('advertises the resources capability and lists resources via the ListResourcesRequestSchema handler when at least one is registered', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const createServerSpy = vi.fn(() => server);
    const resource = noopResource({ description: 'a resource', mimeType: 'text/plain' });
    const handle = createMcpToolServer(baseOptions({
      resources: [resource],
      createServer: createServerSpy,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    expect(createServerSpy).toHaveBeenCalledWith(
      { name: 'test-server', version: '0.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    const result = await server.listResources();
    expect(result).toEqual({
      resources: [{ uri: 'jini://noop', name: 'Noop', description: 'a resource', mimeType: 'text/plain' }],
    });
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('dispatches resources/read through handleResourceRead, including the unknown-uri (adversarial) path', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({
      resources: [noopResource({ read: () => ({ text: 'body' }) })],
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await expect(server.readResource('jini://noop')).resolves.toEqual({
      contents: [{ uri: 'jini://noop', text: 'body' }],
    });
    // Unlike tools/call, resources/read has no {isError:true} content shape — a bad/unregistered
    // uri (what an adversarial or simply buggy MCP client would send) must reject the handler's
    // promise, not resolve with something that looks like valid content.
    await expect(server.readResource('jini://not-registered')).rejects.toThrow(
      'unsupported resource URI: jini://not-registered',
    );
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('counts resources/list and resources/read as activity, same as tools', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({
      resources: [noopResource()],
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    await server.listResources();
    await server.readResource('jini://noop');
    // trackRequest is stubbed to run the handler directly (see the module mock above); this test
    // only needs to prove both handlers went through withActivity's wrapper without throwing, i.e.
    // that resources share the same activity-tracked dispatch path tools already use.
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('wraps transport.onmessage to note activity and still call through to the SDK-installed handler', async () => {
    const sdkOnMessage = vi.fn();
    const server = makeFakeServer(sdkOnMessage);
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(transport.onmessage).not.toBe(sdkOnMessage);
    transport.onmessage?.({ hello: 'world' });
    expect(hoisted.noteActivity).toHaveBeenCalledTimes(1);
    expect(sdkOnMessage).toHaveBeenCalledWith({ hello: 'world' });
    hoisted.onIdleRef.current?.();
    await runPromise;
  });

  it('closes the transport and resolves once the idle-exit controller fires', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    expect(transport.closeCalls).toBe(0);
    hoisted.onIdleRef.current?.();
    await expect(runPromise).resolves.toBeUndefined();
    expect(transport.closeCalls).toBe(1);
  });

  it('closes the transport and resolves once stdin emits "end"', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const stdin = new EventEmitter();
    const handle = createMcpToolServer(baseOptions({
      stdin: stdin as unknown as Readable,
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    stdin.emit('end');
    await expect(runPromise).resolves.toBeUndefined();
    expect(transport.closeCalls).toBe(1);
  });

  it('closes the transport and resolves once stdin emits "close"', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const stdin = new EventEmitter();
    const handle = createMcpToolServer(baseOptions({
      stdin: stdin as unknown as Readable,
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    stdin.emit('close');
    await expect(runPromise).resolves.toBeUndefined();
    expect(transport.closeCalls).toBe(1);
  });

  it('dedupes a duplicate close signal: done()\'s own effects (dispose+resolve) only ever run once, even though the wrapped onclose calls through to sdkOnClose every time', async () => {
    const sdkOnClose = vi.fn();
    const server = makeFakeServer(undefined, sdkOnClose);
    const transport = new FakeTransport();
    const handle = createMcpToolServer(baseOptions({ createServer: () => server, createTransport: () => transport }));
    const runPromise = handle.run();
    await flushAsync();
    transport.onclose?.();
    transport.onclose?.();
    await runPromise;
    // The wrapped onclose always calls sdkOnClose (no dedup there — it's a plain call-through),
    // but done()'s guarded body only runs once, so dispose fires exactly twice total: once from
    // that single done() invocation, once from run()'s own top-level `finally`.
    expect(sdkOnClose).toHaveBeenCalledTimes(2);
    expect(hoisted.dispose).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejecting transport.close() from the idle path instead of leaving run() unsettled', async () => {
    const server = makeFakeServer();
    class RejectingTransport extends FakeTransport {
      override async close(): Promise<void> {
        throw new Error('close failed');
      }
    }
    const transport = new RejectingTransport();
    const stdin = new EventEmitter();
    const handle = createMcpToolServer(baseOptions({
      stdin: stdin as unknown as Readable,
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    hoisted.onIdleRef.current?.();
    // The idle path's close() rejection is swallowed and never signals completion by itself;
    // the stdin-close path is what actually resolves run() here.
    stdin.emit('end');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('resolves via done() even when the stdin-close path\'s transport.close() rejects', async () => {
    const server = makeFakeServer();
    class RejectingTransport extends FakeTransport {
      override async close(): Promise<void> {
        throw new Error('close failed');
      }
    }
    const transport = new RejectingTransport();
    const stdin = new EventEmitter();
    const handle = createMcpToolServer(baseOptions({
      stdin: stdin as unknown as Readable,
      createServer: () => server,
      createTransport: () => transport,
    }));
    const runPromise = handle.run();
    await flushAsync();
    stdin.emit('end');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('defaults stdin to process.stdin when omitted', async () => {
    const server = makeFakeServer();
    const transport = new FakeTransport();
    const fakeStdin = new EventEmitter();
    const getStdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(fakeStdin as unknown as NodeJS.ReadStream & { fd: 0 });
    try {
      const { stdin: _omit, ...rest } = baseOptions({ createServer: () => server, createTransport: () => transport });
      const handle = createMcpToolServer(rest);
      const runPromise = handle.run();
      await flushAsync();
      fakeStdin.emit('end');
      await expect(runPromise).resolves.toBeUndefined();
    } finally {
      getStdin.mockRestore();
    }
  });

  it('wires the real @modelcontextprotocol/sdk Server + StdioServerTransport when no factories are injected', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.resume();
    const handle = createMcpToolServer(baseOptions({
      stdin: stdin as unknown as Readable,
      stdout: stdout as unknown as Writable,
    }));
    const runPromise = handle.run();
    await flushAsync();
    hoisted.onIdleRef.current?.();
    await expect(runPromise).resolves.toBeUndefined();
  });
});
