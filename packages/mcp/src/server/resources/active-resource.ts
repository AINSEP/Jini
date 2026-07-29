/**
 * @module @jini-ai/mcp/server/resources/active-resource
 *
 * The one MCP *resource* this package ships: a read-only pointer to
 * `GET /api/active` (`packages/http/src/active-context.ts`'s `getActiveRoute`)
 * — the same underlying data `../tools/run-tools.js`'s `getActiveContextTool`
 * already proxies as a *tool*. This is not redundant: OD's origin
 * (`apps/daemon/src/mcp.ts`) exposed the identical `/api/active` payload
 * both ways — as the `get_active_context` tool (already ported, see
 * `../tools/run-tools.js`) AND as the `od://focus/active` resource (its
 * `ListResourcesRequestSchema`/`ReadResourceRequestSchema` handlers) —
 * because tools and resources serve different MCP client affordances: a
 * tool is invoked by the model mid-conversation, while a resource can be
 * listed and attached to context by the user/client without any tool call.
 * This module is that second affordance for the same primitive. See
 * `source-map.md`'s 2026-07-21 addition for why the rest of OD's resource
 * surface (`od://skills/...`, `od://design-systems/...`) was NOT ported the
 * same way (both require a Skill/DesignSystem noun this kernel doesn't have).
 *
 * Security posture matches every other tool/resource in this package: no
 * separate authorization mechanism here — whatever `@jini-ai/http-kit`'s
 * same-origin guard / bearer-auth middleware already enforces on
 * `GET /api/active` is the only gate a read of this resource passes
 * through.
 */
import { getDaemonJson } from '../daemon-client.js';
import type { McpResourceDef } from '../resource-protocol.js';

interface ActiveContextPayload {
  readonly active: boolean;
  readonly [key: string]: unknown;
}

/**
 * `jini://active` -> `GET /api/active`. Returns the raw daemon payload as formatted JSON text,
 * unchanged — unlike `getActiveContextTool`, this does not add a conversational hint when
 * `active:false`; a resource is meant to be raw structured data a client attaches to context, not
 * a model-facing tool result, matching the OD origin's own `od://focus/active` handler (which also
 * returned the raw `/api/active` body with no special-casing).
 */
export const activeContextResource: McpResourceDef = {
  uri: 'jini://active',
  name: 'Active context',
  description:
    'The resource (resourceRef) plus optional detail the caller last recorded as its current focus via POST /api/active — the same generic, product-neutral pointer the get_active_context tool proxies, exposed here as an attachable MCP resource instead of a tool call.',
  mimeType: 'application/json',
  read: async (ctx) => {
    const data = await getDaemonJson<ActiveContextPayload>(ctx.baseUrl, '/api/active', { fetchImpl: ctx.fetchImpl });
    return { text: JSON.stringify(data, null, 2) };
  },
};

/** The full set of kernel resource defs this package ships, ready to pass as `createMcpToolServer`'s `resources` option. */
export const KERNEL_RESOURCES: readonly McpResourceDef[] = [activeContextResource];
