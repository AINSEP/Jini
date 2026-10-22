/**
 * @module agents
 *
 * `GET /api/agents` — lists the agents a host can expose to a client,
 * including host-probed availability/model metadata when supplied.
 * `POST /api/agents/rescan` asks the host to invalidate its discovery cache
 * and probe again.
 *
 * `listAgents` is injected (matching `daemon-status.ts`/`active-context.ts`'s
 * DI convention) rather than this module importing `@jini-ai/agent-runtime`
 * directly — a host typically already has that package's `AGENT_DEFS` array
 * in scope and just needs to project it, and this keeps this route pack from
 * depending on subprocess discovery. The host owns probing,
 * timeouts, caching, PATH/env policy, and the projection of spawn-only
 * metadata; this transport only serializes the safe summary.
 */
import type { Express } from 'express';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from '@jini-ai/http-kit';
import { ok } from '@jini-ai/http-kit';
import type { ModelCatalogSnapshot, DefaultModelResolution, ModelIdentityKind } from '@jini-ai/agent-runtime';

export interface AgentModelSummary {
  readonly id: string;
  readonly label: string;
  readonly identityKind?: ModelIdentityKind;
  readonly resolvedId?: string;
}

/**
 * Client-safe agent discovery data. Optional probe fields preserve the
 * original static-registry contract for hosts that only expose `{id, name}`.
 * Spawn internals (`bin`, resolved path, argv builders, env) never cross HTTP.
 */
export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly available?: boolean;
  readonly version?: string | null;
  readonly authStatus?: 'ok' | 'missing' | 'unknown';
  readonly models?: readonly AgentModelSummary[];
  readonly reasoningOptions?: readonly AgentModelSummary[];
  readonly modelsSource?: 'live' | 'fallback';
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly defaultModelResolution?: DefaultModelResolution;
  readonly supportsCustomModel?: boolean;
  readonly supportsConcreteModelSelection?: boolean;
  readonly diagnostic?: string;
  /**
   * Whether this runtime can receive external MCP servers (the host application's or this engine's
   * own tools) at all, per
   * `@jini-ai/agent-runtime`'s `runtimeSupportsExternalTools(def)` — the def-level source of
   * truth. `undefined` means the host did not populate this field (pre-existing hosts on an older
   * `@jini-ai/daemon/http` continue to omit it); a UI gating on this should treat `undefined` the same
   * as `true` (no known reason to warn) rather than assuming the worst.
   */
  readonly supportsTools?: boolean;
}

export interface AgentsHttpDeps {
  /** Returns the host's cached or freshly resolved client-safe agent inventory. */
  readonly listAgents: () => Promise<readonly AgentSummary[]> | readonly AgentSummary[];
  /** Forces host-owned discovery to run again. Falls back to `listAgents` when omitted. */
  readonly rescanAgents?: () => Promise<readonly AgentSummary[]> | readonly AgentSummary[];
}

export interface AgentListResponse {
  readonly agents: readonly AgentSummary[];
}

/** `GET /api/agents` — read-only, no side effects; matches `runListRoute`/`runStatusRoute`'s posture of not requiring same-origin. */
export const agentListRoute = defineJsonRoute<void, AgentListResponse, AgentsHttpDeps>({ method: 'get', path: '/api/agents', parse: () => ok({ value: undefined }), handle: async ({ input: _input, deps }) => ok({ value: { agents: activeAgents(await deps.listAgents()) } }) });

/** `POST /api/agents/rescan` — explicit state refresh, protected by the local same-origin gate. */
export const agentRescanRoute = defineJsonRoute<void, AgentListResponse, AgentsHttpDeps>({ method: 'post', path: '/api/agents/rescan', parse: () => ok({ value: undefined }), handle: async ({ input: _input, deps }) => ok({ value: { agents: activeAgents(await (deps.rescanAgents ?? deps.listAgents)()) } }) }, { requireSameOrigin: true });

/** Retired CLI inventories can survive in a host cache; never advertise them over this route. */
function activeAgents(agents: readonly AgentSummary[]): readonly AgentSummary[] {
  return agents.filter((agent) => agent.id !== 'gemini');
}

/** Mounts the read and explicit-rescan agent discovery routes. */
export function registerAgentRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: AgentsHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  mountJsonRoute({ app, spec: agentListRoute, deps, adapter });
  mountJsonRoute({ app, spec: agentRescanRoute, deps, adapter });
}
