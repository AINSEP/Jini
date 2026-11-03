import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerLike } from '../tool-server.js';

type Call = (input: { request: { params: { name: string; arguments?: Record<string, unknown> } } }, options?: { extra?: { signal?: AbortSignal } }) => Promise<CallToolResult>;

/** Capture SDK boundary handlers only; name resolution, validation and gateways run in production. */
export function createToolServerCapture(_input = {}, _options = {}) {
  let call!: Call;
  let list!: () => Promise<ListToolsResult>;
  let connected!: () => void;
  const ready = new Promise<void>(resolve => { connected = resolve; });
  const server: McpServerLike = {
    setRequestHandler: (({ schema, handler }: { schema: unknown; handler: unknown }) => {
      if (schema === CallToolRequestSchema) call = handler as Call;
      if (schema === ListToolsRequestSchema) list = handler as typeof list;
    }) as McpServerLike['setRequestHandler'],
    connect: async () => { connected(); },
    sendToolListChanged: async () => {},
  };
  return { server, ready,
    call: async (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => {
      await ready;
      return call({ request: { params: { name, arguments: args } } }, { extra: { ...(signal ? { signal } : {}) } });
    },
    list: async () => { await ready; return list(); },
  };
}
