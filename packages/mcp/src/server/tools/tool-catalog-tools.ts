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
    'Search the durable tool catalog. Returns ranked {id, description, source, score} candidates only — no input schemas, so this stays cheap to call broadly. Call describe_tool on the 1-3 candidates that look right before calling execute_delegated_tool. If nothing in the results fits, re-search with a higher limit or different phrasing rather than assuming the tool does not exist.',
  inputSchema: {
    type: 'object',
    properties: {
      // Descriptive phrasing, NOT keywords — and the example matters as much as the instruction.
      // The catalog is matched on tool *descriptions* (BM25 over description text), so a query
      // written in the register of a description retrieves far better than a keyword bag. Measured
      // on an independent n=130 blind set: terse keywords 25% top-1, descriptive phrasing 72%.
      // This field previously read 'Keywords to search for, e.g. "navigate page" or "fill form"',
      // which is the 25% form. It also directly contradicted the descriptive guidance a host server
      // may inject upstream (a host's agent-daemon systemOverlay said the opposite), so a caller was
      // given two conflicting instructions — with this one sitting on the parameter itself, read at
      // the moment the query is composed.
      //
      // NOT measured: which instruction won. The hypothesis was that a two-word example outranks
      // prose guidance, but the conflict was removed before anyone measured it, so treat that as
      // untested rather than established. What IS measured, on the coherent state after this fix:
      // 35/35 real search_tools calls across 24 live CLI sessions used descriptive phrasing.
      // Keep the example long-form; shortening it re-creates the 25% form.
      query: {
        type: 'string',
        description:
          'Describe what the tool you need DOES, the way its own documentation would describe it — a full phrase, not a keyword bag. Name the thing being acted on and the action, and include likely synonyms for both. Example: for a request like "how many people visited last week", write "retrieve site traffic and visitor analytics counts for a date range" rather than "visitors last week". Descriptive phrasing retrieves substantially better than terse keywords, because the catalog is matched on tool descriptions. Required.',
      },
      // Bounds mirror `packages/http-kit/src/tool-catalog.ts`'s `parseSearchInput`
      // exactly (`MAX_SEARCH_LIMIT = 25`, `DEFAULT_SEARCH_LIMIT = 10`, integers only,
      // `>= 1`). Declared rather than left as a bare `number` so MCP validation and the
      // route agree: otherwise `0`/`1.5` pass here and are refused downstream, and `26`
      // passes here and is silently clamped — the caller is told one contract and given
      // another.
      // The escalation clause is the cheap half of a measured ceiling. On the same n=130 blind set,
      // with the host's operator-vocabulary + doc2query index folded in, the right tool is in the
      // default top 10 for 98% of cases and in the top 20 for 100% — so the residual misses are
      // ranked just below the cutoff, never absent. Raising the DEFAULT to 20 would buy those 2
      // cases at ~900 extra tokens on every single call; telling the caller to escalate on demand
      // buys the same ceiling only when it is needed. Same lever as the descriptive-phrasing fix
      // above: a prompt change, not an LLM call.
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 25,
        description:
          'Max hits to return (1-25). Optional, defaults to 10. If none of the returned candidates fit what you need, search again with a HIGHER limit (try 25) before concluding no tool exists — the right tool is in the top 10 about 98% of the time and in the top 20 100% of the time, so a near-miss is ranked just below the default cutoff rather than missing.',
      },
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
