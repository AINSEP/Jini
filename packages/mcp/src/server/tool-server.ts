/**
 * @module @jini-ai/mcp/server/tool-server
 * Generic stdio hosting for an explicit caller-supplied tool list. Construction validates unique
 * names synchronously without I/O; run resolves the daemon URL, connects and serves until closure.
 * Tools capability is always advertised; resources only when nonempty resources are supplied.
 * Narrow object-shaped server/transport ports permit DI fakes without requiring SDK class instances
 * with nominal private fields; default adapters translate those contracts to the real SDK.
 */
import type { Readable, Writable } from 'node:stream';
import { createToolExposure, type ToolDescriptor } from '@jini-ai/core';
import type { McpTransportLike } from './ports.js';
export type { McpTransportLike } from './ports.js';
import { adaptSdkTransport, resolveSdkTransport } from './sdk-transport.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  Implementation,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpIdleExitController } from '../client/client.js';
import { buildResourceIndex, handleResourceRead, resourcesToList, type McpResourceDef } from './resource-protocol.js';
import { buildToolIndex, handleToolCall, toolsToList, type McpToolContext, type McpToolDef } from './tool-protocol.js';
import { createTypedDelegatedToolTool, type CreateExecuteDelegatedToolToolOptions } from './tools/delegated-tool.js';
import { prependRunUserMessages, type McpMessageRelay } from './message-relay.js';

