/**
 * @module @injini/mcp/server/resource-protocol
 *
 * The pure, SDK-connection-free half of the MCP *resource* surface —
 * mirrors `./tool-protocol.js` for `resources/list` and `resources/read`.
 * A resource is read-only, addressed by a static `uri` with no arguments,
 * and returns text content; `./tool-server.js` is the thin layer that wires
 * this to a real `Server`'s `ListResourcesRequestSchema`/
 * `ReadResourceRequestSchema` handlers, exactly as `tool-protocol.js` is
 * wired to `ListToolsRequestSchema`/`CallToolRequestSchema`.
 */
import { sanitizeUntrustedText } from '@injini/cli';
import type { ReadResourceResult, Resource } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolContext } from './tool-protocol.js';

/** What one resource's `read` returns before this module wraps it into the MCP wire shape. */
export interface McpResourceReadResult {
  readonly text: string;
  /** Overrides the resource def's own `mimeType` for this particular read. Rarely needed — most resources have a fixed content type. */
  readonly mimeType?: string;
}

/**
 * One read-only MCP resource a `createMcpToolServer` caller registers. `uri` must be unique within
 * a given resource list (`buildResourceIndex` throws otherwise, mirroring `buildToolIndex`'s
 * duplicate-name guard). Unlike a tool, a resource takes no caller-supplied arguments — it is
 * addressed purely by its static `uri`.
 */
export interface McpResourceDef {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly read: (ctx: McpToolContext) => Promise<McpResourceReadResult> | McpResourceReadResult;
}

/** Projects a resource list into the `Resource[]` shape `resources/list` returns. */
export function resourcesToList(resources: readonly McpResourceDef[]): Resource[] {
  return resources.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    ...(resource.description !== undefined ? { description: resource.description } : {}),
    ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
  }));
}

/** Builds a uri -> def lookup, throwing if two resources in `resources` share a uri (a caller-configuration bug, surfaced eagerly at server-construction time rather than letting the second registration shadow the first). */
export function buildResourceIndex(resources: readonly McpResourceDef[]): Map<string, McpResourceDef> {
  const index = new Map<string, McpResourceDef>();
  for (const resource of resources) {
    if (index.has(resource.uri)) {
      throw new Error(`createMcpToolServer: duplicate resource uri "${resource.uri}"`);
    }
    index.set(resource.uri, resource);
  }
  return index;
}

/**
 * `resources/read` dispatch: looks up `uri` in `resources` and runs its `read`. Unlike
 * {@link import('./tool-protocol.js').handleToolCall}, a failure here *throws* rather than
 * returning an `{isError:true}` result — MCP resources have no such protocol-level "soft failure"
 * content shape; an unknown uri or a read failure is meant to surface as a JSON-RPC error response,
 * matching both the MCP spec's `resources/read` contract and the OD origin's own
 * `ReadResourceRequestSchema` handler (which likewise just threw a plain `Error` on an unrecognized
 * uri). The thrown message is passed through {@link sanitizeUntrustedText} unconditionally before
 * it leaves this function, the same conservative posture `handleToolCall` uses — a `read`
 * implementation may re-throw text that traces back to an untrusted daemon response.
 */
export async function handleResourceRead(
  uri: string,
  resources: ReadonlyMap<string, McpResourceDef>,
  ctx: McpToolContext,
): Promise<ReadResourceResult> {
  const resource = resources.get(uri);
  if (resource === undefined) {
    throw new Error(`unsupported resource URI: ${uri}`);
  }
  let result: McpResourceReadResult;
  try {
    result = await resource.read(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(sanitizeUntrustedText(message));
  }
  const mimeType = result.mimeType ?? resource.mimeType;
  return {
    contents: [
      {
        uri,
        text: result.text,
        ...(mimeType !== undefined ? { mimeType } : {}),
      },
    ],
  };
}
