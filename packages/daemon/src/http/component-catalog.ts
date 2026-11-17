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
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, err, ok } from '@jini-ai/core/contracts/server';
import { parseCatalogDescribeInput, parseCatalogSearchInput } from './catalog-route-input.js';
import type { DaemonRouteHost } from './route-host.js';
import { gatedJsonRoute, type DaemonRoute } from './route-table.js';

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
  readonly search: ({ query }: { readonly query: string }, optionalArgs?: { readonly limit?: number | undefined }) => readonly ComponentCatalogSearchHit[];
  readonly describe: ({ id }: { readonly id: string }, _optional?: Record<string, never>) => ComponentCatalogEntry | null;
}

export interface ComponentCatalogHttpDeps {
  readonly catalog: ComponentCatalogQuery;
}


/**
 * `GET /api/components/search?q=...&limit=...` — ranked candidates only, never schemas.
 *
 * `requireSameOrigin` on a read-only `GET` is deliberately stricter than most other read-only
 * `GET`s in this API (which generally leave `GET`s open). This one is closer to `db-ops.ts`'s
 * "even `inspect` alone discloses information" reasoning than to a generic content-read `GET`:
 * it discloses the installed interactive-UI component/capability inventory this daemon can
 * mount — information a third-party origin embedding this daemon's port has no legitimate need
 * to enumerate. Decided 2026-08-23: keep the guard, do not loosen it to match the looser
 * "GETs are open" pattern elsewhere.
 */
export const componentCatalogSearchRoute = defineJsonRoute<
  { query: string; limit: number },
  { hits: readonly ComponentCatalogSearchHit[] },
  ComponentCatalogHttpDeps
>({ method: 'get', path: '/api/components/search', parse: (input) => parseCatalogSearchInput({ input }), handle: ({ input, deps }) => ok({ value: { hits: deps.catalog.search({ query: input.query }, { limit: input.limit }) } }) }, { requireSameOrigin: true });


/**
 * `GET /api/components/:id` — full descriptor (propsSchema included). An unknown id is 404,
 * matching `tool-catalog.ts`'s describe route.
 *
 * `requireSameOrigin` here is intentional for the same reason as `componentCatalogSearchRoute`
 * above (see that route's comment) — this one discloses even more (the full `propsSchema` per
 * component), so it inherits the same stricter posture rather than the general "GETs are open"
 * pattern.
 */
export const componentCatalogDescribeRoute = defineJsonRoute<{ id: string }, ComponentCatalogEntry, ComponentCatalogHttpDeps>({
  method: 'get', path: '/api/components/:id', parse: (input) => parseCatalogDescribeInput({ input }), handle: ({ input, deps }) => {
    const entry = deps.catalog.describe({ id: input.id });
    if (!entry) return err({ error: createApiError({ code: 'NOT_FOUND', message: `no catalog entry for component id "${input.id}"` }) });
    return ok({ value: entry });
  }
}, { requireSameOrigin: true });

/**
 * Both component-catalog routes as data, each behind the same-origin gate its spec declares. A host
 * mounts the list; the routes never see the host's app.
 */
export function componentCatalogRoutes({ deps, host }: { readonly deps: ComponentCatalogHttpDeps; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  return [gatedJsonRoute({ spec: componentCatalogSearchRoute, deps, host }), gatedJsonRoute({ spec: componentCatalogDescribeRoute, deps, host })];
}
