/**
 * @module @jini-ai/mcp/server/tools/run-tools
 *
 * The first real, concrete `McpToolDef`s hosted by `createMcpToolServer`
 * (`../tool-server.js`) — a proxy over `@jini-ai/http-kit`'s already-gated `Run`
 * transport (`packages/http/src/runs.ts`) plus the generic active-resource
 * channel (`packages/http/src/active-context.ts`) and the agent-def listing
 * (`packages/http/src/agents.ts`). Each tool's `handler` does nothing but
 * validate its own arguments and proxy a single HTTP call via
 * `../daemon-client.js` — no separate authorization mechanism, no caching,
 * no state: whatever `@jini-ai/http-kit`'s same-origin guard / bearer-auth
 * middleware already enforces on the target route is the only gate a call
 * here passes through (see `source-map.md`'s 2026-07-21 addition for the
 * full origin-mapping and what was deliberately not ported).
 */
import { getDaemonJson, postDaemonJson } from '../daemon-client.js';
import { daemonCallOptions, requireString, type McpToolDef } from '../tool-protocol.js';

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
    return postDaemonJson(ctx.baseUrl, '/api/runs', body, daemonCallOptions(ctx));
  },
};

/** `get_run` -> `GET /api/runs/:runId` (`packages/http/src/runs.ts`'s `runStatusRoute`). */
export const getRunTool: McpToolDef = {
  name: 'get_run',
  description: 'Poll a run started by start_run. Returns {run} with the run\'s current state (queued|running|succeeded|failed|canceled, per @jini-ai/protocol\'s RunState).',
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
    return getDaemonJson(ctx.baseUrl, `/api/runs/${encodeURIComponent(args.runId)}`, daemonCallOptions(ctx));
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
    return postDaemonJson(ctx.baseUrl, `/api/runs/${encodeURIComponent(args.runId)}/cancel`, body, daemonCallOptions(ctx));
  },
};

interface ActiveContextPayload {
  readonly active: boolean;
  readonly [key: string]: unknown;
}

/**
 * What a model is told when the host's daemon never mounted `GET /api/active` (a 404 — the route
 * itself has no 404 answer). Without it the model saw a bare "daemon 404 on ..." and, primed by this
 * tool's own description, reported "no pointer set / aged past the TTL" (Tovu, 2026-09-16).
 */
const ACTIVE_CONTEXT_NOT_SUPPORTED =
  'get_active_context is not supported by this host: its daemon does not serve GET /api/active (HTTP 404). This is NOT the same as {active:false} — no focus is tracked through this tool here at all. Use any screen/page context the host put in your prompt, or ask the user.';

/** Reads `/api/active`, turning a 404 into {@link ACTIVE_CONTEXT_NOT_SUPPORTED}; every other failure is rethrown unchanged. */
async function fetchActiveContext(ctx: Parameters<McpToolDef['handler']>[1]): Promise<ActiveContextPayload> {
  try {
    return await getDaemonJson<ActiveContextPayload>(ctx.baseUrl, '/api/active', daemonCallOptions(ctx));
  } catch (err) {
    if ((err as { status?: unknown } | null)?.status === 404) throw new Error(ACTIVE_CONTEXT_NOT_SUPPORTED);
    throw err;
  }
}

/** `get_active_context` -> `GET /api/active` (`packages/http/src/active-context.ts`'s `getActiveRoute`). */
export const getActiveContextTool: McpToolDef = {
  name: 'get_active_context',
  description:
    'The resource (resourceRef) plus optional detail the caller last recorded as its current focus via POST /api/active — a generic, product-neutral pointer (this kernel has no "project" or "file" noun; a host maps resourceRef to whatever domain object it manages). Returns {active:false} once the pointer has aged past its TTL (5 minutes, see ACTIVE_CONTEXT_TTL_MS in packages/http/src/active-context.ts) or was never set. On a host that does not support active context at all, the call fails with an explicit "not supported by this host" error instead — that means nothing is tracked here, not that the pointer expired.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { ...READ_ANNOTATIONS, title: 'What is the caller focused on?' },
  handler: async (_args, ctx) => {
    const data = await fetchActiveContext(ctx);
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
  description: 'List every agent def registered with this host\'s @jini-ai/agent-runtime — {id, name} pairs suitable for start_run\'s optional agentId argument. Static registration data only: this does not probe which agent binaries are actually installed on the host machine.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { ...READ_ANNOTATIONS, title: 'List registered agents' },
  handler: async (_args, ctx) => getDaemonJson(ctx.baseUrl, '/api/agents', daemonCallOptions(ctx)),
};

/** The full set of kernel-run tool defs this package ships, ready to pass as `createMcpToolServer`'s `tools` option. */
export const RUN_TOOLS: readonly McpToolDef[] = [
  startRunTool,
  getRunTool,
  cancelRunTool,
  getActiveContextTool,
  listAgentsTool,
];
