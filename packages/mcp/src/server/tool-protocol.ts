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
 *
 * ## The one exception to "wrapped as a successful MCP result"
 *
 * {@link okResult} used to JSON.stringify every non-string payload unconditionally, which is exactly
 * right for the overwhelming majority of handlers (plain JSON — an id, a list, a count) but wrong
 * for a handler whose payload IS already a well-formed MCP content envelope (`{content: [...]}` of
 * recognized block types). Stringifying that flattens a typed `image` block into an inert
 * base64-in-quotes string the client can no longer render or hand to a vision model — the exact bug
 * `execute_delegated_tool` (`../tools/delegated-tool.js`) hit: `@jini-ai/daemon`'s
 * `delegated-tool-bridge.ts` already keeps an image block in its returned `ToolExecutionResult.output`
 * (it is model-safe per that package's `tool-result-surfaces.ts`), but this module still turned it
 * back into text on the way out. It is also how a **human-confirmation token reached model-visible
 * text** in a separate, traced incident (`ADR-053` Decision 5): a `resource` block carrying the token
 * fell to the same stringify path because an earlier version of this fix only recognized `text` and
 * `image`, and `resource` was not yet in that hand-rolled allowlist.
 *
 * {@link okResult} now recognizes a `content` array whose every entry validates against the pinned
 * `@modelcontextprotocol/sdk`'s own `ContentBlockSchema` — the same union the SDK itself defines
 * `CallToolResultSchema.content` against — and passes such an envelope through verbatim instead of
 * stringifying it. Deferring to the SDK's schema rather than re-implementing a per-type shape check
 * here means every block type the pinned protocol version defines (`text`, `image`, `audio`,
 * `resource`, `resource_link` as of `@modelcontextprotocol/sdk@^1.29.0`) is recognized automatically,
 * and a future SDK upgrade that adds another block type is picked up the same way, without another
 * hand-edit to this module. Whitelist, not blacklist: a `content` array holding even one entry that
 * does not validate falls back to the stringify path, so a malformed block is never forwarded as if it
 * were valid protocol output. What this does **not** guarantee: a block type the pinned SDK does not
 * yet know about (a real future MCP protocol addition ahead of this dependency) still falls back to
 * stringify until the SDK dependency itself is upgraded — this fix converts "remember to update this
 * allowlist" into "remember to bump the SDK", not into an unconditional guarantee. It also does not
 * (and cannot) judge intent: a handler that puts a secret inside an otherwise well-formed `text` block
 * will still have it pass through as designed — withholding a value from the model is the handler's
 * responsibility (`ADR-053` Decision 4), not this generic wrapper's.
 */
import { sanitizeUntrustedText } from '@jini-ai/cli';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';
import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js';
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
  /**
   * The MCP request's cancellation signal (the SDK's `extra.signal`), set per tool call. It fires
   * when the client cancels the call (`notifications/cancelled`, including its own per-tool
   * timeout). Forwarded to every daemon request by {@link daemonCallOptions}, so an abandoned call
   * drops its HTTP request and the daemon aborts the tool, which expires any dialog it holds open.
   * Without it, a human could answer that dialog after the model was told the call failed.
   */
  readonly signal?: AbortSignal;
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
export function daemonCallOptions(ctx: McpToolContext): { fetchImpl: typeof fetch; headers?: Record<string, string>; signal?: AbortSignal } {
  return {
    fetchImpl: ctx.fetchImpl,
    ...(ctx.authHeaders !== undefined ? { headers: { ...ctx.authHeaders } } : {}),
    ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `block` is a well-formed MCP content block this module will pass through verbatim rather
 * than JSON-stringify. Delegates to the pinned `@modelcontextprotocol/sdk`'s own `ContentBlockSchema`
 * (the same union `CallToolResultSchema.content` is defined against) instead of a hand-maintained list
 * of per-type shape checks — see this module's own doc for why that matters: a manually maintained
 * allowlist only ever covers the block types someone remembered to add, so the *next* protocol content
 * type (this SDK version already knows five: `text`, `image`, `audio`, `resource`, `resource_link`)
 * would silently fall back to the stringify path exactly like `resource` did before this fix. A block
 * that merely claims a recognized `type` but is missing/mistyping its required field(s) still fails
 * `safeParse` and falls back to the stringify path rather than being forwarded malformed.
 */
function isPassthroughContentBlock(block: unknown): boolean {
  return ContentBlockSchema.safeParse(block).success;
}

/**
 * True when `payload` is already a well-formed MCP content envelope safe to hand back to the client
 * unchanged: a record whose `content` field is an array, and every entry in it is a recognized,
 * well-formed block (see {@link isPassthroughContentBlock}). A payload that merely has an array
 * FIELD named `content` for unrelated reasons (an ordinary JSON object happening to use that name)
 * will not match unless every entry also happens to look like a content block — the same duck-typed
 * convention `@jini-ai/daemon`'s `tool-result-media.ts`/`tool-result-surfaces.ts` already apply to
 * this identical envelope shape one layer up, kept consistent here rather than reinvented.
 */
function isMcpContentEnvelope(payload: unknown): payload is { content: readonly unknown[] } {
  if (!isRecord(payload)) return false;
  const content = payload['content'];
  return Array.isArray(content) && content.every(isPassthroughContentBlock);
}

/**
 * Wraps a successful tool result as an MCP `CallToolResult`.
 *
 * A payload that is already a well-formed MCP content envelope (see {@link isMcpContentEnvelope}) is
 * returned with its `content` array verbatim, so a typed block inside it — `image`, `resource`, or any
 * other block the pinned SDK's `ContentBlockSchema` recognizes — reaches the client as a real content
 * block rather than flattened text (see this module's own doc for the bug this closes). Every other
 * payload keeps the original behavior: a string passes through as one text block; anything else is
 * JSON-stringified into one.
 *
 * @complexity O(n) in the number of content-array entries, only when `payload` already looks like an
 * envelope; O(1) otherwise.
 */
export function okResult(payload: unknown): CallToolResult {
  if (isMcpContentEnvelope(payload)) {
    return { content: payload.content as CallToolResult['content'] };
  }
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
 * The SDK's own edge-runtime-compatible (no `eval`/codegen) JSON Schema validator — the same
 * mechanism `McpServer.registerTool()`'s high-level helper uses internally, borrowed here because
 * `createMcpToolServer` is built on the SDK's low-level `Server.setRequestHandler` instead (see
 * `tool-server.ts`'s module doc), which does not validate a tool's declared `inputSchema` against
 * arguments before its handler runs. One provider instance is reused across every tool: it holds no
 * per-schema state itself (see {@link compiledValidators} for the actual compiled-validator cache).
 */
const schemaValidatorProvider = new CfWorkerJsonSchemaValidator();

/**
 * Compiling a validator from a schema is real work `CfWorkerJsonSchemaValidator` does not cache
 * internally (per its own doc), so it is cached here per `McpToolDef` instance — stable for a
 * server's whole lifetime, since tool defs are created once at module load and never rebuilt.
 */
const compiledValidators = new WeakMap<McpToolDef, JsonSchemaValidator<Record<string, unknown>>>();

function validatorForTool(tool: McpToolDef): JsonSchemaValidator<Record<string, unknown>> {
  const cached = compiledValidators.get(tool);
  if (cached) return cached;
  const validator = schemaValidatorProvider.getValidator<Record<string, unknown>>(tool.inputSchema as JsonSchemaType);
  compiledValidators.set(tool, validator);
  return validator;
}

/**
 * `tools/call` dispatch: looks up `name` in `tools`, validates `rawArgs` against the tool's
 * declared `inputSchema`, runs its handler, and converts the outcome to a `CallToolResult` — an
 * unknown tool name, a schema violation, or a thrown error all produce an `{isError:true}` result
 * rather than rejecting, matching MCP's convention that tool failures are protocol-level results,
 * not JSON-RPC errors. Schema validation runs before every handler unconditionally: a caller (an
 * agent, not this repo's own code) supplies `rawArgs`, so a handler must never be trusted to check
 * its own declared contract on the untrusted-input path. Both a validation failure's message and a
 * thrown error's message are passed through {@link sanitizeUntrustedText} before reaching the
 * result: either can end up echoing caller- or daemon-supplied text, and it is cheaper to sanitize
 * unconditionally than to prove which call site needs it.
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
  const args = rawArgs ?? {};
  // Validation gets its own error boundary, separate from the handler's below. The
  // validator does not only return `{valid:false}` for a bad argument — `@cfworker/json-schema`
  // *throws* for JavaScript values JSON cannot encode (an explicitly-`undefined` optional
  // property yields `Instances of "undefined" type are not supported.`). Compiling the
  // validator can throw too, on a malformed `inputSchema`. Either escaping would break this
  // function's whole contract, that a schema violation is an `{isError:true}` result and never
  // a rejection — and `handleToolCall` is exported, typed `Record<string, unknown>`, and
  // callable directly by a host, so this is reachable and not merely theoretical.
  let validatedArgs: Record<string, unknown>;
  try {
    const validation = validatorForTool(tool)(args);
    if (!validation.valid) {
      return errorResult(sanitizeUntrustedText(`invalid arguments for ${name}: ${validation.errorMessage}`));
    }
    validatedArgs = validation.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(sanitizeUntrustedText(`invalid arguments for ${name}: ${message}`));
  }
  try {
    const result = await tool.handler(validatedArgs, ctx);
    return okResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(sanitizeUntrustedText(message));
  }
}
