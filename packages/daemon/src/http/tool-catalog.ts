/**
 * @module tool-catalog
 *
 * `GET /api/tools/search` / `GET /api/tools/:id` — the discovery half of
 * `ai-control-plane.md` §29 / `PROP-tool-catalog-discovery-2026-07-26.md` §6.1's staged verbs
 * (`search_tools`/`describe_tool`), v0 scope: principal scoping only through the host's optional `catalogFor`, no versioning, no schema
 * narrowing. `@jini-ai/mcp`'s `search_tools`/`describe_tool` tool defs proxy these two routes,
 * exactly mirroring how `run-tools.ts`'s tools proxy `runs.ts`.
 *
 * This module does not depend on `@jini-ai/registry/tool-catalog/sqlite` or `better-sqlite3` — `ToolCatalogQuery` is a
 * plain injected interface, structurally compatible with `@jini-ai/registry/tool-catalog/sqlite`'s
 * `searchToolCatalog`/`getToolCatalogEntry` so a caller wires those in with zero adapter code,
 * matching `db-ops.ts`'s established convention.
 *
 * **Deliberately not routed through `ToolExecutor`.** Unlike `db-ops.ts`'s three tools, nothing
 * here executes a handler or has a side effect — it is a read over a snapshot table. `PROP` §6.3:
 * "discovery is not permission... the catalog is never consulted for authorization." The actual
 * gate is still `ToolExecutor`, reached only via `execute_delegated_tool`
 * (`packages/daemon/src/delegated-tool-bridge.ts`) — finding a tool id here grants nothing.
 */
import type { AgentToolSideEffect } from '@jini-ai/core';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, err, jsonRoute, ok, type JsonRoutePorts, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { parseCatalogDescribeInput, parseCatalogSearchInput } from './catalog-route-input.js';
import type { DaemonRouteHost } from './route-host.js';
import { gated, type DaemonRoute } from './route-table.js';

export interface ToolCatalogSearchHit {
  readonly readOnly?: boolean;
  readonly sideEffects?: AgentToolSideEffect | 'unknown';
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly score: number;
}

export interface ToolCatalogEntry {
  readonly readOnly?: boolean;
  readonly sideEffects?: AgentToolSideEffect | 'unknown';
  readonly id: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly source: string;
  /**
   * Set only on guidance entries that are not tools themselves (a retired-alias pointer, a
   * namespace overview): every tool id the guidance points at. A read-only view shows guidance
   * only when each target is a registered read-only tool, and hides guidance without targets.
   */
  readonly targetToolIds?: readonly string[];
}

/** Optional describe inputs. */
export interface ToolCatalogDescribeOptions {
  /**
   * When set, the caller may use only these tool ids; guidance that lists tools (a namespace
   * overview) should list only these. Never consulted for a registered tool's own entry.
   */
  readonly visibleToolIds?: ReadonlySet<string>;
}

/** Structurally identical to `@jini-ai/registry/tool-catalog/sqlite`'s `searchToolCatalog`/`getToolCatalogEntry` — defined locally so this package incurs no `better-sqlite3` dependency. */
export interface ToolCatalogQuery {
  readonly search: ({ query }: { readonly query: string }, optionalArgs?: { readonly limit?: number | undefined }) => readonly ToolCatalogSearchHit[];
  readonly describe: ({ id }: { readonly id: string }, optional?: ToolCatalogDescribeOptions) => ToolCatalogEntry | null;
}

export interface ToolCatalogHttpDeps {
  /** The unscoped catalog. Used as-is only when `catalogFor` is absent (a single-principal host). */
  readonly catalog: ToolCatalogQuery;
  /**
   * Host-owned: the catalog view the requesting principal may discover (typically
   * `filterReadOnlyToolCatalog({ principal, registry, catalog })`). Called once per request and the
   * result is never kept, so one principal's view cannot be served to another. A throw fails the
   * request closed (generic internal error); it never falls back to the unscoped `catalog`.
   */
  readonly catalogFor?: (required: { readonly request: Request }) => ToolCatalogQuery | Promise<ToolCatalogQuery>;
}

