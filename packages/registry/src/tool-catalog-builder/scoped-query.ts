import type { ToolCatalogEntry, ToolCatalogHit, ToolCatalogQuery } from './ports.js';
import { inputSignature } from './input-signature.js';

/** Server-derived identity of one discovery request; never read off the wire by this module. */
export interface ToolCatalogScope {
  readonly workspaceId: string;
  readonly principalId: string;
  /** Absent when the host cannot name a current version: the view is then built anew and never cached. */
  readonly permissionVersion?: string | number;
  readonly registryRevision?: string | number;
  /** The tool ids this principal may discover in this workspace. */
  readonly allowedToolIds: ReadonlySet<string>;
}

/** The entity types one principal may target through one tool's discriminator property. */
export interface EntityTypeProjection {
  /** Top-level input-schema property that discriminates the entity kind. */
  readonly property: string;
  readonly types: readonly string[];
}

/** A personalized result; it never holds a credential or the request it was resolved from. */
export type ScopedToolCatalogResult =
  | { readonly kind: 'search'; readonly hits: readonly ToolCatalogHit[] }
  | { readonly kind: 'describe'; readonly entry: ToolCatalogEntry | null };

/** Host-owned bounded cache; eviction and size limits belong to the host. */
export interface ScopedToolCatalogCache {
  get(required: { key: string }): ScopedToolCatalogResult | undefined;
  set(required: { key: string; value: ScopedToolCatalogResult }): void;
}

export interface ScopedToolCatalogArgs<R> {
  /** The shared, identity-neutral index; consulted only after a scope resolved. */
  readonly catalog: ToolCatalogQuery;
  /** Returns null/undefined for a request whose scope is unknown; such a request discovers nothing. */
  readonly resolveScope: (required: { request: R }, optional?: Record<string, never>) =>
    ToolCatalogScope | null | undefined | Promise<ToolCatalogScope | null | undefined>;
  /** undefined when the tool has no entity discriminator. */
  readonly entityTypesFor: (required: { toolId: string; scope: ToolCatalogScope }, optional?: Record<string, never>) =>
    EntityTypeProjection | undefined;
}

/** A catalog query whose limit also accepts an explicit undefined, so it satisfies HTTP route ports
 * declared under exactOptionalPropertyTypes as well as this package's `ToolCatalogQuery`. */
export interface ScopedToolCatalogView {
  search(required: { readonly query: string }, optional?: { readonly limit?: number | undefined }): ToolCatalogHit[];
  describe(required: { readonly id: string }): ToolCatalogEntry | null;
}

export interface ScopedToolCatalog<R> {
  /** Shaped like the daemon catalog routes' per-request host port. */
  catalogFor(required: { request: R }): Promise<ScopedToolCatalogView>;
}

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EMPTY_VIEW: ScopedToolCatalogView = {
  search: () => [],
  describe: () => null,
};

/**
 * Narrows one tool's entity discriminator enum to the permitted types on a CLONE of the schema;
 * the shared descriptor schema is never written. Use it on describe results and on provider tool
 * snapshots before publication.
 * @returns The projected clone, or null when nothing is permitted (no offer, never an unconstrained string).
 * @complexity O(s + t·e) for schema size s, t permitted and e declared types.
 */
export function projectEntityDiscriminator(
  required: { inputSchema: unknown; projection: EntityTypeProjection }, _optional: Record<string, never> = {},
): Schema | null {
  const permitted = [...new Set(required.projection.types)];
  if (permitted.length === 0 || !isSchema(required.inputSchema)) return null;
  const clone = structuredClone(required.inputSchema);
  const properties: Schema = isSchema(clone.properties) ? clone.properties : {};
  const current = properties[required.projection.property];
  const field: Schema = isSchema(current) ? current : { type: 'string' };
  const declared: unknown[] | undefined = Array.isArray(field.enum) ? field.enum : undefined;
  // A permission never widens what the tool itself declares it accepts.
  const allowed = declared === undefined ? permitted : permitted.filter(type => declared.includes(type));
  if (allowed.length === 0) return null;
  properties[required.projection.property] = { ...field, enum: allowed };
  return { ...clone, properties };
}

interface ViewArgs {
  readonly catalog: ToolCatalogQuery;
  readonly scope: ToolCatalogScope;
  readonly entityTypesFor: ScopedToolCatalogArgs<unknown>['entityTypesFor'];
}

/** The entry this scope may see, projected; null when the tool is hidden or offers no entity type. */
function offerEntry({ entry, view }: { entry: ToolCatalogEntry; view: ViewArgs }): ToolCatalogEntry | null {
  if (!view.scope.allowedToolIds.has(entry.id)) return null;
  const projection = view.entityTypesFor({ toolId: entry.id, scope: view.scope });
  if (projection === undefined) return entry;
  const inputSchema = projectEntityDiscriminator({ inputSchema: entry.inputSchema, projection });
  return inputSchema === null ? null : { ...entry, inputSchema };
}

