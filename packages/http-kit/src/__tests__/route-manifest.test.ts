import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  JINI_ROUTE_MANIFEST,
  manifestRoutesForFamilies,
  routeFamilyManifest,
} from '../route-manifest.js';
import type { RouteRegistration } from '../route-registration-guard.js';
import { registerAgentRoutes } from '../agents.js';
import { registerDelegatedToolRoutes } from '../delegated-tools.js';
import { registerHealthRoutes } from '../health.js';
import { registerRunStreamRoute } from '../run-stream.js';
import { registerRunRoutes } from '../runs.js';
import { registerToolCatalogRoutes } from '../tool-catalog.js';

/**
 * The anti-drift guard for `route-manifest.ts`.
 *
 * The manifest restates no path literals, so a spec's path changing can never desynchronize it. The one
 * remaining failure mode is a family gaining a route that nobody lists in the manifest — which is
 * exactly the failure that already shipped once in a real consumer (`GET /api/runs` missing from a
 * hand-maintained proxy route list). These tests mount each declared family's real registrar onto a
 * recording app and compare, so that omission fails here instead.
 */

/** Records `{method, path}` for every string-path registration, like `installRouteRegistrationGuard`. */
function recordingApp(): { app: Express; routes: RouteRegistration[] } {
  const routes: RouteRegistration[] = [];
  const record = (method: string) => (path: unknown) => {
    if (typeof path === 'string') routes.push({ method, path });
  };
  const app = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
    options: record('OPTIONS'),
    all: record('ALL'),
    use: record('USE'),
  } as unknown as Express;
  return { app, routes };
}

const adapter = { resolvedPortRef: { current: 4319 } };
/** Registrars only need deps at request time, never at mount time — see `mountJsonRoute`. */
const anyDeps = {} as never;

/** Mounts one family exactly as a composition would, and returns what registered. */
const MOUNT_FAMILY: Readonly<Record<string, (app: Express) => void>> = {
  health: (app) => registerHealthRoutes(app, anyDeps, adapter),
  // `registerRunRoutes` already mounts the run's own event stream; `registerRunStreamRoute` is the
  // separate protocol-encoded stream a composition mounts alongside it.
  runs: (app) => {
    registerRunRoutes(app, anyDeps, adapter);
    registerRunStreamRoute(app, anyDeps);
  },
  agents: (app) => registerAgentRoutes(app, anyDeps, adapter),
  toolCatalog: (app) => registerToolCatalogRoutes(app, anyDeps, adapter),
  delegatedToolCalls: (app) => registerDelegatedToolRoutes(app, anyDeps, adapter),
};

const sortKeys = (routes: readonly RouteRegistration[]) =>
  routes.map((r) => `${r.method} ${r.path}`).sort();

describe('route manifest matches what each family really registers', () => {
  // Guards the enumeration itself: if a family were dropped from the manifest, its per-family test
  // below would simply stop existing and everything would still pass.
  it('declares every family it claims to cover', () => {
    expect(Object.keys(JINI_ROUTE_MANIFEST).sort()).toEqual([
      'agents',
      'delegatedToolCalls',
      'health',
      'runs',
      'toolCatalog',
    ]);
    // Every declared family must have a way to be verified, and vice versa.
    expect(Object.keys(MOUNT_FAMILY).sort()).toEqual(Object.keys(JINI_ROUTE_MANIFEST).sort());
  });

  it.each(Object.keys(JINI_ROUTE_MANIFEST))('family %s', (family) => {
    const { app, routes } = recordingApp();
    MOUNT_FAMILY[family]!(app);
    expect(routes).not.toHaveLength(0);
    expect(sortKeys(routes)).toEqual(sortKeys(JINI_ROUTE_MANIFEST[family]!));
  });

  // The specific regression that motivated the manifest: a proxy built from a hand-copied list omitted
  // the run-list route. Named explicitly so its absence can never be a silent diff again.
  it('includes GET /api/runs, the route a hand-maintained proxy list once missed', () => {
    expect(sortKeys(JINI_ROUTE_MANIFEST.runs!)).toContain('GET /api/runs');
  });

  // Both streaming routes are registered without a route spec, so they are the entries a refactor
  // could orphan — and they are easy to confuse with each other. A proxy that forwards only one leaves
  // the other 404-ing at the host's own router, which is how this class of bug has actually presented.
  it('includes both spec-less streaming routes, not just one of them', () => {
    const keys = sortKeys(JINI_ROUTE_MANIFEST.runs!);
    expect(keys).toContain('GET /api/runs/:runId/events');
    expect(keys).toContain('GET /api/runs/:runId/agui-stream');
  });
});

describe('routeFamilyManifest', () => {
  it('returns a declared family', () => {
    expect(routeFamilyManifest('agents')).toBe(JINI_ROUTE_MANIFEST.agents);
  });

  // `undefined`, never `[]`: a proxy allow-listing from an empty array would silently forward nothing
  // for that family, which looks identical to the family having no routes.
  it('returns undefined — not an empty array — for an undeclared family', () => {
    expect(routeFamilyManifest('memory')).toBeUndefined();
    expect(routeFamilyManifest('nonexistent')).toBeUndefined();
  });
});

describe('manifestRoutesForFamilies', () => {
  it('unions the named families', () => {
    const routes = manifestRoutesForFamilies(['agents', 'toolCatalog']);
    expect(sortKeys(routes)).toEqual(
      sortKeys([...JINI_ROUTE_MANIFEST.agents!, ...JINI_ROUTE_MANIFEST.toolCatalog!]),
    );
  });

  it('de-duplicates a family named twice', () => {
    expect(manifestRoutesForFamilies(['agents', 'agents'])).toEqual(JINI_ROUTE_MANIFEST.agents);
  });

  // A caller should be able to pass its enabled-feature list verbatim, including families this manifest
  // does not describe, without pre-filtering or a throw.
  it('ignores unknown families rather than throwing', () => {
    expect(manifestRoutesForFamilies(['agents', 'memory', 'nonexistent'])).toEqual(
      JINI_ROUTE_MANIFEST.agents,
    );
  });

  it('returns nothing for an empty family list', () => {
    expect(manifestRoutesForFamilies([])).toEqual([]);
  });
});
