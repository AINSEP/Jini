import { describe, expect, it } from 'vitest';
import {
  JINI_ROUTE_MANIFEST,
  manifestRoutesForFamilies,
  routeFamilyManifest,
} from '../route-manifest.js';
import type { RouteRegistration } from '../route-manifest.js';
import { agentRoutes } from '../agents.js';
import { delegatedToolRoutes } from '../delegated-tools.js';
import { healthRoutes } from '../health.js';
import { runRoutes } from '../runs.js';
import { toolCatalogRoutes } from '../tool-catalog.js';
import { describeRoutes } from '../route-table.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';

/**
 * The anti-drift guard for `route-manifest.ts`.
 *
 * The manifest restates no path literals, so a spec's path changing can never desynchronize it. The one
 * remaining failure mode is a family gaining a route that nobody lists in the manifest — which is
 * exactly the failure that already shipped once in a real consumer (`GET /api/runs` missing from a
 * hand-maintained proxy route list). These tests build each declared family's real route list and compare, so that omission fails here instead.
 */

/** Routes only need deps at request time, never when the list is built. */
const anyDeps = {} as never;

/** Every family returns its routes as data: what it lists, as registrations. */
const LISTED_FAMILY: Readonly<Record<string, () => RouteRegistration[]>> = {
  runs: () => describeRoutes({ routes: runRoutes({ deps: anyDeps, host: fakeDaemonRouteHost() }) }),
  health: () => describeRoutes({ routes: healthRoutes({ deps: anyDeps, host: fakeDaemonRouteHost() }) }),
  delegatedToolCalls: () => describeRoutes({ routes: delegatedToolRoutes({ deps: anyDeps, host: fakeDaemonRouteHost() }) }),
  agents: () => describeRoutes({ routes: agentRoutes({ deps: anyDeps, host: fakeDaemonRouteHost() }) }),
  toolCatalog: () => describeRoutes({ routes: toolCatalogRoutes({ deps: anyDeps, host: fakeDaemonRouteHost() }) }),
};

/** What `family` really lists. */
function registeredBy(family: string): RouteRegistration[] {
  return LISTED_FAMILY[family]!();
}

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
    expect(Object.keys(LISTED_FAMILY).sort()).toEqual(Object.keys(JINI_ROUTE_MANIFEST).sort());
  });

  it.each(Object.keys(JINI_ROUTE_MANIFEST))('family %s', (family) => {
    const routes = registeredBy(family);
    expect(routes).not.toHaveLength(0);
    expect(sortKeys(routes)).toEqual(sortKeys(JINI_ROUTE_MANIFEST[family]!));
  });

  // The specific regression that motivated the manifest: a proxy built from a hand-copied list omitted
  // the run-list route. Named explicitly so its absence can never be a silent diff again.
  it('includes GET /api/runs, the route a hand-maintained proxy list once missed', () => {
    expect(sortKeys(JINI_ROUTE_MANIFEST.runs!)).toContain('GET /api/runs');
  });

  // The run's own event stream is registered without a route spec, so it is an entry a refactor
  // could orphan.
  it('includes the spec-less run event stream route', () => {
    expect(sortKeys(JINI_ROUTE_MANIFEST.runs!)).toContain('GET /api/runs/:runId/events');
  });
});

describe('routeFamilyManifest', () => {
  it('returns a declared family', () => {
    expect(routeFamilyManifest({ family: 'agents' })).toBe(JINI_ROUTE_MANIFEST.agents);
  });

  // `undefined`, never `[]`: a proxy allow-listing from an empty array would silently forward nothing
  // for that family, which looks identical to the family having no routes.
  it('returns undefined — not an empty array — for an undeclared family', () => {
    expect(routeFamilyManifest({ family: 'memory' })).toBeUndefined();
    expect(routeFamilyManifest({ family: 'nonexistent' })).toBeUndefined();
  });
});

describe('manifestRoutesForFamilies', () => {
  it('unions the named families', () => {
    const routes = manifestRoutesForFamilies({ families: ['agents', 'toolCatalog'] });
    expect(sortKeys(routes)).toEqual(
      sortKeys([...JINI_ROUTE_MANIFEST.agents!, ...JINI_ROUTE_MANIFEST.toolCatalog!]),
    );
  });

  it('de-duplicates a family named twice', () => {
    expect(manifestRoutesForFamilies({ families: ['agents', 'agents'] })).toEqual(JINI_ROUTE_MANIFEST.agents);
  });

  // A caller should be able to pass its enabled-feature list verbatim, including families this manifest
  // does not describe, without pre-filtering or a throw.
  it('ignores unknown families rather than throwing', () => {
    expect(manifestRoutesForFamilies({ families: ['agents', 'memory', 'nonexistent'] })).toEqual(
      JINI_ROUTE_MANIFEST.agents,
    );
  });

  it('returns nothing for an empty family list', () => {
    expect(manifestRoutesForFamilies({ families: [] })).toEqual([]);
  });
});
