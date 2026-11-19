import type { Readable, Writable } from 'node:stream';
import { Server, type ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, type Implementation, type CallToolResult, type ListResourcesResult, type ListToolsResult, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerLike } from '../tool-server.js';
import type { McpTransportLike } from '../ports.js';
import type { CallProgressExtra } from '../call-progress.js';
import { adaptSdkTransport, resolveSdkTransport } from './sdk-transport.js';

export type SdkServerInfo = Implementation;
export type SdkServerOptions = ServerOptions;
export type SdkRequestSchemas = {
  listTools: typeof ListToolsRequestSchema;
  callTool: typeof CallToolRequestSchema;
  listResources: typeof ListResourcesRequestSchema;
  readResource: typeof ReadResourceRequestSchema;
};

// SDK objects remain behind these adapters; hosts implement the object-shaped ports above.
export function defaultCreateServer({ info, options }: { info: SdkServerInfo; options: SdkServerOptions }, _optional: Record<string, never> = {}): McpServerLike {
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

export function defaultCreateTransport(_requiredArgs: Record<string, never>, { stdin, stdout }: { stdin?: Readable; stdout?: Writable } = {}): McpTransportLike {
  return adaptSdkTransport({ transport: new StdioServerTransport(stdin, stdout) });
}

/** Bind tool verbs to the pinned SDK schemas, retaining the public schema-shaped port. */
export function bindSdkToolHandlers({ server, listTools, callTool }: {
  server: McpServerLike;
  listTools: () => Promise<ListToolsResult>;
  callTool: () => (required: { request: { params: { name: string; arguments?: Record<string, unknown> } } }, optional?: { extra?: CallProgressExtra }) => Promise<CallToolResult>;
}, _optional: Record<string, never> = {}): void {
  server.setRequestHandler({ schema: ListToolsRequestSchema, handler: listTools });
  server.setRequestHandler({ schema: CallToolRequestSchema, handler: callTool() });
}

/** Bind resource verbs only for hosts that advertise resources. */
export function bindSdkResourceHandlers({ server, listResources, readResource }: {
  server: McpServerLike;
  listResources: () => Promise<ListResourcesResult>;
  readResource: () => (required: { request: { params: { uri: string } } }) => Promise<ReadResourceResult>;
}, _optional: Record<string, never> = {}): void {
  server.setRequestHandler({ schema: ListResourcesRequestSchema, handler: listResources });
  server.setRequestHandler({ schema: ReadResourceRequestSchema, handler: readResource() });
}
