import { splitServerFixture } from '../../__tests__/args-fixtures.js';
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
import { adaptSdkTransport } from '../sdk-transport.js';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistrationScope, createToolRegistry, type ToolDescriptor, type ToolRegistration } from '@jini-ai/core';
// Exercise the existing daemon owners without adding a production MCP -> daemon dependency.
// This checkout's prebuilt daemon is the same one a packed consumer uses; no build runs here.
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor, type ExecutionDelegate } from '@jini-ai/daemon';
import { delegatedToolExecuteRoute } from '@jini-ai/daemon/http';
import { defaultDaemonMessages, withReadOnlyToolConstraint } from '@jini-ai/daemon/read-only-tools';
import { federateSession } from '../../federation/registrations.js';
import { defaultFederationMessages } from '../../federation/messages.js';
import { InMemoryMcpSession } from '../../federation/testing/adapter.memory.js';

// Same isolation rationale as tool-server.test.ts: the idle-exit
// controller's own scheduling semantics (schedule/reschedule/dispose) are
// exhaustively unit-tested in `../../client/__tests__/client.test.ts`.
// Mocking it here lets every test in this file deterministically fire "went
// idle" (`hoisted.onIdleRef.current({})`) to wind the *real* transport pair
// down, instead of racing — or actually waiting out — a real 30-minute
// timer just to end a test.
const hoisted = vi.hoisted(() => ({
  onIdleRef: { current: null as ((required: Record<string, never>) => void) | null },
  noteActivity: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../../client/client.js', () => ({
  createMcpIdleExitController: vi.fn(({ onIdle }: { idleMs: number; onIdle: (required: Record<string, never>) => void }) => {
    hoisted.onIdleRef.current = onIdle;
    return {
      noteActivity: hoisted.noteActivity,
      trackRequest: async ({ fn }: { fn: (required: Record<string, never>) => unknown }) => fn({}),
      dispose: hoisted.dispose,
    };
  }),
}));

import { createMcpToolServer, type McpToolServerRequiredArgs, type McpToolServerOptions, type McpTransportLike } from '../tool-server.js';
import type { McpToolDef } from '../tool-protocol.js';
import type { McpResourceDef } from '../resource-protocol.js';
import { TOOL_CATALOG_TOOLS } from '../tools/tool-catalog-tools.js';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from '../tools/delegated-tool.js';

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
    handler: ({ args: args }) => args,
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
  overrides: Partial<McpToolServerRequiredArgs & McpToolServerOptions> = {},
): Promise<{ client: Client; runPromise: Promise<void>; serverTransport: InMemoryTransport }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = createMcpToolServer(...splitServerFixture({
    name: 'wire-test-server',
    version: '1.2.3',
    tools: [echoTool()],
    resolveBaseUrl: () => 'http://d.example',
    stdin: new EventEmitter() as unknown as Readable,
    // Same cast `tool-server.ts`'s own `defaultCreateTransport` uses to hand a real SDK transport
    // (whose `onmessage`/`onclose` are typed against concrete SDK message types) through the
    // narrower, test-friendly `McpTransportLike` seam (`message: unknown`).
    createTransport: () => adaptSdkTransport({ transport: serverTransport }),
    ...overrides,
  }));
  const runPromise = handle.run({});
  onTestFinished(async () => { await serverTransport.close(); await runPromise; });
  const client = new Client({ name: 'wire-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, runPromise, serverTransport };
}

/** Fires the (mocked) idle-exit controller to close the real transport pair down, and awaits `run()`'s resolution. */
async function closeDown(runPromise: Promise<void>): Promise<void> {
  hoisted.onIdleRef.current?.({});
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
      handler: ({ args: args }) => {
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
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ received: sentArgs }) }]);
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
      handler: ({ args: args }) => {
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

const concreteSchema = {
  type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
} as const;

function operation(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return { id: 'content.read', description: 'Read one item', inputSchema: concreteSchema, readOnly: true, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** Socket-free fetch adapter into the real daemon route and executor; only HTTP is replaced. */
async function daemonFixture(registrations: readonly ToolRegistration[], delegate: ExecutionDelegate = {}) {
  const registry = createToolRegistry({});
  const scope = createToolRegistrationScope({ registry });
  scope.replace({ registrations });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'wire-context' });
  const toolExecutor = withReadOnlyToolConstraint({
    inner: createToolExecutor({ registry }, { delegate }), registry,
    idGenerator: { newId: () => 'denial' }, messages: defaultDaemonMessages.readOnly,
  });
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === 'GET') {
      const id = decodeURIComponent(new URL(String(url)).pathname.slice('/api/tools/'.length));
      const descriptor = registry.list({}).find(tool => tool.id === id);
      return Response.json(descriptor ?? { error: { code: 'NOT_FOUND', message: 'not admitted' } }, { status: descriptor ? 200 : 404 });
    }
    const parsed = delegatedToolExecuteRoute.parse({ body: JSON.parse(String(init.body)), query: {}, params: {} });
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const result = await delegatedToolExecuteRoute.handle({ input: parsed.value, deps: {
      lifecycle, toolExecutor, toolRegistry: registry, resolvePrincipal: () => ({ id: 'host-principal' }),
      onInternalError: () => {},
    } }, init.signal ? { signal: init.signal } : {});
    if (result.ok) return Response.json(result.value);
    const status = result.error.code === 'TOOL_OPERATION_DENIED' ? 403 : 400;
    return Response.json({ error: result.error }, { status });
  };
  const tools = [
    ...TOOL_CATALOG_TOOLS, createExecuteDelegatedToolTool({ runId: run.id }),
    createExecuteReadonlyDelegatedToolTool({ runId: run.id }),
  ];
  return { registry, scope, run, toolExecutor, fetchImpl, requests, tools };
}

