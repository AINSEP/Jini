/**
 * @module tool-catalog
 *
 * `GET /api/tools/search` / `GET /api/tools/:id` — the discovery half of
 * `ai-control-plane.md` §29 / `PROP-tool-catalog-discovery-2026-07-26.md` §6.1's staged verbs
 * (`search_tools`/`describe_tool`), v0 scope: no principal scoping, no versioning, no schema
 * narrowing. `@jini/mcp`'s `search_tools`/`describe_tool` tool defs proxy these two routes,
 * exactly mirroring how `run-tools.ts`'s tools proxy `runs.ts`.
 *
 * This module does not depend on `@jini/sqlite` or `better-sqlite3` — `ToolCatalogQuery` is a
 * plain injected interface, structurally compatible with `@jini/sqlite`'s
 * `searchToolCatalog`/`getToolCatalogEntry` so a caller wires those in with zero adapter code,
 * matching `db-ops.ts`'s established convention.
 *
 * **Deliberately not routed through `ToolExecutor`.** Unlike `db-ops.ts`'s three tools, nothing
 * here executes a handler or has a side effect — it is a read over a snapshot table. `PROP` §6.3:
 * "discovery is not permission... the catalog is never consulted for authorization." The actual
 * gate is still `ToolExecutor`, reached only via `execute_delegated_tool`
 * (`packages/daemon/src/delegated-tool-bridge.ts`) — finding a tool id here grants nothing.
 */
import type { Express } from 'express';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

export interface ToolCatalogSearchHit {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly score: number;
}

export interface ToolCatalogEntry {
  readonly id: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly source: string;
}

/** Structurally identical to `@jini/sqlite`'s `searchToolCatalog`/`getToolCatalogEntry` — defined locally so this package incurs no `better-sqlite3` dependency. */
export interface ToolCatalogQuery {
  readonly search: (query: string, limit?: number) => readonly ToolCatalogSearchHit[];
  readonly describe: (id: string) => ToolCatalogEntry | null;
}

export interface ToolCatalogHttpDeps {
  readonly catalog: ToolCatalogQuery;
}

const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 10;

function parseSearchInput(input: RouteInputContext): Result<{ query: string; limit: number }> {
  const rawQuery = input.query.q;
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    return err(validationError('q (search query) is required and must be a non-empty string'));
  }
  const rawLimit = input.query.limit;
  if (rawLimit === undefined) return ok({ query: rawQuery, limit: DEFAULT_SEARCH_LIMIT });
  if (typeof rawLimit !== 'string' || !/^[0-9]+$/.test(rawLimit)) {
    return err(validationError('limit must be a single positive-integer query-string value when provided'));
  }
  const parsed = Number(rawLimit);
  if (parsed < 1) return err(validationError('limit must be at least 1'));
  return ok({ query: rawQuery, limit: Math.min(parsed, MAX_SEARCH_LIMIT) });
}

/** `GET /api/tools/search?q=...&limit=...` — ranked candidates only, never schemas (`PROP` §6.1). */
export const toolCatalogSearchRoute = defineJsonRoute<
  { query: string; limit: number },
  { hits: readonly ToolCatalogSearchHit[] },
  ToolCatalogHttpDeps
>({
  method: 'get',
  path: '/api/tools/search',
  requireSameOrigin: true,
  parse: parseSearchInput,
  handle: (input, deps) => ok({ hits: deps.catalog.search(input.query, input.limit) }),
});

function parseDescribeInput(input: RouteInputContext): Result<{ id: string }> {
  const id = input.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return err(validationError('id path segment is required'));
  }
  return ok({ id });
}

/** `GET /api/tools/:id` — full descriptor (schema included), paid for only once a candidate survives search. */
export const toolCatalogDescribeRoute = defineJsonRoute<{ id: string }, ToolCatalogEntry, ToolCatalogHttpDeps>({
  method: 'get',
  path: '/api/tools/:id',
  requireSameOrigin: true,
  parse: parseDescribeInput,
  handle: (input, deps) => {
    const entry = deps.catalog.describe(input.id);
    if (!entry) return err(validationError(`no catalog entry for tool id "${input.id}"`));
    return ok(entry);
  },
});

/** Mounts both tool-catalog routes on `app`. A pack's `http(app, services)` calls this directly. */
export function registerToolCatalogRoutes(app: Express, deps: ToolCatalogHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, toolCatalogSearchRoute, deps, adapter);
  mountJsonRoute(app, toolCatalogDescribeRoute, deps, adapter);
}
