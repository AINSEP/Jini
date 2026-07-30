/**
 * @module @jini-ai/mcp/server/tools/tool-catalog-tools
 *
 * `search_tools` / `describe_tool` — the discovery half of `ai-control-plane.md` §29 /
 * `PROP-tool-catalog-discovery-2026-07-26.md` §6.1, proxying `@jini-ai/http-kit`'s
 * `GET /api/tools/search` / `GET /api/tools/:id` exactly as `run-tools.ts`'s tools proxy
 * `runs.ts` — no separate authorization mechanism, no caching, no state.
 *
 * v0 scope: no principal scoping, no versioning, no schema narrowing. Execution is unchanged —
 * a caller still runs a discovered id through `execute_delegated_tool`
 * (`../tools/delegated-tool.js`), which is the only thing that ever reaches `ToolExecutor`.
 * Finding a tool id here grants nothing (`PROP` §6.3).
 */
import { getDaemonJson } from '../daemon-client.js';
import { daemonCallOptions, requireString, type McpToolDef } from '../tool-protocol.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

interface ToolCatalogSearchResponse {
  readonly hits: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly source: string;
    readonly score: number;
  }>;
}

/** `search_tools` -> `GET /api/tools/search` (`packages/http/src/tool-catalog.ts`'s `toolCatalogSearchRoute`). */
export const searchToolsTool: McpToolDef = {
  name: 'search_tools',
  description:
    'Search the durable tool catalog by keyword. Returns ranked {id, description, source, score} candidates only — no input schemas, so this stays cheap to call broadly. Call describe_tool on the 1-3 candidates that look right before calling execute_delegated_tool.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search for, e.g. "navigate page" or "fill form". Required.' },
      // Bounds mirror `packages/http-kit/src/tool-catalog.ts`'s `parseSearchInput`
      // exactly (`MAX_SEARCH_LIMIT = 25`, `DEFAULT_SEARCH_LIMIT = 10`, integers only,
      // `>= 1`). Declared rather than left as a bare `number` so MCP validation and the
      // route agree: otherwise `0`/`1.5` pass here and are refused downstream, and `26`
      // passes here and is silently clamped — the caller is told one contract and given
      // another.
      limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Max hits to return (1-25). Optional, defaults to 10.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { ...READ_ANNOTATIONS, title: 'Search the tool catalog' },
  handler: async (args, ctx) => {
    requireString(args.query, 'query');
    const params = new URLSearchParams({ q: args.query });
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const data = await getDaemonJson<ToolCatalogSearchResponse>(ctx.baseUrl, `/api/tools/search?${params.toString()}`, daemonCallOptions(ctx));
    return data.hits;
  },
};

/** `describe_tool` -> `GET /api/tools/:id` (`packages/http/src/tool-catalog.ts`'s `toolCatalogDescribeRoute`). */
export const describeToolTool: McpToolDef = {
  name: 'describe_tool',
  description:
    'Get the full descriptor for one tool id found via search_tools — description and input schema. Paid for only on the candidates that survive search, per the tool catalog\'s staged-discovery design.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Tool id returned by search_tools. Required.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { ...READ_ANNOTATIONS, title: 'Describe a tool' },
  handler: async (args, ctx) => {
    requireString(args.id, 'id');
    return getDaemonJson(ctx.baseUrl, `/api/tools/${encodeURIComponent(args.id)}`, daemonCallOptions(ctx));
  },
};

/** Both tool-catalog discovery tools, ready to pass as `createMcpToolServer`'s `tools` option. */
export const TOOL_CATALOG_TOOLS: readonly McpToolDef[] = [searchToolsTool, describeToolTool];
