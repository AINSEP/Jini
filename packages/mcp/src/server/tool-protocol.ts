/**
 * @module @jini-ai/mcp/server/tool-protocol
 *
 * The pure, SDK-connection-free half of the MCP tool-hosting mechanism: the
 * `McpToolDef` contract a caller registers tools against, `tools/list`
 * projection, and `tools/call` dispatch (look up a tool by name, run its
 * handler, wrap the result). None of this touches `@modelcontextprotocol/sdk`'s
 * `Server`/transport classes or the network — a tool `handler` is just
 * `({ args, ctx }) => value | Promise<value>` that either returns a
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
 * text** in a separate, traced incident ( Decision 5): a `resource` block carrying the token
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
 * responsibility ( Decision 4), not this generic wrapper's.
 * See docs/decisions/DR-002-protocol-resource-boundary.md.
 */
import { batchOutcomeFor, type ToolDescriptor } from '@jini-ai/core';
import { sanitizeUntrustedText } from '@jini-ai/core/text';
import { Validator, type Schema } from '@cfworker/json-schema';
import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { argumentShapeMessage, isRecord, normalizeToolArguments } from './tool-arguments.js';

/** What every tool handler receives alongside its parsed arguments. */
export interface McpToolContext {
  /** Publishes a successfully described, host-owned descriptor in this server run only. */
  readonly publishTool?: (required: { descriptor: ToolDescriptor }, optional?: Record<string, never>) => Promise<void>;
  /** Host registration metadata, supplied outside model-controlled arguments. */
  readonly diagnosticToolIds?: readonly string[];
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
export function daemonCallOptions({ ctx }: { ctx: McpToolContext }): { fetchImpl: typeof fetch; headers?: Record<string, string>; signal?: AbortSignal; diagnosticToolIds?: readonly string[] } {
  return {
    fetchImpl: ctx.fetchImpl,
    ...(ctx.diagnosticToolIds !== undefined ? { diagnosticToolIds: ctx.diagnosticToolIds } : {}),
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
  /** Compatibility rules applied once before strict schema validation; never sent on the wire. */
  readonly argumentNormalization?: {
    readonly aliases?: Readonly<Record<string, string>>;
    readonly foldIntoInput?: true;
  };
  readonly handler: (requiredArgs: { args: Args; ctx: McpToolContext }) => Promise<unknown> | unknown;
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
 * Wraps a tool result as an MCP `CallToolResult`, preserving explicit errors and failed batch outcomes.
 *
 * A payload that is already a well-formed MCP content envelope (see {@link isMcpContentEnvelope}) is
 * returned with its `content` array verbatim, so a typed block inside it — `image`, `resource`, or any
 * other block the pinned SDK's `ContentBlockSchema` recognizes — reaches the client as a real content
 * block rather than flattened text (see this module's own doc for the bug this closes). Every other
 * payload keeps the original behavior: a string passes through as one text block; anything else is
 * JSON-stringified (compact, no indentation) into one.
 *
 * @complexity O(n) in the number of content-array entries, only when `payload` already looks like an
 * envelope or batch; O(1) otherwise.
 */
export function okResult({ payload }: { payload: unknown }): CallToolResult {
  const outcome = batchOutcomeFor({ output: payload });
  const isError = (typeof payload === 'object' && payload !== null && 'isError' in payload && payload.isError === true)
    || outcome === 'partial_failure' || outcome === 'error';
  if (isMcpContentEnvelope(payload)) {
    return { content: payload.content as CallToolResult['content'], ...(isError ? { isError: true } : {}) };
  }
  // Compact on the wire: indentation made nested results ~2.5x larger for the model to read. A view
  // that shows a result to a person re-indents it at render time (`@jini-ai/chat`'s
  // `formatToolOutputForDisplay`).
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/** Wraps a tool failure as an MCP `isError` result. */
export function errorResult({ message }: { message: string }): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Returns a validated non-empty string, or throws the existing caller-facing error. */
export function requireString({ value, name }: { value: unknown; name: string }): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required (string).`);
  }
  return value;
}

/** Projects a tool list into the `Tool[]` shape `tools/list` returns. */
export function toolsToList({ tools }: { tools: readonly McpToolDef[] }): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
  }));
}

/** Builds a name -> def lookup, throwing if two tools in `tools` share a name (a caller-configuration bug, surfaced eagerly at server-construction time rather than silently letting the second registration shadow the first). */
export function buildToolIndex({ tools }: { tools: readonly McpToolDef[] }): Map<string, McpToolDef> {
  const index = new Map<string, McpToolDef>();
  for (const tool of tools) {
    if (index.has(tool.name)) {
      throw new Error(`createMcpToolServer: duplicate tool name "${tool.name}"`);
    }
    index.set(tool.name, tool);
  }
  return index;
}

/** Compiled schemas are reused for each stable tool definition, as in the SDK provider. */
const compiledValidators = new WeakMap<McpToolDef, Validator>();

/** Returns the cached validator, retaining structured field locations for recovery instructions. */
function validatorForTool(tool: McpToolDef): Validator {
  const cached = compiledValidators.get(tool);
  if (cached) return cached;
  // The validator adds internal URI fields while compiling. F0's published schemas are frozen;
  // compile a detached copy so validation cannot mutate the immutable wire contract.
  const validator = new Validator(structuredClone(tool.inputSchema) as Schema, '2020-12', true);
  compiledValidators.set(tool, validator);
  return validator;
}

/**
 * `tools/call` dispatch: looks up `name` in `tools`, normalizes aliases/wrapper input, then
 * validates the canonical arguments against the tool's
 * declared `inputSchema`, runs its handler, and converts the outcome to a `CallToolResult` — an
 * unknown tool name, a schema violation, or a thrown error all produce an `{isError:true}` result
 * rather than rejecting, matching MCP's convention that tool failures are protocol-level results,
 * not JSON-RPC errors. Schema validation runs before every handler unconditionally: a caller (an
 * agent, not this repo's own code) supplies `rawArgs`, so a handler must never be trusted to check
 * its own declared contract on the untrusted-input path. Both a validation failure's message and a
 * thrown error's message are passed through {@link sanitizeUntrustedText} before reaching the
 * result: either can end up echoing caller- or daemon-supplied text. The validation prefix uses the
 * registered tool name outside sanitization so long gateway names are not mistaken for secrets.
 */
export async function handleToolCall(
  { name, tools, ctx }: { name: string; tools: ReadonlyMap<string, McpToolDef>; ctx: McpToolContext },
  { rawArgs }: { rawArgs?: Record<string, unknown> | undefined } = {},
): Promise<CallToolResult> {
  const diagnosticToolIds = [...tools.keys(), ...(ctx.diagnosticToolIds ?? [])];
  ctx = { ...ctx, diagnosticToolIds };
  const tool = tools.get(name);
  if (tool === undefined) {
    return errorResult({ message: `unknown tool: ${name}` });
  }
  // Normalization and schema validation share an error boundary; handlers run only afterward.
  // See docs/decisions/DR-005-proxy-argument-shapes.md.
  let validatedArgs: Record<string, unknown>;
  try {
    const args = normalizeToolArguments({ tool, rawArgs: rawArgs ?? {} });
    const validation = validatorForTool(tool).validate(args);
    if (!validation.valid) {
      return errorResult({ message: `invalid arguments for ${tool.name}: ${sanitizeUntrustedText({ text: argumentShapeMessage({ errors: validation.errors }) }, { diagnosticToolIds })}` });
    }
    validatedArgs = args;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult({ message: `invalid arguments for ${tool.name}: ${sanitizeUntrustedText({ text: message }, { diagnosticToolIds })}` });
  }
  try {
    const result = await tool.handler({ args: validatedArgs, ctx: ctx });
    return okResult({ payload: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult({ message: sanitizeUntrustedText({ text: message }, { diagnosticToolIds }) });
  }
}
