/**
 * @module @jini-ai/mcp/server/resources/active-resource
 * Read-only active-context resource over GET /api/active. Tools let the model request data during
 * a conversation; resources let clients list and attach that data without invoking a tool.
 * Target-route same-origin and bearer-auth gates remain authoritative, as for the proxy tools.
 */
import { getDaemonJson } from '../daemon-client.js';
import type { McpResourceDef } from '../resource-protocol.js';
import { daemonCallOptions } from '../tool-protocol.js';

interface ActiveContextPayload {
  readonly active: boolean;
  readonly [key: string]: unknown;
}

/**
 * `jini://active` -> `GET /api/active`. Returns the raw daemon payload as formatted JSON text,
 * unchanged — unlike `getActiveContextTool`, this does not add a conversational hint when
 * `active:false`; a resource is meant to be raw structured data a client attaches to context, not
 * a model-facing tool result.
 */
export const activeContextResource: McpResourceDef = {
  uri: 'jini://active',
  name: 'Active context',
  description:
    'The resource (resourceRef) plus optional detail the caller last recorded as its current focus via POST /api/active — the same generic, product-neutral pointer the get_active_context tool proxies, exposed here as an attachable MCP resource instead of a tool call.',
  mimeType: 'application/json',
  read: async ({ ctx }) => {
    const data = await getDaemonJson<ActiveContextPayload>({ baseUrl: ctx.baseUrl, route: '/api/active' }, daemonCallOptions({ ctx }));
    return { text: JSON.stringify(data, null, 2) };
  },
};

/** The full set of kernel resource defs this package ships, ready to pass as `createMcpToolServer`'s `resources` option. */
export const KERNEL_RESOURCES: readonly McpResourceDef[] = [activeContextResource];
