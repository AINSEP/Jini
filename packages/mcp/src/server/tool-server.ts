/**
 * @module @jini-ai/mcp/server/tool-server
 *
 * `createMcpToolServer` — the generic stdio MCP server hosting mechanism.
 * Ported from the *mechanism* of OD's `apps/daemon/src/mcp.ts` `runMcpStdio`
 * (idle-exit lifecycle, `Server` + `StdioServerTransport` wiring, holding the
 * process open until stdin closes) with the OD-specific parts — the
 * hardcoded 18-tool `TOOL_DEFS`, the `od://` resource scheme, the
 * project/skill/plugin `instructions` prose — replaced by a caller-supplied,
 * bounded, explicit `tools: readonly McpToolDef[]` list. A caller is the
 * *first* user of this mechanism, not the only one it will ever support (see
 * `source-map.md`'s 2026-07-21 addition for the full design-decision note).
 *
 * `tools` capability is always advertised (`capabilities: {tools: {}}`).
 * `resources` capability (`ListResourcesRequestSchema`/
 * `ReadResourceRequestSchema`, mirroring the tools wiring one section down)
 * is advertised only when the caller supplies at least one entry in the
 * optional `resources` option — a 2026-07-21 addition once this package
 * shipped its first genuinely portable resource (`../resources/
 * active-resource.js`'s `jini://active`, see that file's module doc and
 * `source-map.md`'s 2026-07-21 addition for why the *rest* of OD's resource
 * surface — `od://skills/...`, `od://design-systems/...` — still has no
 * kernel equivalent and stays unported). A caller passing no `resources`
 * gets the exact same `capabilities: {tools: {}}`-only server this module
 * always produced.
 */
import type { Readable, Writable } from 'node:stream';
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

/** Auto-exit an idle server after this long with no tool activity — same ceiling the OD origin used for its own stdio MCP server. */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/**
 * The minimal surface this module needs from an MCP `Server` instance. A real
 * `@modelcontextprotocol/sdk` `Server` satisfies this structurally (its own `setRequestHandler`
 * is more general — one generic method covering every request schema — and TS accepts the
 * narrowing); a test can substitute a lightweight fake without spinning up a real transport.
 * Method-shorthand syntax (not arrow-typed properties) is deliberate: it keeps parameter checking
 * bivariant, so a handler typed against a *specific* request shape (as the two internal handlers
 * below are) is still assignable here even under `strict`.
 */
export interface McpServerLike {
  setRequestHandler(schema: typeof ListToolsRequestSchema, handler: () => Promise<ListToolsResult>): void;
  setRequestHandler(
    schema: typeof CallToolRequestSchema,
    handler: (request: { params: { name: string; arguments?: Record<string, unknown> } }) => Promise<CallToolResult>,
  ): void;
  setRequestHandler(schema: typeof ListResourcesRequestSchema, handler: () => Promise<ListResourcesResult>): void;
  setRequestHandler(
    schema: typeof ReadResourceRequestSchema,
    handler: (request: { params: { uri: string } }) => Promise<ReadResourceResult>,
  ): void;
  connect(transport: McpTransportLike): Promise<void>;
}

/** The minimal surface this module needs from an MCP transport. A real `StdioServerTransport` satisfies this structurally. */
export interface McpTransportLike {
  onmessage?: ((message: unknown) => void) | undefined;
  onclose?: (() => void) | undefined;
  close(): Promise<void>;
}

export interface McpToolServerOptions {
  /** Advertised to the MCP client during initialization. */
  readonly name: string;
  readonly version: string;
  /** The bounded, explicit tool list this server hosts. Duplicate names throw at construction time. */
  readonly tools: readonly McpToolDef[];
  /** The bounded, explicit read-only resource list this server hosts. Duplicate uris throw at construction time. Omit (or pass an empty array) for a tools-only server — `capabilities.resources` is only advertised when this is non-empty. */
  readonly resources?: readonly McpResourceDef[];
  /** Resolves the daemon HTTP base URL once, at the start of {@link McpToolServerHandle.run}. May be sync or async (e.g. wraps `@jini-ai/cli`'s `resolveDaemonUrl`). */
  readonly resolveBaseUrl: () => Promise<string> | string;
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
  readonly createServer?: (info: Implementation, options: ServerOptions) => McpServerLike;
  /** Test/embedding seam: builds the underlying transport. Defaults to the real `StdioServerTransport`. */
  readonly createTransport?: (stdin?: Readable, stdout?: Writable) => McpTransportLike;
}

