/**
 * @module @jini/mcp/server/__tests__/tool-server.wire
 *
 * Wire-level companion to `./tool-server.test.ts`. That file drives
 * `createMcpToolServer` entirely against a hand-written `FakeTransport` +
 * `McpServerLike` stand-in — it thoroughly proves `run()`'s own wiring
 * (idleMs threading, capability-object construction, activity tracking,
 * every shutdown path) but never sends a single byte of real JSON-RPC, and
 * never runs a response through the SDK's own schema validation. This file
 * instead boots a real `@modelcontextprotocol/sdk` `Server` (via
 * `createMcpToolServer` with no `createServer` override — the exact "wires
 * the real SDK Server" case `tool-server.test.ts` only smoke-tests for
 * construction/shutdown) and connects a real SDK `Client` to it over a real,
 * in-process `InMemoryTransport.createLinkedPair()` — the SDK's own
 * in-memory transport pairing, not a hand-rolled fake. Every call below is
 * therefore dispatched through the SDK's real `Protocol` layer, which
 * zod-parses each inbound request against `CallToolRequestSchema` (etc.)
 * before any handler sees it — see the "not identity-shared" assertion — and
 * every response is parsed by the client against the SDK's real
 * `*ResultSchema` zod schemas (`Client.callTool`'s default `resultSchema`
 * argument), exactly as a real MCP host would validate it. A hand-rolled
 * `{isError:true, content:[...]}` object handed straight to a fake never
 * crosses that schema-conformance boundary at all — that is precisely the gap
 * this file closes.
 *
 * Known limit of this harness: `InMemoryTransport.send` hands the peer's
 * `onmessage` the *same* object it was given (SDK 1.29.0 — no `JSON`
 * round trip, no `structuredClone`). So nothing here exercises
 * JSON-serializability of a payload; a handler returning a `Date`, `Map`,
 * `BigInt`, or a circular structure would pass this file and still break over
 * a real stdio transport. Covering that needs a genuinely serializing
 * transport, not this pair.
 */
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

// Same isolation rationale as tool-server.test.ts: the idle-exit
// controller's own scheduling semantics (schedule/reschedule/dispose) are
// exhaustively unit-tested in `../../client/__tests__/client.test.ts`.
// Mocking it here lets every test in this file deterministically fire "went
// idle" (`hoisted.onIdleRef.current()`) to wind the *real* transport pair
// down, instead of racing — or actually waiting out — a real 30-minute
// timer just to end a test.
const hoisted = vi.hoisted(() => ({
  onIdleRef: { current: null as (() => void) | null },
  noteActivity: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../../client/client.js', () => ({
  createMcpIdleExitController: vi.fn(({ onIdle }: { idleMs: number; onIdle: () => void }) => {
    hoisted.onIdleRef.current = onIdle;
    return {
      noteActivity: hoisted.noteActivity,
      trackRequest: async (fn: () => unknown) => fn(),
      dispose: hoisted.dispose,
    };
  }),
}));

import { createMcpToolServer, type McpToolServerOptions, type McpTransportLike } from '../tool-server.js';
import type { McpToolDef } from '../tool-protocol.js';
import type { McpResourceDef } from '../resource-protocol.js';

beforeEach(() => {
  hoisted.onIdleRef.current = null;
  hoisted.noteActivity.mockClear();
  hoisted.dispose.mockClear();
});

function echoTool(overrides: Partial<McpToolDef> = {}): McpToolDef {
  return {
    name: 'echo',
    description: 'echoes its arguments back',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false },
    handler: (args) => args,
    ...overrides,
  };
}

function throwingTool(overrides: Partial<McpToolDef> = {}): McpToolDef {
  return {
    name: 'boom',
    description: 'always throws',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      throw new Error('handler exploded');
    },
    ...overrides,
  };
}

function helloResource(overrides: Partial<McpResourceDef> = {}): McpResourceDef {
  return {
    uri: 'jini://hello',
    name: 'Hello',
    read: () => ({ text: 'hello world' }),
    ...overrides,
  };
}

function throwingResource(overrides: Partial<McpResourceDef> = {}): McpResourceDef {
  return {
    uri: 'jini://boom',
    name: 'Boom',
    read: () => {
      throw new Error('read exploded');
    },
    ...overrides,
  };
}