/** Auto-exit an idle server after this long without tool activity. */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/** Object-shaped server port. The default adapter translates it to the SDK interface. */
// Method shorthand deliberately keeps parameter checking bivariant under strict TypeScript,
// allowing handlers narrowed to the specific request schema each overload registers.
export interface McpServerLike {
  setRequestHandler(args: { schema: typeof ListToolsRequestSchema; handler: () => Promise<ListToolsResult> }): void;
  setRequestHandler(args: {
    schema: typeof CallToolRequestSchema;
    handler: (
      requiredArgs: { request: { params: { name: string; arguments?: Record<string, unknown> } } },
      optionalArgs?: { extra?: { signal?: AbortSignal } },
    ) => Promise<CallToolResult>;
  }): void;
  setRequestHandler(args: { schema: typeof ListResourcesRequestSchema; handler: () => Promise<ListResourcesResult> }): void;
  setRequestHandler(args: {
    schema: typeof ReadResourceRequestSchema;
    handler: (requiredArgs: { request: { params: { uri: string } } }) => Promise<ReadResourceResult>;
  }): void;
  connect(args: { transport: McpTransportLike }): Promise<void>;
  /** Optional for static embeddings; required when delegated publication is enabled. */
  sendToolListChanged?(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Required identity, tool surface, and daemon URL resolver. */
export interface McpToolServerRequiredArgs {
  /** Identity advertised to the MCP client during initialization. */
  readonly name: string;
  readonly version: string;
  /** Duplicate tool names throw at construction. */
  readonly tools: readonly McpToolDef[];
  /** Resolves once when the returned handle runs. */
  readonly resolveBaseUrl: () => Promise<string> | string;
}

export interface McpToolServerOptions {
  /** Set only by relay-enabled spawns; native input engines incur no extra request or tool. */
  readonly messageRelay?: McpMessageRelay;
  /** Opt in to bounded, per-run typed publication after describe_tool. */
  readonly delegatedTools?: McpDelegatedToolsOptions;
  /** Trusted daemon registration IDs carried into every error sanitizer. */
  readonly diagnosticToolIds?: readonly string[];
  /** The bounded, explicit read-only resource list this server hosts. Duplicate uris throw at construction time. Omit (or pass an empty array) for a tools-only server — `capabilities.resources` is only advertised when this is non-empty. */
  readonly resources?: readonly McpResourceDef[];
  /** Free-text guidance surfaced to the MCP client alongside the tool list. Optional — omit for a caller with nothing to add beyond each tool's own `description`. */
  readonly instructions?: string;
  /** Idle-exit window in ms. Defaults to {@link DEFAULT_IDLE_MS}. */
  readonly idleMs?: number;
  /** Defaults to the global `fetch`; threaded into every tool call's {@link McpToolContext}. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Headers attached to every daemon call this server's tools and resources make — in practice the
   * bearer credential the spawning daemon issued for this run. Omit for a daemon whose `/api` surface
   * does not require one; omitting is the pre-existing behavior.
   */
  readonly authHeaders?: Readonly<Record<string, string>>;
  /** Defaults to `process.stdin`; inject for tests (or an alternate stdio pair). */
  readonly stdin?: Readable;
  /** Defaults to `process.stdout`; inject for tests. */
  readonly stdout?: Writable;
  /** Test/embedding seam: builds the underlying `Server`. Defaults to the real `@modelcontextprotocol/sdk` `Server`. */
  readonly createServer?: (args: { info: Implementation; options: ServerOptions }) => McpServerLike;
  /** Test/embedding seam: builds the underlying transport. Defaults to the real `StdioServerTransport`. */
  readonly createTransport?: (requiredArgs: Record<string, never>, optionalArgs?: { stdin?: Readable; stdout?: Writable }) => McpTransportLike;
}

/** The admitted host descriptors supplied here must come from the existing registry/catalog.
 * Publication never connects to a federated server or admits its upstream list changes.
 */
export interface McpDelegatedToolsOptions extends CreateExecuteDelegatedToolToolOptions {
  readonly runId: string;
  /** Resolve these through the authenticated daemon before running a client without refresh. */
  readonly initialTools?: readonly ToolDescriptor[];
  /** Defaults to F0's 64 tools and 256 KiB of schemas; new entries are skipped at the cap. */
  readonly maxTools?: number;
  readonly maxSchemaBytes?: number;
}

export interface McpToolServerHandle {
  /**
   * Resolves the daemon base URL, connects the MCP server to its transport, and holds the process
   * open until the client disconnects (stdin EOF) or the idle-exit window elapses. Resolves once
   * the transport has closed.
   */
  run(required: Record<string, never>): Promise<void>;
}

// SDK objects remain behind these adapters; hosts implement the object-shaped ports above.
function defaultCreateServer({ info, options }: { info: Implementation; options: ServerOptions }): McpServerLike {
  const server = new Server(info, options);
  return {
    setRequestHandler: (({ schema, handler }: {
      schema: Parameters<Server['setRequestHandler']>[0];
      handler: (...args: any[]) => Promise<any>;
    }) => server.setRequestHandler(schema, (request, extra) => handler({ request }, { extra }))) as McpServerLike['setRequestHandler'],
    connect: ({ transport }) => server.connect(resolveSdkTransport({ transport })),
    sendToolListChanged: () => server.sendToolListChanged(),
  };
}

function defaultCreateTransport(_requiredArgs: Record<string, never>, { stdin, stdout }: { stdin?: Readable; stdout?: Writable } = {}): McpTransportLike {
  return adaptSdkTransport({ transport: new StdioServerTransport(stdin, stdout) });
}

/**
 * The tool context shared by every call in one run: the resolved daemon URL without its trailing
 * slash (coerced to a string for JS hosts that ignore the contract), the configured or global
 * `fetch`, and the auth headers and diagnostic IDs only when configured.
 */
function buildToolContext({ resolvedBaseUrl }: { resolvedBaseUrl: string }, options: McpToolServerOptions): McpToolContext {
  return {
    ...(options.diagnosticToolIds !== undefined ? { diagnosticToolIds: options.diagnosticToolIds } : {}),
    baseUrl: String(resolvedBaseUrl).replace(/\/$/, ''),
    fetchImpl: options.fetchImpl ?? fetch,
    ...(options.authHeaders !== undefined ? { authHeaders: options.authHeaders } : {}),
  };
}

/** The stdio pair handed to `createTransport`, carrying only the streams the caller configured. */
function stdioOptions(options: McpToolServerOptions): { stdin?: Readable; stdout?: Writable } {
  return {
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
  };
}

/**
 * Own only the MCP projection/dispatch index. F0 owns immutable exposure, and the daemon catalog
 * supplies each descriptor; the temporary source below is not another definition catalog.
 * @returns An install-before-notify publisher, or undefined for a static server.
 * @throws On malformed schemas, invalid exposure limits, or an embedding without notification support.
 * @complexity O(n + s) per promotion for n bounded exposed tools and s schema bytes; no daemon I/O.
 */
function createToolPublisher({ index, server, options }: {
  index: Map<string, McpToolDef>; server: McpServerLike; options: McpDelegatedToolsOptions | undefined;
}): McpToolContext['publishTool'] {
  if (!options) return undefined;
  const notify = server.sendToolListChanged?.bind(server);
  if (!notify) throw new Error('delegated publication requires tools/list_changed support');
  let descriptors = options.initialTools ?? [];
  const exposure = createToolExposure({ registry: { list: () => descriptors } }, {
    reservedNames: [...index.keys()],
    ...(options.maxTools === undefined ? {} : { maxTools: options.maxTools }),
    ...(options.maxSchemaBytes === undefined ? {} : { maxSchemaBytes: options.maxSchemaBytes }),
  });
  // Validate before promotion: malformed descriptors must not consume a pinned name or budget.
  const validate = (descriptor: ToolDescriptor) => createTypedDelegatedToolTool({ runId: options.runId, tool: { wireName: descriptor.id, descriptor } }, options);
  for (const descriptor of descriptors) validate(descriptor);
  const initial = exposure.promote({ toolIds: descriptors.map(descriptor => descriptor.id) });
  for (const tool of initial.snapshot.tools) index.set(tool.wireName, createTypedDelegatedToolTool({ runId: options.runId, tool }, options));
  descriptors = [];
  let notificationPending = false;
  return async ({ descriptor }, _optional = {}) => {
    validate(descriptor);
    descriptors = [descriptor];
    const delta = exposure.promote({ toolIds: [descriptor.id] });
    descriptors = [];
    for (const tool of delta.snapshot.tools) {
      if (!index.has(tool.wireName)) index.set(tool.wireName, createTypedDelegatedToolTool({ runId: options.runId, tool }, options));
    }
    if (delta.added.length > 0) notificationPending = true;
    if (!notificationPending) return;
    // Clear before awaiting: a concurrent promotion must retain its own unsent notification.
    notificationPending = false;
    try { await notify({}); } catch (error) { notificationPending = true; throw error; }
  };
}

/**
 * Builds a stdio MCP server hosting `requiredArgs.tools` (and, optionally, `options.resources`).
 * Construction is synchronous and cheap (validates tool-name uniqueness via
 * {@link buildToolIndex} and resource-uri uniqueness via {@link buildResourceIndex}); all I/O —
 * resolving the daemon URL, connecting the transport, serving requests — happens in the returned
 * handle's `run()`.
 */
export function createMcpToolServer(requiredArgs: McpToolServerRequiredArgs, options: McpToolServerOptions = {}): McpToolServerHandle {
  // Validate eagerly, but keep the mutable dispatch index inside run() so re-runs are isolated.
  buildToolIndex({ tools: requiredArgs.tools });
  const resources = options.resources ?? [];
  const resourceIndex = buildResourceIndex({ resources });
  const createServer = options.createServer ?? defaultCreateServer;
  const createTransport = options.createTransport ?? defaultCreateTransport;

  return {
    async run(_required: Record<string, never>): Promise<void> {
      const toolIndex = buildToolIndex({ tools: requiredArgs.tools });
      let ctx = buildToolContext({ resolvedBaseUrl: await requiredArgs.resolveBaseUrl() }, options);

      const server = createServer({
        info: { name: requiredArgs.name, version: requiredArgs.version },
        options: {
          capabilities: { tools: options.delegatedTools ? { listChanged: true } : {}, ...(resources.length > 0 ? { resources: {} } : {}) },
          ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
        },
      });

      const publishTool = createToolPublisher({ index: toolIndex, server, options: options.delegatedTools });
      if (publishTool) ctx = { ...ctx, publishTool };

      let closeTransportForIdle: (() => void) | null = null;
      const idleExit = createMcpIdleExitController({
        idleMs: options.idleMs ?? DEFAULT_IDLE_MS,
        onIdle: () => closeTransportForIdle?.(),
      });
      const withActivity =
        <Args extends unknown[], Result>(handler: (...args: Args) => Result | Promise<Result>) =>
          (...args: Args) =>
            idleExit.trackRequest({ fn: () => handler(...args) });

      server.setRequestHandler({
        schema: ListToolsRequestSchema,
        handler: withActivity(async () => ({ tools: toolsToList({ tools: [...toolIndex.values()] }) })),
      });

      server.setRequestHandler({
        schema: CallToolRequestSchema,
        handler: withActivity(async ({ request }: { request: { params: { name: string; arguments?: Record<string, unknown> } } }, { extra }: { extra?: { signal?: AbortSignal } } = {}) => {
          const callContext = extra?.signal !== undefined ? { ...ctx, signal: extra.signal } : ctx;
          const result = await handleToolCall({ name: request.params.name, tools: toolIndex, ctx: callContext }, { rawArgs: request.params.arguments });
          if (!options.messageRelay || request.params.name === 'check_messages') return result;
          return prependRunUserMessages({ result, relay: options.messageRelay, ctx: callContext });
        }),
      });

      if (resources.length > 0) {
        server.setRequestHandler({
          schema: ListResourcesRequestSchema,
          handler: withActivity(async () => ({ resources: resourcesToList({ resources }) })),
        });

        server.setRequestHandler({
          schema: ReadResourceRequestSchema,
          handler: withActivity(async ({ request }: { request: { params: { uri: string } } }) => handleResourceRead({ uri: request.params.uri, resources: resourceIndex, ctx })),
        });
      }

      const transport = createTransport({}, stdioOptions(options));
      try {
        closeTransportForIdle = () => {
          void transport.close({}).catch(() => {});
        };
        await server.connect({ transport });

        // `connect()` sets `transport.onmessage` to its own protocol-dispatch handler; wrap it so
        // every inbound message also counts as activity for the idle-exit timer, without losing
        // the SDK's own routing.
        const sdkOnMessage = transport.onmessage;
        transport.onmessage = ({ message }) => {
          idleExit.noteActivity({});
          sdkOnMessage?.({ message });
        };

        const stdin = options.stdin ?? process.stdin;
        await new Promise<void>((resolve) => {
          const sdkOnClose = transport.onclose;
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            idleExit.dispose({});
            resolve();
          };
          transport.onclose = () => {
            sdkOnClose?.();
            done();
          };
          const closeTransportForStdin = () => {
            void transport.close({}).catch(() => done());
          };
          // Hold the process open until the client disconnects (stdin EOF) — `connect()` only
          // starts the transport, it doesn't wait for the stream to close.
          stdin.once('end', closeTransportForStdin);
          stdin.once('close', closeTransportForStdin);
        });
      } finally {
        idleExit.dispose({});
        closeTransportForIdle = null;
      }
    },
  };
}
