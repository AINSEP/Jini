/**
 * @module agents
 *
 * `GET /api/agents` — lists the agents a host can expose to a client,
 * including host-probed availability/model metadata when supplied.
 * `POST /api/agents/rescan` asks the host to invalidate its discovery cache
 * and probe again.
 *
 * `listAgents` is injected (matching `daemon-status.ts`/`active-context.ts`'s
 * DI convention) rather than this module importing `@jini/agent-runtime`
 * directly — a host typically already has that package's `AGENT_DEFS` array
 * in scope and just needs to project it, and this keeps `@jini/http` from
 * taking on a dependency on subprocess discovery. The host owns probing,
 * timeouts, caching, PATH/env policy, and the projection of spawn-only
 * metadata; this transport only serializes the safe summary.
 */
import type { Express } from 'express';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { ok } from './types.js';

export interface AgentModelSummary {
  readonly id: string;
  readonly label: string;
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
  readonly supportsCustomModel?: boolean;
  readonly diagnostic?: string;
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
export const agentListRoute = defineJsonRoute<void, AgentListResponse, AgentsHttpDeps>({
  method: 'get',
  path: '/api/agents',
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ agents: await deps.listAgents() }),
});

/** `POST /api/agents/rescan` — explicit state refresh, protected by the local same-origin gate. */
export const agentRescanRoute = defineJsonRoute<void, AgentListResponse, AgentsHttpDeps>({
  method: 'post',
  path: '/api/agents/rescan',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: async (_input, deps) => ok({ agents: await (deps.rescanAgents ?? deps.listAgents)() }),
});

/** Mounts the read and explicit-rescan agent discovery routes. */
export function registerAgentRoutes(app: Express, deps: AgentsHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, agentListRoute, deps, adapter);
  mountJsonRoute(app, agentRescanRoute, deps, adapter);
}
