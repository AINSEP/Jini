/**
 * @module component-catalog
 *
 * `GET /api/components/search` / `GET /api/components/:id` — the discovery half of an agent's
 * interactive-UI loop, shaped exactly like `tool-catalog.ts`'s `search_tools`/`describe_tool`
 * routes: ranked, schema-free hits from search; the full descriptor (including `propsSchema`,
 * this route's analogue of `inputSchema`) only from describe. `@jini-ai/mcp`'s
 * `search_components`/`describe_component` tool defs proxy these two routes.
 *
 * Same non-dependency shape as `tool-catalog.ts`: this module does not import `@jini-ai/ui` or
 * `zod` — `ComponentCatalogQuery` is a plain injected interface, so a caller wires in a query
 * over `@jini-ai/ui/interactive-ui/manifests`'s `ALL_MANIFESTS` (converting each manifest's
 * `propsSchema` to JSON Schema at that wiring point) with zero adapter code here.
 *
 * Same authorization posture, too: discovery is not permission. Finding a component id here
 * grants nothing — a host still decides whether/how to actually mount it.
 */
import type { Express } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

export interface ComponentCatalogSearchHit {
  readonly id: string;
  readonly provider: string;
  readonly capabilities: readonly string[];
  readonly description?: string;
  readonly score: number;
}

export interface ComponentCatalogEntry {
  readonly id: string;
  readonly provider: string;
  readonly capabilities: readonly string[];
  /** JSON Schema, converted from the manifest's zod `propsSchema` at the wiring point — never a live zod object over the wire. */
  readonly propsSchema: unknown;
  readonly description?: string;
}

/** Structurally identical to what a caller derives from `@jini-ai/ui/interactive-ui/manifests`'s `ALL_MANIFESTS` — defined locally so this package incurs no `@jini-ai/ui` or `zod` dependency. */
export interface ComponentCatalogQuery {
  readonly search: (query: string, limit?: number) => readonly ComponentCatalogSearchHit[];
  readonly describe: (id: string) => ComponentCatalogEntry | null;
}

export interface ComponentCatalogHttpDeps {
  readonly catalog: ComponentCatalogQuery;
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

/** `GET /api/components/search?q=...&limit=...` — ranked candidates only, never schemas. */
export const componentCatalogSearchRoute = defineJsonRoute<
  { query: string; limit: number },
  { hits: readonly ComponentCatalogSearchHit[] },
  ComponentCatalogHttpDeps
>({
  method: 'get',
  path: '/api/components/search',
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

/** `GET /api/components/:id` — full descriptor (propsSchema included). An unknown id is 404, matching `tool-catalog.ts`'s describe route. */
export const componentCatalogDescribeRoute = defineJsonRoute<{ id: string }, ComponentCatalogEntry, ComponentCatalogHttpDeps>({
  method: 'get',
  path: '/api/components/:id',
  requireSameOrigin: true,
  parse: parseDescribeInput,
  handle: (input, deps) => {
    const entry = deps.catalog.describe(input.id);
    if (!entry) return err(createApiError('NOT_FOUND', `no catalog entry for component id "${input.id}"`));
    return ok(entry);
  },
});

/** Mounts both component-catalog routes on `app`. A pack's `http(app, services)` calls this directly. */
export function registerComponentCatalogRoutes(app: Express, deps: ComponentCatalogHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, componentCatalogSearchRoute, deps, adapter);
  mountJsonRoute(app, componentCatalogDescribeRoute, deps, adapter);
}
