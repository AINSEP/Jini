import type { RemoteToolDescriptor, RemoteToolResult, McpClientInfo } from "./ports.js";

/**
 * @file The transport-INDEPENDENT half of host app's minimal MCP client: the JSON-RPC envelope shapes,
 * the handshake constants, and the narrowing of everything a remote server sends back.
 *
 * Why this file exists:
 * `adapter.stdio.ts` and `adapter.http.ts` differ only in how bytes move. Every decision about what
 * a `tools/list` page means, which cursor to follow, how many pages to follow, what a `tools/call`
 * result is allowed to look like, and which fields survive narrowing is identical across both —
 * because it is the PROTOCOL, not the pipe. Duplicating it into the second adapter would have
 * created two copies of this codebase's untrusted-input narrowing that could silently disagree,
 * which is the failure mode the narrowing exists to prevent.
 *
 * Everything here treats its input as HOSTILE. A remote server controls every byte parsed by this
 * file: tool names, descriptions, schemas, annotations, cursors, results. This file's job is to
 * turn that into well-typed values or drop it — never to trust it, and never to throw on it where
 * dropping would do. The trust decisions themselves belong to `trust.ts`; see `ports.ts`'s header
 * for the split.
 *
 * Architectural role:
 * Pure functions and constants. No I/O, no state, no transport knowledge.
 */

/** The MCP revision this client negotiates. A server replying with a different one is accepted —
 * MCP's own rule is that the server names the version it will actually speak — but the value is
 * carried on the session so a mismatch is visible in logs rather than silent. */
export const CLIENT_PROTOCOL_VERSION = "2025-06-18";


/** Bound on `tools/list` cursor-following. A server that returns a fresh `nextCursor` forever would
 * otherwise pin the daemon's boot at 100% CPU; `trust.ts`'s `maxTools` caps what is admitted, but
 * that check runs after this loop, so the loop needs its own bound. */
export const MAX_LIST_TOOLS_PAGES = 20;

/** One JSON-RPC 2.0 frame as received. Every field optional because a remote may omit any of them,
 *  and a missing field must be a narrowing failure rather than a crash. */
export interface JsonRpcResponse {
  jsonrpc?: string | undefined;
  id?: unknown | undefined;
  result?: unknown | undefined;
  error?: { code?: number | undefined; message?: string | undefined; data?: unknown | undefined } | undefined;
  method?: string | undefined;
  params?: unknown | undefined;
}

/** Every failure raised by an MCP client adapter, whatever the transport. Distinct from a plain
 *  `Error` so `bootstrap.ts`'s fail-open handler can tell "the protocol went wrong" from "the code
 *  went wrong" when it logs. */
export class McpProtocolError extends Error {
  constructor({ message }: { message: string }, options: ErrorOptions = {}) {
    super(message, options);
  }
}

/**
 * A `McpProtocolError` specifically caused by the remote's token having expired or been revoked
 * (HTTP 401 today — see `adapter.http.ts`'s `assertOkStatus`; a 403 is a scope/permission refusal,
 * not this). Kept as a distinguishable
 * subtype, rather than a generic `McpProtocolError` a caller would have to pattern-match on message
 * text, so a layer that DOES know what "authorization" means for one connection (an OAuth-backed
 * row, at `assistant/external-mcp-oauth.ts`) can react to it — without this module, which is
 * transport-independent protocol plumbing, knowing anything about OAuth.
 */
export class McpAuthFailedError extends McpProtocolError {}

/** The server's half of a completed handshake. Untrusted, like everything else it sends — recorded
 *  for diagnostics and audit, never acted on. */
export interface McpServerIdentity {
  readonly protocolVersion: string;
  readonly info: { name?: string | undefined; version?: string | undefined };
}

export function asRecord({ value }: { value: unknown }): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Builds the `initialize` params. One function so both transports negotiate identically — a
 *  capability advertised on one and not the other would mean a remote could ask one of host app's two
 *  clients for something the other refuses. */
export function buildInitializeParams({ clientInfo }: { clientInfo: McpClientInfo }): Record<string, unknown> {
  return { protocolVersion: CLIENT_PROTOCOL_VERSION, capabilities: {}, clientInfo };
}

