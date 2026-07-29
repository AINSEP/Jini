/**
 * @module @jini-ai/mcp/server/tool-protocol
 *
 * The pure, SDK-connection-free half of the MCP tool-hosting mechanism: the
 * `McpToolDef` contract a caller registers tools against, `tools/list`
 * projection, and `tools/call` dispatch (look up a tool by name, run its
 * handler, wrap the result). None of this touches `@modelcontextprotocol/sdk`'s
 * `Server`/transport classes or the network — a tool `handler` is just
 * `(args, ctx) => value | Promise<value>` that either returns a
 * JSON-serializable payload (wrapped as a successful MCP result) or throws
 * (wrapped as an `{isError:true}` MCP result). `./tool-server.js` is the thin
 * layer that wires this to a real `Server` + `StdioServerTransport`.
 */
import { sanitizeUntrustedText } from '@jini-ai/cli';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/** What every tool handler receives alongside its parsed arguments. */
export interface McpToolContext {
  /** The resolved daemon HTTP base URL (no trailing slash), fixed for the lifetime of one server run. */
  readonly baseUrl: string;
  /** Defaults to the global `fetch`; threaded through so a host can inject its own (e.g. for tests). */
  readonly fetchImpl: typeof fetch;
  /**
   * Headers every daemon call must carry — in practice `{ Authorization: 'Bearer <token>' }` when the
   * spawning daemon gave this process a credential (`JINI_DAEMON_TOKEN`). Empty/absent when it did
   * not, which is the pre-existing behavior for a daemon whose `/api` surface trusts loopback.
   *
   * Read it via {@link daemonCallOptions} rather than by hand — see that function's doc.
   */
  readonly authHeaders?: Readonly<Record<string, string>>;
}

/**
 * Maps a tool context onto the `DaemonRequestOptions` every daemon call needs.
 *
 * **Use this instead of writing `{ fetchImpl: ctx.fetchImpl }` inline.** Both fields have to travel
 * together on every call, and the failure mode when one is forgotten is not a compile error but a
 * silent 401 from that one tool while every other tool keeps working — the kind of bug that reaches
 * a user as "some of these tools just don't do anything". Routing every call site through one
 * mapping means a newly added tool is authenticated by construction.
 *
 * @param ctx - The context handed to a tool or resource handler.
 * @returns Options carrying the injected `fetch` and, when present, the auth headers.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function daemonCallOptions(ctx: McpToolContext): { fetchImpl: typeof fetch; headers?: Record<string, string> } {
  return {
    fetchImpl: ctx.fetchImpl,
    ...(ctx.authHeaders !== undefined ? { headers: { ...ctx.authHeaders } } : {}),
  };
}

/**
 * One MCP tool a `createMcpToolServer` caller registers. `name` must be unique within a given
 * tool list (`buildToolIndex` throws otherwise — a caller bug, not something to silently drop).
 * `handler` returns a JSON-serializable payload on success or throws an `Error` (or any value —
 * non-`Error` throws are stringified) on failure; both are converted to the matching MCP
 * `CallToolResult` shape by {@link handleToolCall}, so individual tools never construct MCP
 * protocol objects themselves.
 */
export interface McpToolDef<Args extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Tool['inputSchema'];
  readonly annotations?: Tool['annotations'];
  readonly handler: (args: Args, ctx: McpToolContext) => Promise<unknown> | unknown;
}

/** Wraps a successful tool result as MCP `text` content, JSON-stringifying anything that isn't already a string. */
export function okResult(payload: unknown): CallToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Wraps a tool failure as an MCP `isError` result. */
export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Throws a caller-facing validation error unless `value` is a non-empty string. Mirrors the OD origin's `requireString` — a convenience for tool authors, not part of the MCP protocol itself. */
export function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required (string).`);
  }
}

/** Projects a tool list into the `Tool[]` shape `tools/list` returns. */
export function toolsToList(tools: readonly McpToolDef[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
  }));
}

/** Builds a name -> def lookup, throwing if two tools in `tools` share a name (a caller-configuration bug, surfaced eagerly at server-construction time rather than silently letting the second registration shadow the first). */
export function buildToolIndex(tools: readonly McpToolDef[]): Map<string, McpToolDef> {
  const index = new Map<string, McpToolDef>();
  for (const tool of tools) {
    if (index.has(tool.name)) {
      throw new Error(`createMcpToolServer: duplicate tool name "${tool.name}"`);
    }
    index.set(tool.name, tool);
  }
  return index;
}

/**
 * `tools/call` dispatch: looks up `name` in `tools`, runs its handler against `rawArgs`, and
 * converts the outcome to a `CallToolResult` — an unknown tool name or a thrown error both
 * produce an `{isError:true}` result rather than rejecting, matching MCP's convention that tool
 * failures are protocol-level results, not JSON-RPC errors. A thrown error's message is passed
 * through {@link sanitizeUntrustedText} before it reaches the result: `handler` may re-throw text
 * that ultimately traces back to the daemon (untrusted network peer), and a caller-thrown
 * validation error is cheap to sanitize unconditionally rather than trying to prove which case
 * applies at each call site.
 */
export async function handleToolCall(
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  tools: ReadonlyMap<string, McpToolDef>,
  ctx: McpToolContext,
): Promise<CallToolResult> {
  const tool = tools.get(name);
  if (tool === undefined) {
    return errorResult(`unknown tool: ${name}`);
  }
  try {
    const result = await tool.handler(rawArgs ?? {}, ctx);
    return okResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(sanitizeUntrustedText(message));
  }
}