async function describeOperation(client: Client, id = 'content.read') {
  const result = await client.callTool({ name: 'describe_tool', arguments: { id } });
  expect(result.isError).toBeUndefined();
  const { tools } = await client.listTools();
  const tool = tools.find(entry => entry.annotations?.title === id);
  expect(tool).toBeDefined();
  return tool!;
}

describe('typed delegated publication — real MCP wire and existing daemon owners', () => {
  it('describes, notifies, re-lists a concrete schema and executes using the trusted run and read-only metadata', async () => {
    const handler = vi.fn(async (ctx: Parameters<ToolRegistration['handler']>[0]) => ({ got: ctx.input, principal: ctx.principal.id }));
    const fixture = await daemonFixture([{ descriptor: operation(), policy: { authorize: () => 'allow' }, handler }]);
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl,
      authHeaders: { Authorization: 'Bearer run-credential' }, delegatedTools: { runId: fixture.run.id, generateToolUseId: () => 'typed-call-1' } });
    expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: true });
    expect((await client.listTools()).tools).toHaveLength(fixture.tools.length);
    const observed = deferred<Awaited<ReturnType<Client['listTools']>>>();
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { observed.resolve(await client.listTools()); });
    const typed = await describeOperation(client);
    expect((await observed.promise).tools.find(tool => tool.name === typed.name)?.inputSchema).toEqual(concreteSchema);
    expect(typed.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
    expect(typed.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: typed.name, arguments: { id: 'item-1' } });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ run: { id: fixture.run.id }, principal: { id: 'host-principal' }, input: { id: 'item-1' } });
    const post = fixture.requests.find(request => request.init.method === 'POST')!;
    expect(JSON.parse(String(post.init.body))).toMatchObject({ runId: fixture.run.id, toolUseId: 'typed-call-1', toolId: 'content.read', input: { id: 'item-1' }, requireReadOnly: true });
    expect(new Headers(post.init.headers).get('authorization')).toBe('Bearer run-credential');
    expect(fixture.requests.every(request => new Headers(request.init.headers).get('authorization') === 'Bearer run-credential')).toBe(true);
    const rejected = await client.callTool({ name: typed.name, arguments: { id: 4, runId: 'other', toolId: 'write', requireReadOnly: false } });
    expect(rejected.isError).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('installs before notification delivery, handles concurrent and repeated describes, and pins the first schema', async () => {
    let descriptors = [operation(), operation({ id: 'content.other' })];
    const fetchImpl: typeof fetch = async url => Response.json(descriptors.find(tool => String(url).endsWith(encodeURIComponent(tool.id))));
    const { client, serverTransport } = await bootWireServer({ tools: TOOL_CATALOG_TOOLS, fetchImpl, delegatedTools: { runId: 'run' } });
    const blocked = deferred<void>();
    const release = deferred<void>();
    const send = serverTransport.send.bind(serverTransport);
    let notifications = 0;
    serverTransport.send = async message => {
      if ('method' in message && message.method === 'notifications/tools/list_changed') {
        notifications++;
        if (notifications === 2) blocked.resolve();
        await release.promise;
      }
      await send(message);
    };
    const pending = ['content.read', 'content.other', 'content.read'].map(id => client.callTool({ name: 'describe_tool', arguments: { id } }));
    await blocked.promise;
    const during = await client.listTools();
    expect(during.tools.filter(tool => tool.annotations?.title?.startsWith('content.'))).toHaveLength(2);
    release.resolve();
    expect((await Promise.all(pending)).every(result => result.isError === undefined)).toBe(true);
    expect(notifications).toBe(2);
    descriptors = [operation({ inputSchema: { type: 'object', properties: { changed: { type: 'number' } } } })];
    const typed = await describeOperation(client);
    expect(typed.inputSchema).toEqual(concreteSchema);
    expect(notifications).toBe(2);
  });

  it('retries a failed notification on a repeated describe without duplicating or losing publication', async () => {
    const { client, serverTransport } = await bootWireServer({ tools: TOOL_CATALOG_TOOLS,
      fetchImpl: async () => Response.json(operation()), delegatedTools: { runId: 'run' } });
    const send = serverTransport.send.bind(serverTransport);
    let attempts = 0;
    serverTransport.send = async message => {
      if ('method' in message && message.method === 'notifications/tools/list_changed' && attempts++ === 0) throw new Error('notification unavailable');
      await send(message);
    };
    const first = await client.callTool({ name: 'describe_tool', arguments: { id: 'content.read' } });
    expect(first.isError).toBe(true);
    const typed = await describeOperation(client);
    expect(attempts).toBe(2);
    expect((await client.listTools()).tools.filter(tool => tool.name === typed.name)).toHaveLength(1);
  });

  it('does not publish failed, mismatched or malformed describes, or promote search results', async () => {
    let response = Response.json({ error: { message: 'denied' } }, { status: 403 });
    const { client } = await bootWireServer({ tools: TOOL_CATALOG_TOOLS,
      fetchImpl: async () => response.clone(), delegatedTools: { runId: 'run' } });
    const notified = vi.fn();
    client.setNotificationHandler(ToolListChangedNotificationSchema, notified);
    const call = () => client.callTool({ name: 'describe_tool', arguments: { id: 'content.read' } });
    expect((await call()).isError).toBe(true);
    response = Response.json(operation({ id: 'different' }));
    expect((await call()).isError).toBe(true);
    // `inputSchema: null` is a schema-less family (74791593): returned as info, never published — not malformed.
    for (const inputSchema of ['invalid', { type: 'string' }]) {
      response = Response.json(operation({ inputSchema }));
      const malformed = await call();
      expect(malformed.isError).toBe(true);
      expect(malformed.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('content.read.inputSchema') })]);
    }
    response = Response.json({ hits: [{ id: 'content.read', score: 1 }] });
    expect((await client.callTool({ name: 'search_tools', arguments: { query: 'read content' } })).isError).toBeUndefined();
    expect((await client.listTools()).tools).toHaveLength(2);
    expect(notified).not.toHaveBeenCalled();
    response = Response.json(operation());
    expect((await describeOperation(client)).inputSchema).toEqual(concreteSchema);
  });

  it('preloads startup descriptors, respects the count budget, and reserves static wire names', async () => {
    const initial = operation({ id: 'describe_tool' });
    const { client } = await bootWireServer({ tools: TOOL_CATALOG_TOOLS,
      fetchImpl: async () => Response.json(operation()), delegatedTools: { runId: 'run', initialTools: [initial], maxTools: 1 } });
    const listed = (await client.listTools()).tools;
    const typed = listed.find(tool => tool.annotations?.title === initial.id)!;
    expect(typed.name).not.toBe('describe_tool');
    expect(typed.inputSchema).toEqual(concreteSchema);
    expect((await client.callTool({ name: 'describe_tool', arguments: { id: 'content.read' } })).isError).toBeUndefined();
    expect((await client.listTools()).tools).toEqual(listed);
  });

  it('keeps schema extensions and treats missing read-only classification conservatively', async () => {
    const schema = { ...concreteSchema, $defs: { label: { type: 'string' } }, 'x-contract': 'kept' };
    const descriptor: ToolDescriptor = { id: 'unclassified', inputSchema: schema };
    const fixture = await daemonFixture([{ descriptor, policy: { authorize: () => 'allow' }, handler: async ctx => ctx.input }]);
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client, descriptor.id);
    expect(typed.inputSchema).toEqual(schema);
    expect(typed.annotations?.readOnlyHint).toBe(false);
    expect((await client.callTool({ name: typed.name, arguments: { id: 'x' } })).isError).toBeUndefined();
    const post = fixture.requests.find(request => request.init.method === 'POST')!;
    expect(JSON.parse(String(post.init.body))).not.toHaveProperty('requireReadOnly');
  });

  it('uses the shared delegated deadline override for a typed call', async () => {
    const fetchImpl: typeof fetch = async (_url, init = {}) => {
      if (init.method === 'GET') return Response.json(operation());
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    };
    const { client } = await bootWireServer({ tools: TOOL_CATALOG_TOOLS, fetchImpl,
      delegatedTools: { runId: 'run', delegatedToolTimeoutMs: 5 } });
    const typed = await describeOperation(client);
    const result = await client.callTool({ name: typed.name, arguments: { id: 'x' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'request to /api/delegated-tool-calls timed out after 5ms' }]);
  });

  it('keeps separate server runs isolated and skips over-budget schemas without evicting prior tools', async () => {
    const fetchImpl: typeof fetch = async () => Response.json(operation());
    const first = await bootWireServer({ tools: TOOL_CATALOG_TOOLS, fetchImpl,
      delegatedTools: { runId: 'first', maxSchemaBytes: Buffer.byteLength(JSON.stringify(concreteSchema)) } });
    const second = await bootWireServer({ tools: TOOL_CATALOG_TOOLS, fetchImpl,
      delegatedTools: { runId: 'second', maxSchemaBytes: 0 } });
    const typed = await describeOperation(first.client);
    expect((await second.client.callTool({ name: 'describe_tool', arguments: { id: 'content.read' } })).isError).toBeUndefined();
    expect((await second.client.listTools()).tools).toHaveLength(2);
    expect((await second.client.callTool({ name: typed.name, arguments: { id: 'x' } })).isError).toBe(true);
    expect((await first.client.listTools()).tools).toHaveLength(3);
  });

  it('rechecks policy, revocation and read-only metadata at typed invocation without an unconstrained retry', async () => {
    const handler = vi.fn(async () => 'never');
    const descriptor = operation();
    const fixture = await daemonFixture([{ descriptor, handler, policy: { authorize: () => 'deny' } }]);
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client);
    expect((await client.callTool({ name: typed.name, arguments: { id: 'x' } })).isError).toBe(true);
    fixture.scope.replace({ registrations: [{ descriptor: { ...descriptor, readOnly: false }, handler, policy: { authorize: () => 'allow' } }] });
    const refused = await client.callTool({ name: typed.name, arguments: { id: 'x' } });
    expect(refused.isError).toBe(true);
    fixture.scope.replace({ registrations: [] });
    expect((await client.callTool({ name: typed.name, arguments: { id: 'x' } })).isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    const posts = fixture.requests.filter(request => request.init.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(posts.every(request => JSON.parse(String(request.init.body)).requireReadOnly === true)).toBe(true);
  });

  it('preserves nested read-only enforcement at the existing executor boundary', async () => {
    const write = vi.fn(async () => 'written');
    let invokeNested!: ToolRegistration['handler'];
    const outer: ToolRegistration = { descriptor: operation(), policy: { authorize: () => 'allow' },
      handler: ctx => invokeNested(ctx) };
    const fixture = await daemonFixture([outer, { descriptor: operation({ id: 'content.write', readOnly: false, inputSchema: { type: 'object' } }), policy: { authorize: () => 'allow' }, handler: write }]);
    // A host's nested/recovery dispatch uses its existing constrained executor, retaining principal.
    invokeNested = ctx => fixture.toolExecutor.execute({ principal: ctx.principal, run: ctx.run, toolId: 'content.write', input: {} });
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client);
    const result = await client.callTool({ name: typed.name, arguments: { id: 'x' } });
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({ output: { status: 'denied' } });
    expect(write).not.toHaveBeenCalled();
  });

  for (const decision of ['confirm', 'deny'] as const) it(`preserves ${decision} confirmation through typed and legacy ingress`, async () => {
    const confirm = vi.fn(() => decision);
    const handler = vi.fn(async () => 'finished');
    const fixture = await daemonFixture([{ descriptor: operation({ readOnly: false, requiresConfirmation: true }),
      policy: { authorize: () => 'allow' }, handler }], { onConfirm: confirm });
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client);
    expect(typed.annotations?.readOnlyHint).toBe(false);
    const concrete = await client.callTool({ name: typed.name, arguments: { id: 'x' } });
    const legacy = await client.callTool({ name: 'execute_delegated_tool', arguments: { toolId: 'content.read', input: { id: 'x' } } });
    expect(concrete.isError).toBe(legacy.isError);
    expect(concrete.isError).toBe(decision === 'deny' ? true : undefined);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(decision === 'confirm' ? 2 : 0);
    expect(fixture.requests.filter(request => request.init.method === 'POST').every(request => !Object.hasOwn(JSON.parse(String(request.init.body)), 'requireReadOnly'))).toBe(true);
  });

  for (const typedIngress of [true, false]) it(`propagates MCP cancellation while confirmation is pending (${typedIngress ? 'typed' : 'legacy'})`, async () => {
    const pending = deferred<string>();
    const handler = vi.fn(async () => 'never');
    const fixture = await daemonFixture([{ descriptor: operation({ readOnly: false, requiresConfirmation: true }),
      policy: { authorize: () => 'allow' }, handler }], { onConfirm: ({ executionId }) => { pending.resolve(executionId); } });
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client);
    const controller = new AbortController();
    const call = client.callTool({ name: typedIngress ? typed.name : 'execute_delegated_tool',
      arguments: typedIngress ? { id: 'x' } : { toolId: 'content.read', input: { id: 'x' } } }, undefined, { signal: controller.signal }).catch((error: unknown) => error);
    const executionId = await pending.promise;
    const aborted = deferred<void>();
    const signal = fixture.requests.find(request => request.init.method === 'POST')!.init.signal!;
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    controller.abort(new Error('client cancelled'));
    await call;
    await aborted.promise;
    // The actual executor records cancellation, and its pending confirmation cannot execute later.
    await vi.waitFor(() => expect(fixture.toolExecutor.getAuditRecord({ executionId })?.events.at(-1)?.phase).toBe('cancelled'));
    expect(() => fixture.toolExecutor.resumeConfirmation({ executionId, decision: 'confirm' })).toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  for (const output of [
    { content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] },
    { batch: true, outcome: 'partial_failure', results: [{ index: 0, ok: true, result: 'one' }, { index: 1, ok: false, error: 'bad' }] },
    { content: [{ type: 'text', text: 'tool refused' }], isError: true },
  ]) it(`preserves image, batch and error results through typed and legacy ingress: ${JSON.stringify(output).slice(0, 65)}`, async () => {
    const fixture = await daemonFixture([{ descriptor: operation(), policy: { authorize: () => 'allow' }, handler: async () => output }]);
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const typed = await describeOperation(client);
    const concrete = await client.callTool({ name: typed.name, arguments: { id: 'x' } });
    const legacy = await client.callTool({ name: 'execute_readonly_delegated_tool', arguments: { toolId: 'content.read', input: { id: 'x' } } });
    expect(concrete.isError).toBe(legacy.isError);
    if ('content' in output) {
      expect(concrete.content).toEqual(output.content);
      expect(legacy.content).toEqual(output.content);
      expect(concrete.isError).toBe('isError' in output ? true : undefined);
    } else {
      expect(concrete.isError).toBe(true);
      const envelope = JSON.parse((concrete.content as { text: string }[])[0]!.text);
      expect(envelope).toMatchObject({ output, isError: true, status: 'partial_failure' });
    }
  });

  it('keeps federation frozen at connect when upstream tools later change', async () => {
    let remoteTools = [{ name: 'inspect', inputSchema: { type: 'object' as const }, annotations: { readOnlyHint: true } }];
    const list = vi.fn(async () => remoteTools);
    const session = new InMemoryMcpSession({ tools: [] }, { onListTools: list });
    onTestFinished(() => session.close({}));
    const { registrations } = await federateSession({ session, nativeToolIds: new Set(),
      config: { connectionId: 'frozen', label: 'Frozen', allowedToolNames: ['inspect', 'later'], writeAllowedToolNames: [],
        connectTimeoutMs: 100, callTimeoutMs: 100, maxResultBytes: 4096, maxTools: 5, readOnlyRemoteNames: new Set(['inspect', 'later']) },
      deps: { messages: defaultFederationMessages, errorCode: 'EXTERNAL_MCP', permissionGate: async () => {} },
    });
    expect(registrations).toHaveLength(1);
    const fixture = await daemonFixture(registrations);
    const { client } = await bootWireServer({ tools: fixture.tools, fetchImpl: fixture.fetchImpl, delegatedTools: { runId: fixture.run.id } });
    const admitted = registrations[0]!.descriptor.id;
    const typed = await describeOperation(client, admitted);
    remoteTools = [...remoteTools, { name: 'later', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }];
    const unadmitted = admitted.replace(/inspect$/, 'later');
    expect((await client.callTool({ name: 'describe_tool', arguments: { id: unadmitted } })).isError).toBe(true);
    expect((await client.callTool({ name: typed.name, arguments: {} })).isError).toBeUndefined();
    expect(list).toHaveBeenCalledOnce();
    expect(session.calls.map(call => call.name)).toEqual(['inspect']);
    expect((await client.listTools()).tools).toHaveLength(fixture.tools.length + 1);
  });
});
