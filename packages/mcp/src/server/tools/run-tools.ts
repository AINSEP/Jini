/**
 * @module @injini/mcp/server/tools/run-tools
 *
 * The first real, concrete `McpToolDef`s hosted by `createMcpToolServer`
 * (`../tool-server.js`) — a proxy over `@injini/http`'s already-gated `Run`
 * transport (`packages/http/src/runs.ts`) plus the generic active-resource
 * channel (`packages/http/src/active-context.ts`) and the agent-def listing
 * (`packages/http/src/agents.ts`). Each tool's `handler` does nothing but
 * validate its own arguments and proxy a single HTTP call via
 * `../daemon-client.js` — no separate authorization mechanism, no caching,
 * no state: whatever `@injini/http`'s same-origin guard / bearer-auth
 * middleware already enforces on the target route is the only gate a call
 * here passes through (see `source-map.md`'s 2026-07-21 addition for the
 * full origin-mapping and what was deliberately not ported).
 */
import { getDaemonJson, postDaemonJson } from '../daemon-client.js';
import { requireString, type McpToolDef } from '../tool-protocol.js';

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `start_run` -> `POST /api/runs` (`packages/http/src/runs.ts`'s `runStartRoute`). */
export const startRunTool: McpToolDef = {
  name: 'start_run',
  description:
    'Start a new run against a caller-supplied contextRef (an opaque identity the run belongs to — this kernel has no project/conversation noun, just that one caller-chosen string). Returns {run, started} immediately; poll get_run(run.id) for completion.',
  inputSchema: {
    type: 'object',
    properties: {
      contextRef: {
        type: 'string',
        description: 'Opaque caller-supplied identity the run belongs to. Required.',
      },
      agentId: {
        type: 'string',
        description: 'Which registered agent should drive this run. Optional; the host may default this.',
      },
      idempotencyKey: {
        type: 'string',
        description: 'Starting twice with the same key returns the original run instead of starting a second one. Optional.',
      },
    },
    required: ['contextRef'],
    additionalProperties: false,
  },
  annotations: { ...WRITE_ANNOTATIONS, title: 'Start a run' },
  handler: async (args, ctx) => {
    requireString(args.contextRef, 'contextRef');
    const body: Record<string, unknown> = { contextRef: args.contextRef };
    const agentId = optionalNonEmptyString(args.agentId);
    if (agentId !== undefined) body.agentId = agentId;
    const idempotencyKey = optionalNonEmptyString(args.idempotencyKey);
    if (idempotencyKey !== undefined) body.idempotencyKey = idempotencyKey;
    return postDaemonJson(ctx.baseUrl, '/api/runs', body, { fetchImpl: ctx.fetchImpl });
  },
};

/** `get_run` -> `GET /api/runs/:runId` (`packages/http/src/runs.ts`'s `runStatusRoute`). */
export const getRunTool: McpToolDef = {
  name: 'get_run',
  description: 'Poll a run started by start_run. Returns {run} with the run\'s current state (queued|running|succeeded|failed|canceled, per @injini/protocol\'s RunState).',
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Run id returned by start_run.' },
    },
    required: ['runId'],
    additionalProperties: false,
  },
  annotations: { ...READ_ANNOTATIONS, title: 'Check a run' },
  handler: async (args, ctx) => {
    requireString(args.runId, 'runId');
    return getDaemonJson(ctx.baseUrl, `/api/runs/${encodeURIComponent(args.runId)}`, { fetchImpl: ctx.fetchImpl });
  },
};

/** `cancel_run` -> `POST /api/runs/:runId/cancel` (`packages/http/src/runs.ts`'s `runCancelRoute`). */
export const cancelRunTool: McpToolDef = {
  name: 'cancel_run',
  description: 'Request cancellation of an in-flight run started by start_run. A no-op on an already-terminal run.',
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Run id returned by start_run.' },
      reason: { type: 'string', description: 'Optional human-readable cancellation reason.' },
    },
    required: ['runId'],
    additionalProperties: false,
  },
  annotations: { ...WRITE_ANNOTATIONS, title: 'Cancel a run' },
  handler: async (args, ctx) => {
    requireString(args.runId, 'runId');
    const body: Record<string, unknown> = {};
    const reason = optionalNonEmptyString(args.reason);
    if (reason !== undefined) body.reason = reason;
    return postDaemonJson(ctx.baseUrl, `/api/runs/${encodeURIComponent(args.runId)}/cancel`, body, { fetchImpl: ctx.fetchImpl });
  },
};

interface ActiveContextPayload {
  readonly active: boolean;
  readonly [key: string]: unknown;
}

/** `get_active_context` -> `GET /api/active` (`packages/http/src/active-context.ts`'s `getActiveRoute`). */
export const getActiveContextTool: McpToolDef = {
  name: 'get_active_context',
  description:
    'The resource (resourceRef) plus optional detail the caller last recorded as its current focus via POST /api/active — a generic, product-neutral pointer (this kernel has no "project" or "file" noun; a host maps resourceRef to whatever domain object it manages). Returns {active:false} once the pointer has aged past its TTL (5 minutes, see ACTIVE_CONTEXT_TTL_MS in packages/http/src/active-context.ts) or was never set.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { ...READ_ANNOTATIONS, title: 'What is the caller focused on?' },
  handler: async (_args, ctx) => {
    const data = await getDaemonJson<ActiveContextPayload>(ctx.baseUrl, '/api/active', { fetchImpl: ctx.fetchImpl });
    if (data.active !== true) {
      return {
        active: false,
        hint: 'No active resource is currently recorded, or the recorded one aged out (5-minute TTL). Pass an explicit resource reference to other tools instead of relying on this fallback.',
      };
    }
    return data;
  },
};

/** `list_agents` -> `GET /api/agents` (`packages/http/src/agents.ts`'s `agentListRoute`). */
export const listAgentsTool: McpToolDef = {
  name: 'list_agents',
  description: 'List every agent def registered with this host\'s @injini/agent-runtime — {id, name} pairs suitable for start_run\'s optional agentId argument. Static registration data only: this does not probe which agent binaries are actually installed on the host machine.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { ...READ_ANNOTATIONS, title: 'List registered agents' },
  handler: async (_args, ctx) => getDaemonJson(ctx.baseUrl, '/api/agents', { fetchImpl: ctx.fetchImpl }),
};

/** The full set of kernel-run tool defs this package ships, ready to pass as `createMcpToolServer`'s `tools` option. */
export const RUN_TOOLS: readonly McpToolDef[] = [
  startRunTool,
  getRunTool,
  cancelRunTool,
  getActiveContextTool,
  listAgentsTool,
];