/** Narrows an `initialize` result into the server's self-reported identity. */
export function parseInitializeResult({ result }: { result: unknown }): McpServerIdentity {
  const record = asRecord({ value: result });
  const info = asRecord({ value: record?.serverInfo });
  return {
    protocolVersion: typeof record?.protocolVersion === "string" ? record.protocolVersion : "",
    info: {
      name: typeof info?.name === "string" ? info.name : undefined,
      version: typeof info?.version === "string" ? info.version : undefined,
    },
  };
}

/** Narrows a `tools/call` result. A non-object result is carried through as `content` rather than
 *  discarded: a server returning a bare string is out of spec but harmless, and the untrusted
 *  envelope (`trust.ts` R7) is where it lands either way. */
export function parseCallToolResult({ result }: { result: unknown }): RemoteToolResult {
  const record = asRecord({ value: result });
  if (!record) return { content: result };
  return {
    content: record.content,
    structuredContent: record.structuredContent,
    // The remote's own claim about its own outcome. Surfaced to the model inside the untrusted
    // envelope (`trust.ts` R7); never used to decide anything on this side.
    isError: record.isError === true,
  };
}

/** Narrows one `tools/list` response's `annotations` block. Shape only — the trust decisions all
 *  live in `trust.ts`. Split out of {@link asRemoteToolDescriptor} purely to keep that function's
 *  complexity under the shop ceiling. */
function asRemoteToolAnnotations(record: Record<string, unknown> | null): RemoteToolDescriptor["annotations"] {
  if (!record) return undefined;
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    readOnlyHint: typeof record.readOnlyHint === "boolean" ? record.readOnlyHint : undefined,
    destructiveHint: typeof record.destructiveHint === "boolean" ? record.destructiveHint : undefined,
    idempotentHint: typeof record.idempotentHint === "boolean" ? record.idempotentHint : undefined,
    openWorldHint: typeof record.openWorldHint === "boolean" ? record.openWorldHint : undefined,
  };
}

/** Narrows one `tools/list` entry, discarding anything without a usable `name`. Shape only — the
 * trust decisions all live in `trust.ts`. */
function asRemoteToolDescriptor(value: unknown): RemoteToolDescriptor | null {
  const record = asRecord({ value: value });
  if (!record || typeof record.name !== "string" || record.name.length === 0) return null;
  return {
    name: record.name,
    description: typeof record.description === "string" ? record.description : undefined,
    inputSchema: record.inputSchema,
    annotations: asRemoteToolAnnotations(asRecord({ value: record.annotations })),
  };
}

/** Narrows one `tools/list` response page into its usable descriptors plus the cursor for the next
 *  page (`undefined` when there is none). A malformed entry is dropped rather than thrown on — one
 *  bad descriptor must not cost the operator every other tool on the same server; `trust.ts`
 *  refuses anything that survives this and still fails its own checks. */
export function parseToolsListPage({ result }: { result: unknown }): { readonly tools: RemoteToolDescriptor[]; readonly nextCursor: string | undefined } {
  const record = asRecord({ value: result });
  const rawTools = record && Array.isArray(record.tools) ? record.tools : [];
  const tools: RemoteToolDescriptor[] = [];
  for (const tool of rawTools) {
    const descriptor = asRemoteToolDescriptor(tool);
    if (descriptor) tools.push(descriptor);
  }
  const next = record?.nextCursor;
  return { tools, nextCursor: typeof next === "string" && next.length > 0 ? next : undefined };
}

/**
 * Drains a paginated `tools/list` for one session, whatever the transport.
 *
 * @param requestPage - Issues one `tools/list` request and returns its raw result.
 * @throws {McpProtocolError} When the remote keeps producing cursors past
 * {@link MAX_LIST_TOOLS_PAGES}.
 * @complexity O(p) in pages, bounded by {@link MAX_LIST_TOOLS_PAGES}.
 */
export async function drainToolsList({ requestPage }: { requestPage: (required: { params: Record<string, unknown> }) => Promise<unknown> }): Promise<RemoteToolDescriptor[]> {
  const collected: RemoteToolDescriptor[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_LIST_TOOLS_PAGES; page += 1) {
    const result = await requestPage({ params: cursor === undefined ? {} : { cursor } });
    const { tools, nextCursor } = parseToolsListPage({ result: result });
    collected.push(...tools);
    if (nextCursor === undefined) return collected;
    cursor = nextCursor;
  }

  throw new McpProtocolError(
    { message: `mcp-federation: the remote server kept returning a tools/list nextCursor past ${MAX_LIST_TOOLS_PAGES} pages — refusing to follow it further` },
  );
}