/** Resolves the per-request catalog view before parsing, so both routes share one scoping rule. */
const scopedCatalogPorts: JsonRoutePorts<ToolCatalogHttpDeps, ToolCatalogQuery> = {
  authenticate: ({ request, deps }) => (deps.catalogFor ? deps.catalogFor({ request }) : deps.catalog),
};


/** `GET /api/tools/search?q=...&limit=...` — ranked candidates only, never schemas (`PROP` §6.1). */
export const toolCatalogSearchRoute = defineJsonRoute<
  { query: string; limit: number },
  { hits: readonly ToolCatalogSearchHit[] },
  ToolCatalogHttpDeps,
  ToolCatalogQuery
>({
  method: 'get',
  path: '/api/tools/search',
  parse: (input) => parseCatalogSearchInput({ input }),
  handle: ({ input, deps, context }) => ok({ value: { hits: (context ?? deps.catalog).search({ query: input.query }, { limit: input.limit }) } }),
}, { requireSameOrigin: true, ports: scopedCatalogPorts });


/**
 * `GET /api/tools/:id` — full descriptor (schema included), paid for only once a candidate survives
 * search.
 *
 * An unknown tool id is **404 `NOT_FOUND`**, not 400. A well-formed request naming a catalog entry
 * that does not exist is a missing resource, not a malformed request — and the three sibling route
 * families in this package that have the same "the referenced thing isn't there" case
 * (`memory.ts`'s `memory not found`, `routines.ts`'s `routine not found`, `media.ts`'s
 * `media task not found`) all already answer 404. This route answered 400 until 2026-07-29 purely
 * because it reached for `validationError` — the same helper its `parse` step uses, where 400 *is*
 * correct — so a caller could not distinguish "you sent a bad request" from "that tool is gone".
 * `parse` failures here (a missing `:id` segment) are still 400.
 */
export const toolCatalogDescribeRoute = defineJsonRoute<{ id: string }, ToolCatalogEntry, ToolCatalogHttpDeps, ToolCatalogQuery>({
  method: 'get',
  path: '/api/tools/:id',
  parse: (input) => parseCatalogDescribeInput({ input }),
  handle: ({ input, deps, context }) => {
    const entry = (context ?? deps.catalog).describe({ id: input.id });
    if (!entry) return err({ error: createApiError({ code: 'NOT_FOUND', message: `no catalog entry for tool id "${input.id}"` }) });
    return ok({ value: entry });
  },
}, { requireSameOrigin: true, ports: scopedCatalogPorts });

/**
 * Both tool-catalog routes as data, each behind the same-origin gate its spec declares. A host
 * mounts the list; the routes never see the host's app.
 */
export function toolCatalogRoutes({ deps, host }: { readonly deps: ToolCatalogHttpDeps; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  return [gatedScopedRoute({ spec: toolCatalogSearchRoute, deps, host }), gatedScopedRoute({ spec: toolCatalogDescribeRoute, deps, host })];
}

/**
 * `gatedJsonRoute` for a spec that carries a per-request context. `gatedJsonRoute` is typed for
 * context-free specs only, and the scoped catalog view travels as the route context, so the same
 * two steps (host error reporting, then the same-origin gate) are applied here. Both catalog specs
 * declare `requireSameOrigin`, and GET routes have no body to bound.
 */
function gatedScopedRoute<Input, Output>(
  { spec, deps, host }: { readonly spec: JsonRouteSpec<Input, Output, ToolCatalogHttpDeps, ToolCatalogQuery>; readonly deps: ToolCatalogHttpDeps; readonly host: DaemonRouteHost },
  _optional: Record<string, never> = {},
): DaemonRoute {
  return gated({
    route: jsonRoute({ spec, deps, reportInternalError: host.reportInternalError }, { host: host.context }),
    gates: spec.requireSameOrigin ? [{ name: 'same-origin' }] : [],
  });
}