/**
 * Wires a real `createMcpToolServer` handle to one half of a real
 * `InMemoryTransport.createLinkedPair()` (the SDK's own in-memory transport,
 * not a fake) and connects a real, genuine SDK `Client` on the other half.
 * `createServer` is deliberately never overridden — every test in this file
 * runs against the actual `@modelcontextprotocol/sdk` `Server` class.
 * Returns the connected client plus `run()`'s own promise, which stays
 * pending until a caller winds it down via {@link closeDown}.
 */
async function bootWireServer(
  overrides: Partial<McpToolServerOptions> = {},
): Promise<{ client: Client; runPromise: Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = createMcpToolServer({
    name: 'wire-test-server',
    version: '1.2.3',
    tools: [echoTool()],
    resolveBaseUrl: () => 'http://d.example',
    stdin: new EventEmitter() as unknown as Readable,
    // Same cast `tool-server.ts`'s own `defaultCreateTransport` uses to hand a real SDK transport
    // (whose `onmessage`/`onclose` are typed against concrete SDK message types) through the
    // narrower, test-friendly `McpTransportLike` seam (`message: unknown`).
    createTransport: () => serverTransport as unknown as McpTransportLike,
    ...overrides,
  });
  const runPromise = handle.run();
  const client = new Client({ name: 'wire-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, runPromise };
}

/** Fires the (mocked) idle-exit controller to close the real transport pair down, and awaits `run()`'s resolution. */
async function closeDown(runPromise: Promise<void>): Promise<void> {
  hoisted.onIdleRef.current?.();
  await runPromise;
}

describe('createMcpToolServer — wire-level (real SDK Client + Server + InMemoryTransport)', () => {
  it('negotiates a real tools-only capability set over the wire when no resources are registered', async () => {
    const { client, runPromise } = await bootWireServer();
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
    await closeDown(runPromise);
  });

  it('negotiates both tools and resources capabilities over the wire once at least one resource is registered', async () => {
    const { client, runPromise } = await bootWireServer({ resources: [helloResource()] });
    expect(client.getServerCapabilities()).toEqual({ tools: {}, resources: {} });
    await closeDown(runPromise);
  });

  it('lists tools via a real tools/list JSON-RPC request, shaped and schema-validated by the real client', async () => {
    const tool = echoTool({ description: 'echoes back', annotations: { readOnlyHint: true } });
    const { client, runPromise } = await bootWireServer({ tools: [tool] });
    const result = await client.listTools();
    expect(result.tools).toEqual([
      { name: 'echo', description: 'echoes back', inputSchema: tool.inputSchema, annotations: { readOnlyHint: true } },
    ]);
    await closeDown(runPromise);
  });

  it('round-trips a tools/call result through the real SDK request-dispatch path, with the handler observing a schema-parsed (not identity-shared) arguments object', async () => {
    let seenArgs: unknown;
    const tool = echoTool({
      handler: (args) => {
        seenArgs = args;
        return { received: args };
      },
    });
    const { client, runPromise } = await bootWireServer({ tools: [tool] });
    const sentArgs = { value: 'through-the-wire' };
    const result = await client.callTool({ name: 'echo', arguments: sentArgs });
    // The handler's args are a fresh object built by the SDK `Protocol`'s zod parse of
    // `CallToolRequestSchema`, not the reference this test constructed — proof the call went
    // through the real SDK request-dispatch path, unlike the FakeTransport suite, where the
    // handler receives the literal same JS object reference. (The identity break comes from that
    // zod parse, not from the transport: see this module's "Known limit" note.)
    expect(seenArgs).toEqual(sentArgs);
    expect(seenArgs).not.toBe(sentArgs);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ received: sentArgs }, null, 2) }]);
    await closeDown(runPromise);
  });

  it('produces a proper MCP-shaped {isError:true} CallToolResult — not a rejected promise or a JSON-RPC-level error — when a tool handler throws', async () => {
    const { client, runPromise } = await bootWireServer({ tools: [throwingTool()] });
    const result = await client.callTool({ name: 'boom', arguments: {} });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'handler exploded' }] });
    await closeDown(runPromise);
  });

  it('returns an {isError:true} CallToolResult (not a JSON-RPC error) for an unknown tool name, over the real wire', async () => {
    const { client, runPromise } = await bootWireServer({ tools: [echoTool()] });
    const result = await client.callTool({ name: 'does-not-exist', arguments: {} });
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'unknown tool: does-not-exist' }] });
    await closeDown(runPromise);
  });

  it('enforces a tool\'s declared inputSchema server-side, rejecting a real client\'s schema-violating call before the handler ever runs', async () => {
    // `createMcpToolServer` wires its tools via the SDK's low-level `Server.setRequestHandler`,
    // not the high-level `McpServer.registerTool()` helper — the latter validates arguments
    // against a zod schema before invoking the handler, and the former did not either, until
    // `tool-protocol.ts`'s `handleToolCall` gained its own schema-validation gate (the SDK's own
    // `@modelcontextprotocol/sdk/validation/cfworker` provider) ahead of every handler call. A
    // FakeTransport test can't prove this either way (it calls the handler directly regardless of
    // what a real transport would have done); this wire test proves, against the real SDK
    // `Server`, that a schema-violating call (wrong type, undeclared extra property, against an
    // `additionalProperties: false` schema) is rejected as an `isError` result and never reaches
    // the handler.
    let handlerCalled = false;
    const tool = echoTool({
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false },
      handler: (args) => {
        handlerCalled = true;
        return 'ok';
      },
    });
    const { client, runPromise } = await bootWireServer({ tools: [tool] });
    const schemaViolatingArgs = { value: 123, extra: 'not declared in inputSchema' };
    const result = await client.callTool({ name: 'echo', arguments: schemaViolatingArgs });
    expect(result.isError).toBe(true);
    expect((result.content as { type: string; text: string }[])[0]?.text).toContain('invalid arguments for echo');
    expect(handlerCalled).toBe(false);
    await closeDown(runPromise);
  });

  it('lists resources via a real resources/list JSON-RPC request', async () => {
    const resource = helloResource({ description: 'says hello', mimeType: 'text/plain' });
    const { client, runPromise } = await bootWireServer({ resources: [resource] });
    const result = await client.listResources();
    expect(result.resources).toEqual([
      { uri: 'jini://hello', name: 'Hello', description: 'says hello', mimeType: 'text/plain' },
    ]);
    await closeDown(runPromise);
  });

  it('reads a resource via a real resources/read JSON-RPC request', async () => {
    const { client, runPromise } = await bootWireServer({ resources: [helloResource()] });
    const result = await client.readResource({ uri: 'jini://hello' });
    expect(result.contents).toEqual([{ uri: 'jini://hello', text: 'hello world' }]);
    await closeDown(runPromise);
  });

  it('surfaces a real JSON-RPC error response — an McpError, not a soft result — when reading an unknown resource uri', async () => {
    const { client, runPromise } = await bootWireServer({ resources: [helloResource()] });
    const rejection: unknown = await client.readResource({ uri: 'jini://not-registered' }).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(McpError);
    expect((rejection as McpError).code).toBe(ErrorCode.InternalError);
    expect((rejection as McpError).message).toContain('unsupported resource URI: jini://not-registered');
    await closeDown(runPromise);
  });

  it('surfaces a real JSON-RPC error response — an McpError, not a soft result — when a resource read handler throws', async () => {
    const { client, runPromise } = await bootWireServer({ resources: [throwingResource()] });
    const rejection: unknown = await client.readResource({ uri: 'jini://boom' }).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(McpError);
    expect((rejection as McpError).code).toBe(ErrorCode.InternalError);
    expect((rejection as McpError).message).toContain('read exploded');
    await closeDown(runPromise);
  });

  it('closes the real transport pair when the idle-exit controller fires, and the connected client observes a genuine disconnect', async () => {
    const { client, runPromise } = await bootWireServer();
    await closeDown(runPromise);
    // The transport pair is genuinely torn down end-to-end (not just a `closeCalls` counter
    // incremented on a fake): a further request over the same client can no longer be sent at all.
    await expect(client.ping()).rejects.toThrow();
  });
});