export interface McpToolServerHandle {
  /**
   * Resolves the daemon base URL, connects the MCP server to its transport, and holds the process
   * open until the client disconnects (stdin EOF) or the idle-exit window elapses. Resolves once
   * the transport has closed.
   */
  run(): Promise<void>;
}

function defaultCreateServer(info: Implementation, options: ServerOptions): McpServerLike {
  return new Server(info, options) as unknown as McpServerLike;
}

function defaultCreateTransport(stdin?: Readable, stdout?: Writable): McpTransportLike {
  return new StdioServerTransport(stdin, stdout) as unknown as McpTransportLike;
}

/**
 * Builds a stdio MCP server hosting `options.tools` (and, optionally, `options.resources`).
 * Construction is synchronous and cheap (validates tool-name uniqueness via
 * {@link buildToolIndex} and resource-uri uniqueness via {@link buildResourceIndex}); all I/O —
 * resolving the daemon URL, connecting the transport, serving requests — happens in the returned
 * handle's `run()`.
 */
export function createMcpToolServer(options: McpToolServerOptions): McpToolServerHandle {
  const toolIndex = buildToolIndex(options.tools);
  const resources = options.resources ?? [];
  const resourceIndex = buildResourceIndex(resources);
  const createServer = options.createServer ?? defaultCreateServer;
  const createTransport = options.createTransport ?? defaultCreateTransport;

  return {
    async run(): Promise<void> {
      const resolvedBaseUrl = await options.resolveBaseUrl();
      const ctx: McpToolContext = {
        baseUrl: String(resolvedBaseUrl).replace(/\/$/, ''),
        fetchImpl: options.fetchImpl ?? fetch,
        ...(options.authHeaders !== undefined ? { authHeaders: options.authHeaders } : {}),
      };

      let closeTransportForIdle: (() => void) | null = null;
      const idleExit = createMcpIdleExitController({
        idleMs: options.idleMs ?? DEFAULT_IDLE_MS,
        onIdle: () => closeTransportForIdle?.(),
      });
      const withActivity =
        <Args extends unknown[], Result>(handler: (...args: Args) => Result | Promise<Result>) =>
          (...args: Args) =>
            idleExit.trackRequest(() => handler(...args));

      const server = createServer(
        { name: options.name, version: options.version },
        {
          capabilities: { tools: {}, ...(resources.length > 0 ? { resources: {} } : {}) },
          ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
        },
      );

      server.setRequestHandler(
        ListToolsRequestSchema,
        withActivity(async () => ({ tools: toolsToList(options.tools) })),
      );

      server.setRequestHandler(
        CallToolRequestSchema,
        withActivity(async (request) => handleToolCall(request.params.name, request.params.arguments, toolIndex, ctx)),
      );

      if (resources.length > 0) {
        server.setRequestHandler(
          ListResourcesRequestSchema,
          withActivity(async () => ({ resources: resourcesToList(resources) })),
        );

        server.setRequestHandler(
          ReadResourceRequestSchema,
          withActivity(async (request) => handleResourceRead(request.params.uri, resourceIndex, ctx)),
        );
      }

      const transport = createTransport(options.stdin, options.stdout);
      try {
        closeTransportForIdle = () => {
          void transport.close().catch(() => {});
        };
        await server.connect(transport);

        // `connect()` sets `transport.onmessage` to its own protocol-dispatch handler; wrap it so
        // every inbound message also counts as activity for the idle-exit timer, without losing
        // the SDK's own routing.
        const sdkOnMessage = transport.onmessage;
        transport.onmessage = (message) => {
          idleExit.noteActivity();
          sdkOnMessage?.(message);
        };

        const stdin = options.stdin ?? process.stdin;
        await new Promise<void>((resolve) => {
          const sdkOnClose = transport.onclose;
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            idleExit.dispose();
            resolve();
          };
          transport.onclose = () => {
            sdkOnClose?.();
            done();
          };
          const closeTransportForStdin = () => {
            void transport.close().catch(() => done());
          };
          // Hold the process open until the client disconnects (stdin EOF) — `connect()` only
          // starts the transport, it doesn't wait for the stream to close.
          stdin.once('end', closeTransportForStdin);
          stdin.once('close', closeTransportForStdin);
        });
      } finally {
        idleExit.dispose();
        closeTransportForIdle = null;
      }
    },
  };
}