/** A hit carries a signature built from the shared schema, so a projected tool's signature is rebuilt. */
function offerHit({ hit, view }: { hit: ToolCatalogHit; view: ViewArgs }): ToolCatalogHit | null {
  if (!view.scope.allowedToolIds.has(hit.id)) return null;
  const projection = view.entityTypesFor({ toolId: hit.id, scope: view.scope });
  if (projection === undefined) return hit;
  const described = view.catalog.describe({ id: hit.id });
  const inputSchema = described === null ? null : projectEntityDiscriminator({ inputSchema: described.inputSchema, projection });
  if (inputSchema === null) return null;
  const { signature: _shared, ...rest } = hit;
  const signature = inputSignature({ inputSchema });
  return signature === undefined ? rest : { ...rest, signature };
}

/**
 * Ranked hits this scope may see. Hidden tools can outrank visible ones, so the fetch window
 * doubles until `limit` visible hits are found or the shared index runs out.
 * @complexity O(n log n) shared-index reads in the worst case for an index of n tools; per-hit
 * offers are memoized so each tool is projected at most once per search.
 */
function searchVisible({ query, limit, view }: { query: string; limit: number; view: ViewArgs }): ToolCatalogHit[] {
  if (limit === 0) return [];
  const offers = new Map<string, ToolCatalogHit | null>();
  for (let window = limit; ; window *= 2) {
    const hits = view.catalog.search({ query }, { limit: window });
    const visible: ToolCatalogHit[] = [];
    for (const hit of hits) {
      if (!offers.has(hit.id)) offers.set(hit.id, offerHit({ hit, view }));
      const offered = offers.get(hit.id);
      if (offered) visible.push(offered);
    }
    if (visible.length >= limit || hits.length < window) return visible.slice(0, limit);
  }
}

/** Collapses whitespace so equivalent queries share one key and reach the index identically. */
function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** The cache key for this scope, or undefined when this request must not be cached. */
function scopeKey({ scope, cache }: { scope: ToolCatalogScope; cache: ScopedToolCatalogCache | undefined }): ((parts: readonly unknown[]) => string) | undefined {
  if (cache === undefined || scope.permissionVersion === undefined) return undefined;
  // Why-comment — registry revision tracks available tools, not who may see the tools or entity variants.
  const identity = [scope.workspaceId, scope.principalId, scope.permissionVersion, scope.registryRevision ?? null];
  return parts => JSON.stringify([...identity, ...parts]);
}

function scopedView({ view, cache }: { view: ViewArgs; cache: ScopedToolCatalogCache | undefined }): ScopedToolCatalogView {
  const keyFor = scopeKey({ scope: view.scope, cache });
  return {
    search({ query }, { limit = 10 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('catalog limit must be a nonnegative integer');
      const normalized = normalizeQuery(query);
      const key = keyFor?.(['search', normalized, limit]);
      const stored = key === undefined ? undefined : cache?.get({ key });
      if (stored?.kind === 'search') return [...stored.hits];
      const hits = searchVisible({ query: normalized, limit, view });
      if (key !== undefined) cache?.set({ key, value: { kind: 'search', hits } });
      return hits;
    },
    describe({ id }) {
      const key = keyFor?.(['describe', id]);
      const stored = key === undefined ? undefined : cache?.get({ key });
      if (stored?.kind === 'describe') return stored.entry;
      const entry = view.catalog.describe({ id });
      const offered = entry === null ? null : offerEntry({ entry, view });
      if (key !== undefined) cache?.set({ key, value: { kind: 'describe', entry: offered } });
      return offered;
    },
  };
}

/**
 * Serves one shared, identity-neutral index per principal. Each request resolves its scope on the
 * server; an unknown scope discovers nothing and the shared index is never consulted, so there is
 * no fallback to an unscoped or borrowed authenticated view. Results are cached only when the host
 * injects a cache AND names a permission version, keyed by the full scope plus the tool or the
 * normalized query and limit. Discovery is not authorization: invocation must still pass the
 * host's real permission check.
 */
export function createScopedToolCatalog<R>(
  required: ScopedToolCatalogArgs<R>, optional: { cache?: ScopedToolCatalogCache } = {},
): ScopedToolCatalog<R> {
  return {
    async catalogFor({ request }) {
      const scope = await required.resolveScope({ request });
      if (!scope || !scope.workspaceId || !scope.principalId) return EMPTY_VIEW;
      return scopedView({ view: { catalog: required.catalog, scope, entityTypesFor: required.entityTypesFor }, cache: optional.cache });
    },
  };
}
