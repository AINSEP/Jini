/**
 * @module @jini-ai/mcp/server/tools/component-catalog-tools
 *
 * `search_components` / `describe_component` — the agent-facing discovery half of the
 * interactive-UI loop, proxying `@jini-ai/http-kit`'s `GET /api/components/search` /
 * `GET /api/components/:id` exactly as `tool-catalog-tools.ts` proxies `tool-catalog.ts`.
 *
 * This does not tell the agent how to render anything, only what's registered and its
 * `propsSchema` — an agent still composes an A2UI or MCP-UI message naming the id and props; the
 * host resolves and mounts it. Finding a component id here grants nothing, same posture as the
 * tool catalog's discovery-is-not-permission stance.
 */
import { getDaemonJson } from '../daemon-client.js';
import { daemonCallOptions, requireString, type McpToolDef } from '../tool-protocol.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface ComponentCatalogSearchResponse {
  readonly hits: ReadonlyArray<{
    readonly id: string;
    readonly provider: string;
    readonly capabilities: readonly string[];
    readonly description?: string;
    readonly score: number;
  }>;
}

/** `search_components` -> `GET /api/components/search` (`packages/http-kit/src/component-catalog.ts`'s `componentCatalogSearchRoute`). */
export const searchComponentsTool: McpToolDef = {
  name: 'search_components',
  description:
    'Search the registered interactive-UI component catalog. Returns ranked {id, provider, capabilities, description, score} candidates only — no propsSchema, so this stays cheap to call broadly. Call describe_component on the 1-3 candidates that look right before composing an A2UI or MCP-UI message that names one. Describe what interaction or data shape you need, not a component class name — e.g. "tabular list of records the user can click into" rather than "table".',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Describe the interaction or data shape you need, in plain language — what the user should see and do, not a component name. Example: "let the user pick one date from a range" rather than "DatePicker". Required.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 25,
        description: 'Max hits to return (1-25). Optional, defaults to 10.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { ...READ_ANNOTATIONS, title: 'Search the interactive-UI component catalog' },
  handler: async (args, ctx) => {
    requireString(args.query, 'query');
    const params = new URLSearchParams({ q: args.query });
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const data = await getDaemonJson<ComponentCatalogSearchResponse>(
      ctx.baseUrl,
      `/api/components/search?${params.toString()}`,
      daemonCallOptions(ctx),
    );
    return data.hits;
  },
};

/** `describe_component` -> `GET /api/components/:id` (`packages/http-kit/src/component-catalog.ts`'s `componentCatalogDescribeRoute`). */
export const describeComponentTool: McpToolDef = {
  name: 'describe_component',
  description:
    'Get the full descriptor for one component id found via search_components — provider, capabilities, and propsSchema. Paid for only on the candidates that survive search.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Component id returned by search_components. Required.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { ...READ_ANNOTATIONS, title: 'Describe an interactive-UI component' },
  handler: async (args, ctx) => {
    requireString(args.id, 'id');
    return getDaemonJson(ctx.baseUrl, `/api/components/${encodeURIComponent(args.id)}`, daemonCallOptions(ctx));
  },
};

/** Both component-catalog discovery tools, ready to pass as `createMcpToolServer`'s `tools` option. */
export const COMPONENT_CATALOG_TOOLS: readonly McpToolDef[] = [searchComponentsTool, describeComponentTool];
